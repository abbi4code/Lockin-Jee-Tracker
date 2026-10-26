import { AWAY_GRACE_MS, endReason, HEARTBEAT_MS, othersIn, RING_MS, type CallRow, type Invitee, type MemberRow, type Notice } from "./calls";
import { Mesh, type MeshSignal, type Peer } from "./mesh";

// This device's part in a call: starting one or joining one, the mesh of connections while it's open, the roster
// from the database, the heartbeat, and ending it. The database side sits behind `CallBackend` (lib/call/backend.ts
// in the app, a fake in the tests), so this file has no Supabase in it.

export interface CallBackend {
  /** start_call: makes (or reuses) the call for `context` and rings the invitees. Returns its id. */
  start(context: string, invitees: Invitee[], myName: string): Promise<string>;
  setState(call: string, state: "joined" | "left" | "declined", name?: string): Promise<void>;
  heartbeat(call: string): Promise<void>;
  load(call: string): Promise<{ call: CallRow; members: MemberRow[] }>;
  /** Calls `onChange` whenever the call or its roster changes. Returns a function that stops watching. */
  watch(call: string, onChange: () => void): () => void;
  /** The signaling channel for a call (named with its key). */
  signal(call: CallRow): MeshSignal & { close(): void };
  iceServers(): Promise<RTCIceServer[]>;
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
  /** The server's words when start_call refused (e.g. "you can only call your opponent in this game."). */
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
  mesh: Mesh;
  local: MediaStream;
  signal: MeshSignal & { close(): void };
  unwatch: () => void;
  timers: ReturnType<typeof setTimeout>[];
  /** Someone else has been in the call at some point. */
  connected: boolean;
  /** People whose page closed mid-call (a reload, most likely): when their goodbye came. */
  away: Map<string, number>;
  /** People who hung up (their goodbye said so): when. */
  gone: Map<string, number>;
  /** Departures the roster showed before their goodbye arrived, already given a moment: user → that row's updated_at. */
  waited: Map<string, string>;
  /** The roster as last read (with the away grace applied): who may connect, and who should be connected. */
  members: MemberRow[];
}

const stop = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());
/** How often the roster and the connections are compared (and a missing connection repaired). */
const RECONCILE_MS = 5000;

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

  /** Leaves the call. `notice` says why, when it wasn't your choice. */
  async leave(notice: Notice | null = null) {
    const open = this.release(notice);
    if (open) await this.o.backend.setState(open.call.id, "left").catch(() => {});
  }

  /**
   * Ends this device's part in the call: timers, roster feed, connections (with a goodbye), camera and mic, and the
   * channel. Says nothing to the database; returns what was open, if anything.
   */
  private release(notice: Notice | null, how: { away?: boolean; closeNow?: boolean } = {}) {
    const open = this.open;
    this.turn++;
    this.set({ ...IDLE, notice });
    if (!open) return null;
    this.open = null;
    open.timers.forEach(clearTimeout);
    open.unwatch();
    open.mesh.leave(how.away);
    stop(open.local);
    // Let the goodbye go out before the channel closes, unless the page is going away anyway.
    if (how.closeNow) open.signal.close();
    else setTimeout(() => open.signal.close(), 500);
    return open;
  }

  /**
   * The page is closing: say goodbye on the channel and in the roster without waiting for anything. The goodbye
   * says "away", so the others hold the call open a little in case this was a reload. Returns the call's id.
   */
  pageHidden() {
    const open = this.release(null, { away: true, closeNow: true });
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
    this.open.mesh.setMedia(mic, cam);
    this.set({ mic, cam });
  }

  private async enter(id: string, local: MediaStream, turn: number) {
    let loaded: { call: CallRow; members: MemberRow[] };
    let iceServers: RTCIceServer[];
    try {
      [loaded, iceServers] = await Promise.all([this.o.backend.load(id), this.o.backend.iceServers()]);
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
    const signal = this.o.backend.signal(loaded.call);
    // Filled in below; the mesh only calls back once messages arrive.
    let open: Open;
    const mesh = new Mesh({
      signal,
      user: this.o.me.id,
      name: this.o.me.name,
      local,
      iceServers,
      onChange: (peers) => this.set({ peers }),
      admits: (user) => open.members.some((m) => m.user_id === user && m.state === "joined"),
      // Your other tab or device took the call: step aside here, leaving your place in the roster to it.
      onMoved: () => void (this.open === open && this.release("moved")),
      onBye: (user, away) => {
        if (!away) {
          open.away.delete(user);
          open.gone.set(user, Date.now());
          return void this.refresh(open);
        }
        open.away.set(user, Date.now());
        // Look again once the grace is up: back by then, or gone.
        open.timers.push(setTimeout(() => void this.refresh(open), AWAY_GRACE_MS + 50));
      },
    });
    open = { call: loaded.call, mesh, local, signal, unwatch: () => {}, timers: [], connected: false, away: new Map(), gone: new Map(), waited: new Map(), members: loaded.members };
    this.open = open;
    open.unwatch = this.o.backend.watch(id, () => void this.refresh(open));
    // Heartbeat while in the call, so a vanished device can be told apart from a quiet one.
    const beat = () => {
      void this.o.backend.heartbeat(id).catch(() => {});
      open.timers.push(setTimeout(beat, this.o.heartbeatMs ?? HEARTBEAT_MS));
    };
    open.timers.push(setTimeout(beat, this.o.heartbeatMs ?? HEARTBEAT_MS));
    const check = () => {
      this.reconcile(open);
      open.timers.push(setTimeout(check, RECONCILE_MS));
    };
    open.timers.push(setTimeout(check, RECONCILE_MS));
    // Nobody picks up: give up once the ring has run out.
    open.timers.push(setTimeout(() => this.open === open && !open.connected && void this.leave("no-answer"), this.o.ringMs ?? RING_MS));
    mesh.join();
    this.set({ busy: false, call: loaded.call, local, mic: local.getAudioTracks().length > 0, cam: local.getVideoTracks().length > 0, peers: [] });
    this.apply(open, loaded.call, loaded.members);
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

  private apply(open: Open, call: CallRow, raw: MemberRow[]) {
    const me = this.o.me.id;
    // Someone whose page just closed still counts as in the call for a little while (they're likely reloading).
    const now = Date.now();
    const members = raw.map((m) => {
      // Joined again after their goodbye: they're back, and the goodbye no longer counts.
      if (m.state === "joined") {
        for (const said of [open.away, open.gone]) if ((said.get(m.user_id) ?? Infinity) < Date.parse(m.updated_at)) said.delete(m.user_id);
      }
      const since = open.away.get(m.user_id);
      return m.state === "left" && since != null && now - since < AWAY_GRACE_MS ? { ...m, state: "joined" as const, seen_at: new Date(now).toISOString() } : m;
    });
    open.members = members;
    for (const m of members) if (m.user_id !== me && m.state !== "joined") open.mesh.dropUser(m.user_id);
    if (othersIn(members, me).length) open.connected = true;
    const reason = call.ended_at ? (open.connected ? "left" : endReason(members, me, false) ?? "no-answer") : endReason(members, me, open.connected);
    // The roster can show someone leaving before their goodbye says whether it was a hang-up or a reload: give the
    // goodbye a moment to arrive before ending the call on them.
    // Each departure gets its own wait (the same row, by its updated_at, only once).
    const unexplained = members.filter((m) => m.user_id !== me && m.state === "left" && !open.gone.has(m.user_id) && !open.away.has(m.user_id) && open.waited.get(m.user_id) !== m.updated_at);
    if (reason === "left" && !call.ended_at && unexplained.length) {
      for (const m of unexplained) open.waited.set(m.user_id, m.updated_at);
      open.timers.push(setTimeout(() => void this.refresh(open), 1500));
      this.set({ call, members });
      return;
    }
    // A ring that's still running keeps the call open even with nobody else in yet (endReason returns null).
    if (reason && (call.ended_at || open.connected || !members.some((m) => m.user_id !== me && m.state === "ringing"))) {
      void this.leave(reason);
      return;
    }
    this.set({ call, members, phase: othersIn(members, me).length ? "live" : "calling" });
    this.reconcile(open);
  }

  /**
   * Someone the roster has in the call but with no connection to us (a lost handshake message, a newcomer whose
   * hello came before the roster said they'd joined, a link dropped after a network blip): announce again.
   */
  private reconcile(open: Open) {
    if (this.open !== open) return;
    const linked = new Set(open.mesh.peers.map((p) => p.user));
    if (othersIn(open.members, this.o.me.id).some((m) => !linked.has(m.user_id))) open.mesh.rehello();
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
