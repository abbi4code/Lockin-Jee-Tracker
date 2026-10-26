import { PeerLink, type LinkMessage, type LinkStatus } from "./peer";

// Everyone in a call, connected pairwise (a mesh: fine for the handful of people a call here has). Setup messages
// travel over a `MeshSignal`, which in the app is a Supabase Realtime broadcast channel named with the call's
// secret key (lib/call/signal.ts); in the e2e test it's a BroadcastChannel. Plain TypeScript, no React.
//
// Each device in the call is a session (`sid`; a reload is a new session). Joining broadcasts "hello"; everyone
// already there answers with a "hello" addressed to the newcomer, so each side learns about the other exactly once.

/** Everything on the wire names its sender session and user; `to` addresses one session (absent: everyone). */
export type MeshWire = { from: string; user: string; to?: string } & (
  | { kind: "hello"; name: string; mic: boolean; cam: boolean }
  /** `away`: the page closed or reloaded (they may be back in a moment), not a hang-up. */
  | { kind: "bye"; away?: boolean }
  | { kind: "media"; mic: boolean; cam: boolean }
  | LinkMessage
);

export interface MeshSignal {
  send(m: MeshWire): void;
  /** Calls `cb` for each message from another session. Returns a function that stops listening. */
  listen(cb: (m: MeshWire) => void): () => void;
  /** Calls `cb` when the channel comes back after dropping (messages may have been lost meanwhile). */
  onReconnect?(cb: () => void): () => void;
}

export interface Peer {
  sid: string;
  user: string;
  name: string;
  stream: MediaStream | null;
  mic: boolean;
  cam: boolean;
  status: LinkStatus;
}

export interface MeshOptions {
  signal: MeshSignal;
  user: string;
  name: string;
  local: MediaStream;
  iceServers: RTCIceServer[];
  onChange: (peers: Peer[]) => void;
  /** Someone said goodbye; `away` when their page closed rather than them hanging up. */
  onBye?: (user: string, away: boolean) => void;
  /**
   * Whether `user` is in the call by the roster. The channel's messages carry a self-declared user id, so only the
   * roster's people are connected to (anyone else holding the channel key gets nothing).
   */
  admits?: (user: string) => boolean;
  /** Another session of yours (a second tab or device) joined: this one steps aside. */
  onMoved?: () => void;
  /** A peer whose connection stays down this long has gone (closed laptop, lost network) and is dropped. */
  dropAfterMs?: number;
}

const newSid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
/** Re-announcing (to repair a handshake) happens at most this often. */
const HELLO_EVERY_MS = 3000;
/** A handshake still not up after this long is restarted when the other side announces again (TURN can take seconds). */
const RETRY_AFTER_MS = 8000;

/** Outgoing video per copy, by how many people get one. Everyone's upload is split this many ways. */
export function videoBudget(others: number) {
  if (others <= 1) return { maxBitrate: 1_200_000, scaleDown: 1 };
  if (others <= 3) return { maxBitrate: 600_000, scaleDown: 1.5 };
  return { maxBitrate: 300_000, scaleDown: 2 };
}

export class Mesh {
  readonly sid = newSid();
  private links = new Map<string, { link: PeerLink; user: string; name: string; mic: boolean; cam: boolean }>();
  private mic = true;
  private cam = true;
  private stop: () => void;
  private stopReconnect: () => void;
  private sweep: ReturnType<typeof setInterval>;
  private left = false;
  private helloAt = 0;
  /** A new session turned away because its user was here on a working connection: user → that session. */
  private waiting = new Map<string, string>();

  constructor(private o: MeshOptions) {
    this.mic = o.local.getAudioTracks().some((t) => t.enabled);
    this.cam = o.local.getVideoTracks().some((t) => t.enabled);
    this.stop = o.signal.listen((m) => this.receive(m));
    // Messages sent while the channel was down are gone: announce again so every pair can (re)connect.
    this.stopReconnect = o.signal.onReconnect?.(() => this.rehello()) ?? (() => {});
    this.sweep = setInterval(() => this.dropDead(), 2000);
  }

  /** Announces this session; everyone already in the call connects to it. */
  join() {
    this.helloAt = Date.now();
    this.send({ kind: "hello", name: this.o.name, mic: this.mic, cam: this.cam });
  }

  /**
   * Announces again, to repair: someone the roster shows in the call has no working connection with us (a lost
   * handshake message, a dropped link). Rate-limited; a hello to a healthy pair changes nothing.
   */
  rehello() {
    if (Date.now() - this.helloAt >= HELLO_EVERY_MS) this.join();
  }

  /** Switches the mic or camera on or off (the tracks keep flowing, silent or black) and tells everyone. */
  setMedia(mic: boolean, cam: boolean) {
    this.mic = mic;
    this.cam = cam;
    for (const t of this.o.local.getAudioTracks()) t.enabled = mic;
    for (const t of this.o.local.getVideoTracks()) t.enabled = cam;
    this.send({ kind: "media", mic, cam });
  }

  /** Someone left according to the roster (their tab may have died without a "bye"). */
  dropUser(user: string) {
    for (const [sid, l] of this.links) if (l.user === user) this.close(sid);
    this.changed();
  }

  /** Says goodbye and closes every connection. The local stream is the caller's to stop. */
  leave(away = false) {
    if (this.left) return;
    this.send({ kind: "bye", ...(away ? { away } : {}) });
    this.left = true;
    this.stop();
    this.stopReconnect();
    clearInterval(this.sweep);
    for (const sid of [...this.links.keys()]) this.close(sid);
  }

  get peers(): Peer[] {
    return [...this.links].map(([sid, l]) => ({ sid, user: l.user, name: l.name, stream: l.link.stream, mic: l.mic, cam: l.cam, status: l.link.status }));
  }

  private receive(m: MeshWire) {
    if (this.left || m.from === this.sid || (m.to && m.to !== this.sid)) return;
    // Another session of mine (a second tab or device) joined the call: it takes over, this one steps aside.
    if (m.user === this.o.user) {
      if (m.kind === "hello") this.o.onMoved?.();
      return;
    }
    // Only connect to people the roster has in the call (a goodbye or media flag needs no such check).
    if ((m.kind === "hello" || m.kind === "sdp" || m.kind === "ice") && this.o.admits && !this.o.admits(m.user)) return;
    switch (m.kind) {
      case "hello": {
        const known = this.links.get(m.from);
        // A handshake that never came up: a fresh hello from them is a retry, so start it over.
        if (known && known.link.status !== "live" && known.link.downSince != null && Date.now() - known.link.downSince > RETRY_AFTER_MS) this.close(m.from);
        if (!this.links.has(m.from) && !this.mayLink(m.from, m.user)) {
          // Their other tab or device, most likely: connect to it once the old session's link closes (see close).
          this.waiting.set(m.user, m.from);
          return;
        }
        // Answer a broadcast hello first, so the newcomer knows us before any offer of ours arrives.
        if (!m.to) this.send({ kind: "hello", to: m.from, name: this.o.name, mic: this.mic, cam: this.cam });
        const l = this.link(m.from, m.user);
        Object.assign(l, { name: m.name, mic: m.mic, cam: m.cam });
        this.changed();
        return;
      }
      case "bye": {
        const user = this.links.get(m.from)?.user ?? m.user;
        this.close(m.from);
        this.changed();
        this.o.onBye?.(user, !!m.away);
        return;
      }
      case "media": {
        const l = this.links.get(m.from);
        if (l) Object.assign(l, { mic: m.mic, cam: m.cam });
        this.changed();
        return;
      }
      case "sdp":
      case "ice":
        // An offer can come before its sender's hello (a lost message, a reconnect): set the link up anyway.
        if (this.links.has(m.from) || this.mayLink(m.from, m.user)) this.link(m.from, m.user).link.handle(m);
        return;
    }
  }

  /**
   * Whether a new session `sid` of `user` may connect. Not while that user is here on another session whose
   * connection works: a session id is self-declared, so nobody can take over someone's live tile by claiming their id.
   * A reload is fine: the old session's connection is down (it said goodbye), so the new one replaces it.
   */
  private mayLink(sid: string, user: string) {
    for (const [other, l] of this.links) if (other !== sid && l.user === user && l.link.status === "live") return false;
    return true;
  }

  /** The link to session `sid`, made on first contact. A new session of someone already here replaces the old one. */
  private link(sid: string, user: string) {
    const known = this.links.get(sid);
    if (known) return known;
    for (const [other, l] of this.links) if (l.user === user) this.close(other);
    const link = new PeerLink({
      polite: this.sid < sid,
      local: this.o.local,
      iceServers: this.o.iceServers,
      send: (m) => this.send({ ...m, to: sid }),
      budget: () => videoBudget(this.links.size),
      onChange: () => this.changed(),
    });
    const entry = { link, user, name: "", mic: true, cam: true };
    this.links.set(sid, entry);
    this.retune();
    return entry;
  }

  private close(sid: string) {
    const l = this.links.get(sid);
    if (!l) return;
    l.link.close();
    this.links.delete(sid);
    this.retune();
    // Someone's new session was waiting for this one to go: introduce ourselves to it and connect.
    const next = this.waiting.get(l.user);
    if (next && next !== sid && !this.left && this.mayLink(next, l.user)) {
      this.waiting.delete(l.user);
      this.send({ kind: "hello", to: next, name: this.o.name, mic: this.mic, cam: this.cam });
      this.link(next, l.user);
    }
  }

  /** Drops links that never came up or stayed down too long, then announces again so they can be rebuilt. */
  private dropDead() {
    const limit = this.o.dropAfterMs ?? 20_000;
    let dropped = false;
    for (const [sid, l] of this.links) {
      if (l.link.downSince != null && Date.now() - l.link.downSince > limit) {
        this.close(sid);
        dropped = true;
      }
    }
    if (!dropped) return;
    this.changed();
    // Both of us may still be in the call (a network blip, a sleeping laptop): a hello lets the pair start over.
    // If they've really gone, nobody answers and nothing happens.
    this.rehello();
  }

  private retune() {
    const { maxBitrate, scaleDown } = videoBudget(this.links.size);
    for (const { link } of this.links.values()) void link.tune(maxBitrate, scaleDown);
  }

  private changed() {
    if (!this.left) this.o.onChange(this.peers);
  }

  private send(m: { kind: MeshWire["kind"]; to?: string } & Record<string, unknown>) {
    if (!this.left) this.o.signal.send({ ...m, from: this.sid, user: this.o.user } as MeshWire);
  }
}
