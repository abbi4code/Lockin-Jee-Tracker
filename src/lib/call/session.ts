import { AWAY_GRACE_MS, endReason, HEARTBEAT_MS, othersIn, RING_MS, type CallRow, type Invitee, type MemberRow, type Notice } from "./calls";
import type { CallTransport, Peer, TransportEvents } from "./transport";

// This device's part in a call: starting one or joining one, the media connection while it's open, the roster from
// the database, the heartbeat, and ending it. The database sits behind `CallBackend` and the media behind
// `CallTransport` (lib/call/backend.ts and livekit.ts in the app, fakes in the tests), so this file has neither
// Supabase nor WebRTC in it.

export interface CallBackend {
  /** start_call: makes (or reuses) the call for `context` and rings the invitees. Returns its id. */
  start(context: string, invitees: Invitee[], myName: string): Promise<string>;
  setState(call: string, state: "joined" | "left" | "declined", name?: string): Promise<void>;
  heartbeat(call: string): Promise<void>;
  load(call: string): Promise<{ call: CallRow; members: MemberRow[] }>;
  /** Calls `onChange` whenever the call or its roster changes. Returns a function that stops watching. */
  watch(call: string, onChange: () => void): () => void;
  /** The media connection for a call, sending `local`. */
  transport(call: CallRow, local: MediaStream, events: TransportEvents): CallTransport;
  /** Push-notifies the people being rung (best effort). */
  notify(call: string): void;
  /** Marks you as left in a way that survives the page closing (a keepalive request). */
  beacon(call: string): void;
  /** Your recent rows across calls (rings, calls you're in), and a feed of changes to them. */
  mine(me: string): Promise<MemberRow[]>;
  watchMine(me: string, onChange: () => void): () => void;
}

export interface SessionState {
  /** idle: no call · calling: rung, nobody else has picked up yet · live: someone else is in. */
  phase: "idle" | "calling" | "live";
  /** Joining or leaving is under way (buttons wait). */
  busy: boolean;
  call: CallRow | null;
  members: MemberRow[];
  peers: Peer[];
  local: MediaStream | null;
  mic: boolean;
  cam: boolean;
  /** Why the last call ended or couldn't start. */
  notice: Notice | null;
  /** The server's words when something was refused (e.g. "you can only call your opponent in this game."). */
  error: string | null;
}

export const IDLE: SessionState = { phase: "idle", busy: false, call: null, members: [], peers: [], local: null, mic: true, cam: true, notice: null, error: null };

/** Camera and mic; falls back to the mic alone on a device without a camera. */
export async function getMedia(): Promise<MediaStream> {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return navigator.mediaDevices.getUserMedia({ audio });
    throw e;
  }
}

export interface SessionOptions {
  backend: CallBackend;
  me: { id: string; name: string };
  onChange: (s: SessionState) => void;
  media?: () => Promise<MediaStream>;
  ringMs?: number;
  heartbeatMs?: number;
}

interface Open {
  call: CallRow;
  transport: CallTransport;
  local: MediaStream;
  unwatch: () => void;
  timers: ReturnType<typeof setTimeout>[];
  /** Someone else has been in the call at some point. */
  connected: boolean;
}

const stop = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

export class CallSession {
  state: SessionState = IDLE;
  private open: Open | null = null;
  /** Bumped by every start/join/leave: a slow step that finishes after a newer one has begun gives up. */
  private turn = 0;

  constructor(private o: SessionOptions) {}

  /** Calls `invitees` from `context` (a game, the coach chat). Already in that call: rings them again instead. */
  async start(context: string, invitees: Invitee[]) {
    if (this.state.busy) return;
    if (this.open && this.open.call.context !== context) await this.leave();
    const turn = ++this.turn;
    this.set({ busy: true, notice: null, error: null });
    const reused = this.open?.local;
    const local = reused ?? (await this.openMedia());
    if (!local) return this.set({ busy: false });
    // Hung up (or signed out) while the camera was opening: let it go again.
    if (turn !== this.turn) return void (local !== this.open?.local && stop(local));
    let id: string;
    try {
      id = await this.o.backend.start(context, invitees, this.o.me.name);
    } catch (e) {
      if (local !== this.open?.local) stop(local);
      return this.set({ busy: false, error: (e as Error).message || "couldn't start the call." });
    }
    // Hung up while start_call ran: it already marked us in and rang them, so take that back.
    if (turn !== this.turn) {
      if (local !== this.open?.local) stop(local);
      if (this.open?.call.id !== id) void this.o.backend.setState(id, "left").catch(() => {});
      return;
    }
    this.o.backend.notify(id);
    if (this.open?.call.id === id) return this.set({ busy: false });
    if (this.open) await this.leave();
    await this.enter(id, local, turn);
  }

  /** Answers a ring, or rejoins a call this device dropped out of (a reload). */
  async join(callId: string) {
    if (this.state.busy || this.open?.call.id === callId) return;
    if (this.open) await this.leave();
    const turn = ++this.turn;
    this.set({ busy: true, notice: null, error: null });
    const local = await this.openMedia();
    if (!local) {
      void this.o.backend.setState(callId, "declined").catch(() => {});
      return this.set({ busy: false });
    }
    if (turn !== this.turn) return stop(local);
    try {
      await this.o.backend.setState(callId, "joined", this.o.me.name);
    } catch (e) {
      stop(local);
      return this.set({ busy: false, error: (e as Error).message || "that call has ended." });
    }
    // Hung up while joining: we're marked in now, so take that back.
    if (turn !== this.turn) {
      stop(local);
      return void this.o.backend.setState(callId, "left").catch(() => {});
    }
    await this.enter(callId, local, turn);
  }

  decline(callId: string) {
    return this.o.backend.setState(callId, "declined").catch(() => {});
  }

  /** Lets go of a call this device dropped out of (a reload) without rejoining it. */
  drop(callId: string) {
    return this.o.backend.setState(callId, "left").catch(() => {});
  }

  /** Leaves the call: a hang-up ('left'), so it ends for the others at once if they're the last. */
  async leave(notice: Notice | null = null) {
    const open = this.release(notice);
    if (open) await this.o.backend.setState(open.call.id, "left").catch(() => {});
  }

  /**
   * The page is closing: drop the connection and mark this device 'away' with a keepalive request, without waiting.
   * Not a hang-up: the others hold the call open a little (AWAY_GRACE_MS) in case this is a reload. Returns the
   * call's id.
   */
  pageHidden() {
    const open = this.release(null);
    if (!open) return null;
    this.o.backend.beacon(open.call.id);
    return open.call.id;
  }

  toggleMic() {
    this.media(!this.state.mic, this.state.cam);
  }

  toggleCam() {
    if (this.open?.local.getVideoTracks().length) this.media(this.state.mic, !this.state.cam);
  }

  private media(mic: boolean, cam: boolean) {
    if (!this.open) return;
    this.open.transport.setMedia(mic, cam);
    this.set({ mic, cam });
  }

  /**
   * Ends this device's part in the call: timers, roster feed, the media connection, camera and mic. Says nothing to
   * the database; returns what was open, if anything.
   */
  private release(notice: Notice | null) {
    const open = this.open;
    this.turn++;
    this.set({ ...IDLE, notice });
    if (!open) return null;
    this.open = null;
    open.timers.forEach(clearTimeout);
    open.unwatch();
    open.transport.leave();
    stop(open.local);
    return open;
  }

  private async enter(id: string, local: MediaStream, turn: number) {
    let loaded: { call: CallRow; members: MemberRow[] };
    try {
      loaded = await this.o.backend.load(id);
    } catch {
      stop(local);
      void this.o.backend.setState(id, "left").catch(() => {});
      return this.set({ busy: false, notice: "failed" });
    }
    // Hung up while the call loaded: we're marked in, so take that back.
    if (turn !== this.turn) {
      stop(local);
      return void this.o.backend.setState(id, "left").catch(() => {});
    }
    // Filled in below; the transport only calls back once it's connecting.
    let open: Open;
    const transport = this.o.backend.transport(loaded.call, local, {
      onChange: (peers) => this.open === open && this.set({ peers }),
      // Your other tab or device took the call: step aside here, leaving your place in the roster to it.
      onMoved: () => void (this.open === open && this.release("moved")),
      onFailed: () => void (this.open === open && this.leave("failed")),
    });
    open = { call: loaded.call, transport, local, unwatch: () => {}, timers: [], connected: false };
    this.open = open;
    open.unwatch = this.o.backend.watch(id, () => void this.refresh(open));
    // Heartbeat while in the call, so a vanished device can be told apart from a quiet one.
    const beat = () => {
      void this.o.backend.heartbeat(id).catch(() => {});
      open.timers.push(setTimeout(beat, this.o.heartbeatMs ?? HEARTBEAT_MS));
    };
    open.timers.push(setTimeout(beat, this.o.heartbeatMs ?? HEARTBEAT_MS));
    // Nobody picks up: give up once the ring has run out.
    open.timers.push(setTimeout(() => this.open === open && !open.connected && void this.leave("no-answer"), this.o.ringMs ?? RING_MS));
    this.set({ busy: false, call: loaded.call, local, mic: local.getAudioTracks().length > 0, cam: local.getVideoTracks().length > 0, peers: [] });
    this.apply(open, loaded.call, loaded.members);
    try {
      await transport.connect();
    } catch (e) {
      if (this.open !== open) return;
      await this.leave();
      this.set({ error: (e as Error).message || "couldn't connect the call." });
    }
  }

  /** The roster or the call changed in the database. */
  private async refresh(open: Open) {
    let loaded: { call: CallRow; members: MemberRow[] };
    try {
      loaded = await this.o.backend.load(open.call.id);
    } catch {
      return;
    }
    if (this.open === open) this.apply(open, loaded.call, loaded.members);
  }

  private apply(open: Open, call: CallRow, members: MemberRow[]) {
    const me = this.o.me.id;
    const now = Date.now();
    // Someone 'away' (their page closed, most likely a reload) counts as in the call for a while: look again when that
    // runs out, to end the call if they haven't come back.
    for (const m of members) {
      if (m.user_id === me || m.state !== "away") continue;
      const left = AWAY_GRACE_MS - (now - Date.parse(m.updated_at));
      if (left > 0) open.timers.push(setTimeout(() => void this.refresh(open), left + 50));
    }
    if (othersIn(members, me).length) open.connected = true;
    const reason = call.ended_at ? (open.connected ? "left" : endReason(members, me, false) ?? "no-answer") : endReason(members, me, open.connected);
    // A ring that's still running keeps the call open even with nobody else in yet (endReason returns null).
    if (reason && (call.ended_at || open.connected || !members.some((m) => m.user_id !== me && m.state === "ringing"))) {
      void this.leave(reason);
      return;
    }
    this.set({ call, members, phase: othersIn(members, me).length ? "live" : "calling" });
  }

  private async openMedia() {
    try {
      return await (this.o.media ?? getMedia)();
    } catch (e) {
      const name = (e as DOMException).name;
      this.set({ notice: name === "NotFoundError" ? "no-device" : name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "failed" });
      return null;
    }
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.o.onChange(this.state);
  }
}
