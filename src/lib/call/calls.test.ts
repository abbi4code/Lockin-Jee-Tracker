import { describe, expect, it } from "vitest";
import { contextKind, endReason, nameList, othersIn, pickIncoming, pickRejoin, type MemberRow } from "./calls";
import type { MeshWire } from "./mesh";
import { channelSignal } from "./signal";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const row = (over: Partial<MemberRow>): MemberRow => ({ call: "c", user_id: "me", name: "", state: "ringing", invited_by: "anu", seen_at: null, updated_at: ago(5), ...over });

describe("pickIncoming", () => {
  it("shows your newest fresh ring from someone else", () => {
    const rows = [row({ call: "old", updated_at: ago(30) }), row({ call: "new", updated_at: ago(2) })];
    expect(pickIncoming(rows, "me", NOW)?.call).toBe("new");
  });

  it("not a ring that's run out, one you started, or one you've answered", () => {
    expect(pickIncoming([row({ updated_at: ago(61) })], "me", NOW)).toBeNull();
    expect(pickIncoming([row({ invited_by: "me" })], "me", NOW)).toBeNull();
    expect(pickIncoming([row({ state: "joined" }), row({ state: "declined" })], "me", NOW)).toBeNull();
  });
});

describe("pickRejoin", () => {
  it("offers a call you're still in by the roster when no device of yours is heartbeating it", () => {
    expect(pickRejoin([row({ state: "joined", seen_at: ago(60) })], "me", NOW)?.call).toBe("c");
    expect(pickRejoin([row({ state: "joined", seen_at: ago(91) })], "me", NOW)).toBeNull();
    expect(pickRejoin([row({ state: "left", seen_at: ago(60) })], "me", NOW)).toBeNull();
  });

  it("not while another tab or device of yours is in it (its heartbeat is recent)", () => {
    expect(pickRejoin([row({ state: "joined", seen_at: ago(5) })], "me", NOW)).toBeNull();
    expect(pickRejoin([row({ state: "joined", seen_at: ago(40) })], "me", NOW)).toBeNull();
  });
});

describe("endReason", () => {
  const me = row({ state: "joined", invited_by: null, seen_at: ago(1) });
  it("goes on while anyone else is in or still being rung", () => {
    expect(endReason([me, row({ user_id: "anu", state: "joined", seen_at: ago(10) })], "me", true, NOW)).toBeNull();
    expect(endReason([me, row({ user_id: "anu", state: "ringing", updated_at: ago(10) })], "me", false, NOW)).toBeNull();
  });

  it("says why it's over", () => {
    expect(endReason([me, row({ user_id: "anu", state: "left" })], "me", true, NOW)).toBe("left");
    expect(endReason([me, row({ user_id: "anu", state: "declined" }), row({ user_id: "abhi", state: "declined" })], "me", false, NOW)).toBe("declined");
    expect(endReason([me, row({ user_id: "anu", state: "declined" }), row({ user_id: "abhi", state: "missed" })], "me", false, NOW)).toBe("no-answer");
    // A ring that ran out, or someone whose heartbeat stopped (their tab died), doesn't keep it going.
    expect(endReason([me, row({ user_id: "anu", state: "ringing", updated_at: ago(70) })], "me", false, NOW)).toBe("no-answer");
    expect(endReason([me, row({ user_id: "anu", state: "joined", seen_at: ago(100) })], "me", true, NOW)).toBe("left");
  });

  it("othersIn counts only live members other than you", () => {
    const rows = [me, row({ user_id: "anu", state: "joined", seen_at: ago(5) }), row({ user_id: "abhi", state: "joined", seen_at: ago(200) }), row({ user_id: "x", state: "ringing" })];
    expect(othersIn(rows, "me", NOW).map((m) => m.user_id)).toEqual(["anu"]);
  });
});

describe("labels", () => {
  it("contextKind and nameList", () => {
    expect(contextKind("chess:abc")).toBe("chess");
    expect(contextKind("skribbl:abc")).toBe("skribbl");
    expect(contextKind("coach")).toBeNull();
    expect(nameList(["anu"])).toBe("anu");
    expect(nameList(["anu", "", "abhi"])).toBe("anu and abhi");
    expect(nameList(["a", "b", "c"])).toBe("a, b and c");
    expect(nameList(["a", "b", "c", "d", "e"])).toBe("a, b and 3 more");
  });
});

describe("channelSignal", () => {
  function fakeChannel() {
    let handler: (m: { payload: unknown }) => void = () => {};
    let status: (s: string) => void = () => {};
    const sends: { payload: MeshWire }[] = [];
    const ch = {
      on: (_t: string, _f: unknown, h: typeof handler) => ((handler = h), ch),
      subscribe: (cb: typeof status) => ((status = cb), ch),
      send: async (m: { payload: MeshWire }) => (sends.push(m), "ok"),
    };
    return { ch, sends, receive: (payload: unknown) => handler({ payload }), status: (s: string) => status(s) };
  }
  const hello: MeshWire = { from: "a", user: "u", kind: "hello", name: "a", mic: true, cam: true };

  it("holds messages until the channel is joined, then sends them in order", () => {
    const f = fakeChannel();
    const s = channelSignal(f.ch as never);
    s.send(hello);
    s.send({ from: "a", user: "u", kind: "bye" });
    expect(f.sends).toEqual([]);
    f.status("SUBSCRIBED");
    s.send(hello);
    expect(f.sends.map((m) => m.payload.kind)).toEqual(["hello", "bye", "hello"]);
    expect(f.sends[0]).toMatchObject({ type: "broadcast", event: "call" });
  });

  it("passes on call messages only, until unsubscribed", () => {
    const f = fakeChannel();
    const s = channelSignal(f.ch as never);
    const got: MeshWire[] = [];
    const stop = s.listen((m) => got.push(m));
    f.receive(hello);
    f.receive({ hello: 1 });
    f.receive({ from: "a", kind: "bye" }); // no user
    f.receive(null);
    stop();
    f.receive(hello);
    expect(got).toEqual([hello]);
  });
});
