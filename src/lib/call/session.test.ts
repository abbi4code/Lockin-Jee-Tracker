import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallRow, Invitee, MemberRow, MemberState } from "./calls";
import type { MeshWire } from "./mesh";
import { CallSession, type CallBackend, type SessionState } from "./session";

// A call's lifecycle on this device, against an in-memory database. Real media and connections are covered by the
// browser test (.claude/context.md §9); here nobody's peer connection ever comes up, which is all this layer needs.

class FakePeer {
  connectionState = "new";
  signalingState = "stable";
  onnegotiationneeded = null;
  onicecandidate = null;
  ontrack = null;
  onconnectionstatechange = null;
  addTrack() {}
  getSenders() {
    return [];
  }
  close() {}
}

function stream(kinds: ("audio" | "video")[] = ["audio", "video"]) {
  const tracks = kinds.map((kind) => ({ kind, enabled: true, stop: vi.fn() }));
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === "audio"), getVideoTracks: () => tracks.filter((t) => t.kind === "video") } as unknown as MediaStream;
}

const ME = "me";
const now = () => new Date().toISOString();

/** An in-memory stand-in for the calls tables and their database functions. */
class FakeDb implements CallBackend {
  calls = new Map<string, { call: CallRow; members: MemberRow[] }>();
  watchers = new Map<string, Set<() => void>>();
  sent: MeshWire[] = [];
  notified: string[] = [];
  heartbeats = 0;
  startError: string | null = null;
  private n = 0;

  async start(context: string, invitees: Invitee[], myName: string) {
    if (this.startError) throw new Error(this.startError);
    // Like start_call: the coach's id is looked up on the server.
    if (context === "coach") invitees = [{ id: "coach", name: "coach" }];
    let c = [...this.calls.values()].find((x) => x.call.context === context && !x.call.ended_at);
    if (!c) {
      const id = `call${++this.n}`;
      c = { call: { id, key: "k", created_by: ME, context, created_at: now(), ended_at: null }, members: [] };
      this.calls.set(id, c);
    }
    this.put(c.call.id, ME, "joined", myName);
    for (const i of invitees) if (this.member(c.call.id, i.id)?.state !== "joined") this.put(c.call.id, i.id, "ringing", i.name);
    return c.call.id;
  }
  async setState(call: string, state: "joined" | "left" | "declined", name?: string) {
    const c = this.calls.get(call)!;
    if (state === "joined" && c.call.ended_at) throw new Error("this call has ended.");
    this.put(call, ME, state, name);
  }
  async heartbeat() {
    this.heartbeats++;
  }
  async load(call: string) {
    const c = this.calls.get(call)!;
    return { call: { ...c.call }, members: c.members.map((m) => ({ ...m })) };
  }
  watch(call: string, onChange: () => void) {
    const set = this.watchers.get(call) ?? new Set();
    set.add(onChange);
    this.watchers.set(call, set);
    return () => void set.delete(onChange);
  }
  private hear: ((m: MeshWire) => void) | null = null;
  signal() {
    return { send: (m: MeshWire) => void this.sent.push(m), listen: (cb: (m: MeshWire) => void) => ((this.hear = cb), () => {}), close: () => {} };
  }
  /** A message from someone else on the call's channel. */
  deliver(m: MeshWire) {
    this.hear?.(m);
  }
  async iceServers() {
    return [];
  }
  notify(call: string) {
    this.notified.push(call);
  }
  async mine() {
    return [];
  }
  watchMine() {
    return () => {};
  }
  beacons: string[] = [];
  beacon(call: string) {
    this.beacons.push(call);
  }

  member(call: string, user: string) {
    return this.calls.get(call)?.members.find((m) => m.user_id === user);
  }
  /** Someone's row changes (as the database would after their own set_call_state), and watchers hear of it. */
  put(call: string, user: string, state: MemberState, name?: string) {
    const c = this.calls.get(call)!;
    let m = c.members.find((x) => x.user_id === user);
    if (!m) c.members.push((m = { call, user_id: user, name: name ?? "", state, invited_by: ME, seen_at: null, updated_at: now() }));
    Object.assign(m, { state, updated_at: now(), ...(name ? { name } : {}), ...(state === "joined" ? { seen_at: now() } : {}) });
    // Like set_call_state: once nobody is in, the call ends and anyone still being rung missed it.
    if (!c.members.some((x) => x.state === "joined") && !c.call.ended_at) {
      c.call.ended_at = now();
      for (const x of c.members) if (x.state === "ringing") x.state = "missed";
    }
    for (const w of this.watchers.get(call) ?? []) w();
  }
}

function setup(media: () => Promise<MediaStream> = async () => stream()) {
  const db = new FakeDb();
  let state: SessionState | null = null;
  const s = new CallSession({ backend: db, me: { id: ME, name: "me" }, media, onChange: (x) => (state = x), ringMs: 60_000, heartbeatMs: 30_000 });
  return { db, s, state: () => state! };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const ANU = { id: "anu", name: "anu" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", FakePeer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("starting a call", () => {
  it("rings them, notifies, and waits", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    expect(state()).toMatchObject({ phase: "calling", busy: false });
    expect(db.member("call1", "anu")?.state).toBe("ringing");
    expect(db.notified).toEqual(["call1"]);
    expect(db.sent.map((m) => m.kind)).toEqual(["hello"]);
  });

  it("they pick up: live; they hang up: it ends for you too", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    expect(state().phase).toBe("live");
    db.put("call1", "anu", "left");
    // The roster changed but no goodbye came: it gives the goodbye a moment, then ends.
    await vi.advanceTimersByTimeAsync(1600);
    expect(state()).toMatchObject({ phase: "idle", notice: "left", local: null });
    expect(db.member("call1", ME)?.state).toBe("left");
  });

  it("a hang-up (their goodbye says so) ends it at once", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    db.deliver({ from: "s-anu", user: "anu", kind: "bye" });
    db.put("call1", "anu", "left");
    await flush();
    expect(state()).toMatchObject({ phase: "idle", notice: "left" });
  });

  it("their page reloads: the call waits for them, and they come back", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    db.put("call1", "anu", "left"); // the roster can even beat the goodbye
    db.deliver({ from: "s-anu", user: "anu", kind: "bye", away: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state().phase).toBe("live");
    db.put("call1", "anu", "joined");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state().phase).toBe("live");
  });

  it("each departure gets its own wait for the goodbye (not just the first one)", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    // First reload: roster first, then the goodbye; they come back.
    db.put("call1", "anu", "left");
    db.deliver({ from: "s1", user: "anu", kind: "bye", away: true });
    await vi.advanceTimersByTimeAsync(2000);
    db.put("call1", "anu", "joined");
    await flush();
    // Second reload, same order: still waited for, still held open.
    await vi.advanceTimersByTimeAsync(1000);
    db.put("call1", "anu", "left");
    await flush();
    expect(state().phase).toBe("live");
    db.deliver({ from: "s2", user: "anu", kind: "bye", away: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(state().phase).toBe("live");
  });

  it("your other tab or device joins: this one steps aside without leaving the roster", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    const local = state().local!;
    db.deliver({ from: "my-phone", user: ME, kind: "hello", name: "me", mic: true, cam: true });
    await flush();
    expect(state()).toMatchObject({ phase: "idle", notice: "moved" });
    expect(db.member("call1", ME)?.state).toBe("joined");
    expect(local.getTracks().every((t) => (t.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
  });

  it("someone in the roster with no connection to us: announces again (rate-limited)", async () => {
    const { db, s } = setup();
    await s.start("chess:g", [ANU]);
    const hellos = () => db.sent.filter((m) => m.kind === "hello").length;
    expect(hellos()).toBe(1);
    db.put("call1", "anu", "joined"); // in by the roster, but their hello never reached us
    await vi.advanceTimersByTimeAsync(5100);
    expect(hellos()).toBe(2);
    await vi.advanceTimersByTimeAsync(5100);
    expect(hellos()).toBe(3);
  });

  it("only people in the roster are connected to (the channel's user ids are self-declared)", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.deliver({ from: "intruder", user: "stranger", kind: "hello", name: "x", mic: true, cam: true });
    await flush();
    expect(state().peers).toEqual([]);
    expect(db.sent.filter((m) => m.kind === "hello" && m.to === "intruder")).toEqual([]);
  });

  it("their page closed and they don't come back: ends after the grace", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await flush();
    db.deliver({ from: "s-anu", user: "anu", kind: "bye", away: true });
    db.put("call1", "anu", "left");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(state().phase).toBe("live");
    await vi.advanceTimersByTimeAsync(2000);
    expect(state()).toMatchObject({ phase: "idle", notice: "left" });
  });

  it("no answer: gives up when the ring runs out, releasing the camera", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    const local = state().local!;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state()).toMatchObject({ phase: "idle", notice: "no-answer" });
    expect(db.member("call1", ME)?.state).toBe("left");
    expect(local.getTracks().every((t) => (t.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
  });

  it("declined by everyone: ends with that notice", async () => {
    const { db, s, state } = setup();
    await s.start("skribbl:r", [ANU, { id: "abhi", name: "abhi" }]);
    db.put("call1", "anu", "declined");
    await flush();
    expect(state().phase).toBe("calling");
    db.put("call1", "abhi", "declined");
    await flush();
    expect(state()).toMatchObject({ phase: "idle", notice: "declined" });
  });

  it("a group call carries on while anyone else is still in", async () => {
    const { db, s, state } = setup();
    await s.start("skribbl:r", [ANU, { id: "abhi", name: "abhi" }]);
    db.put("call1", "anu", "joined");
    db.put("call1", "abhi", "joined");
    await flush();
    db.put("call1", "anu", "left");
    await flush();
    expect(state().phase).toBe("live");
    db.put("call1", "abhi", "left");
    await vi.advanceTimersByTimeAsync(1600);
    expect(state()).toMatchObject({ phase: "idle", notice: "left" });
  });

  it("the server refuses: shows its reason and releases the camera", async () => {
    const local = stream();
    const { db, s, state } = setup(async () => local);
    db.startError = "you can only call your opponent in this game.";
    await s.start("chess:g", [ANU]);
    expect(state()).toMatchObject({ phase: "idle", busy: false, error: "you can only call your opponent in this game." });
    expect(local.getTracks().every((x) => (x.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
  });

  it("a declined one-to-one call ends; calling again starts a new one", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "declined");
    await flush();
    expect(state()).toMatchObject({ phase: "idle", notice: "declined" });
    await s.start("chess:g", [ANU]);
    expect(state()).toMatchObject({ phase: "calling", call: { id: "call2" } });
  });

  it("blocked camera and mic: says so and never rings anyone", async () => {
    const { db, s, state } = setup(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    await s.start("coach", []);
    expect(state()).toMatchObject({ phase: "idle", notice: "blocked" });
    expect(db.calls.size).toBe(0);
  });

  it("calling again while still ringing rings again instead of starting over", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    await s.start("chess:g", [ANU]);
    expect(db.calls.size).toBe(1);
    expect(db.member("call1", "anu")?.state).toBe("ringing");
    expect(db.notified).toEqual(["call1", "call1"]);
    expect(state().call?.id).toBe("call1");
  });

  it("calling from somewhere else leaves the current call first", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    await s.start("coach", []);
    expect(db.member("call1", ME)?.state).toBe("left");
    expect(state().call?.id).toBe("call2");
  });
});

describe("answering", () => {
  async function rung() {
    const t = setup();
    // anu calls us: their call exists with us ringing.
    t.db.calls.set("call9", { call: { id: "call9", key: "k", created_by: "anu", context: "coach", created_at: now(), ended_at: null }, members: [] });
    t.db.put("call9", "anu", "joined");
    t.db.put("call9", ME, "ringing");
    return t;
  }

  it("joining marks you in and goes live with them", async () => {
    const { db, s, state } = await rung();
    await s.join("call9");
    expect(db.member("call9", ME)?.state).toBe("joined");
    expect(db.member("call9", ME)?.name).toBe("me");
    expect(state().phase).toBe("live");
  });

  it("joining with the camera blocked declines it", async () => {
    const t = await rung();
    const blocked = new CallSession({ backend: t.db, me: { id: ME, name: "me" }, media: () => Promise.reject(new DOMException("no", "NotAllowedError")), onChange: () => {} });
    await blocked.join("call9");
    expect(t.db.member("call9", ME)?.state).toBe("declined");
  });

  it("a call that ended meanwhile: says so", async () => {
    const { db, s, state } = await rung();
    db.put("call9", "anu", "left");
    await s.join("call9");
    expect(state()).toMatchObject({ phase: "idle", error: "this call has ended." });
  });
});

describe("hanging up before the call is set up", () => {
  /** Media that only arrives when the test says so (the browser's permission prompt). */
  function slowMedia() {
    let give: (s: MediaStream) => void = () => {};
    const local = stream();
    return { local, media: () => new Promise<MediaStream>((r) => (give = r)), allow: () => give(local) };
  }

  it("during the camera prompt: the camera is let go as soon as it opens, and nobody is rung", async () => {
    const m = slowMedia();
    const { db, s, state } = setup(m.media);
    const started = s.start("chess:g", [ANU]);
    expect(state().busy).toBe(true);
    await s.leave();
    m.allow();
    await started;
    expect(m.local.getTracks().every((t) => (t.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
    expect(db.calls.size).toBe(0);
    expect(state()).toMatchObject({ phase: "idle", busy: false });
  });

  it("while start_call runs: you're taken back out of the call it made", async () => {
    const { db, s, state } = setup();
    const realStart = db.start.bind(db);
    let release: () => void = () => {};
    db.start = (...a: Parameters<FakeDb["start"]>) => new Promise<string>((r) => (release = () => void realStart(...a).then(r)));
    const started = s.start("chess:g", [ANU]);
    await flush();
    await s.leave();
    release();
    await started;
    await flush();
    expect(db.member("call1", ME)?.state).toBe("left");
    expect(db.calls.get("call1")?.call.ended_at).not.toBeNull();
    expect(db.member("call1", "anu")?.state).toBe("missed");
    expect(state().phase).toBe("idle");
  });

  it("while joining: marked back out, camera released", async () => {
    const t = setup();
    t.db.calls.set("call9", { call: { id: "call9", key: "k", created_by: "anu", context: "coach:me", created_at: now(), ended_at: null }, members: [] });
    t.db.put("call9", "anu", "joined");
    t.db.put("call9", ME, "ringing");
    const local = stream();
    const s = new CallSession({ backend: t.db, me: { id: ME, name: "me" }, media: async () => local, onChange: () => {} });
    const setState = t.db.setState.bind(t.db);
    let release: () => void = () => {};
    t.db.setState = (call, st, name) => (st === "joined" ? new Promise<void>((r) => (release = () => void setState(call, st, name).then(r))) : setState(call, st, name));
    const joining = s.join("call9");
    await flush();
    await s.leave();
    release();
    await joining;
    await flush();
    expect(t.db.member("call9", ME)?.state).toBe("left");
    expect(local.getTracks().every((x) => (x.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
  });
});

describe("in a call", () => {
  it("heartbeats while open, and stops after leaving", async () => {
    const { db, s } = setup();
    await s.start("chess:g", [ANU]);
    db.put("call1", "anu", "joined");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(db.heartbeats).toBe(2);
    await s.leave();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(db.heartbeats).toBe(2);
  });

  it("mic and camera switches: tracks go quiet and the others are told", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    s.toggleMic();
    s.toggleCam();
    expect(state()).toMatchObject({ mic: false, cam: false });
    expect(state().local!.getTracks().every((t) => !t.enabled)).toBe(true);
    expect(db.sent.at(-1)).toMatchObject({ kind: "media", mic: false, cam: false });
  });

  it("no camera: mic only, and the camera switch does nothing", async () => {
    const { s, state } = setup(async () => stream(["audio"]));
    await s.start("coach", []);
    expect(state().cam).toBe(false);
    s.toggleCam();
    expect(state().cam).toBe(false);
  });

  it("the page closing says goodbye at once, with a keepalive request", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    const local = state().local!;
    expect(s.pageHidden()).toBe("call1");
    expect(db.sent.at(-1)).toMatchObject({ kind: "bye", away: true });
    expect(db.beacons).toEqual(["call1"]);
    expect(state().phase).toBe("idle");
    expect(local.getTracks().every((t) => (t.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
  });

  it("leaving says goodbye on the channel and in the roster", async () => {
    const { db, s, state } = setup();
    await s.start("chess:g", [ANU]);
    await s.leave();
    expect(db.sent.at(-1)?.kind).toBe("bye");
    expect(db.member("call1", ME)?.state).toBe("left");
    expect(state()).toMatchObject({ phase: "idle", notice: null });
  });
});
