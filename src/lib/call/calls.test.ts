import { describe, expect, it } from "vitest";
import { contextKind, endReason, nameList, othersIn, pickIncoming, pickRejoin, present, type MemberRow } from "./calls";

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

describe("present", () => {
  it("joined with a recent heartbeat, or away (reloading) for under 20 s; never after a hang-up", () => {
    expect(present(row({ state: "joined", seen_at: ago(30) }), NOW)).toBe(true);
    expect(present(row({ state: "joined", seen_at: ago(100) }), NOW)).toBe(false);
    expect(present(row({ state: "away", updated_at: ago(10) }), NOW)).toBe(true);
    expect(present(row({ state: "away", updated_at: ago(21) }), NOW)).toBe(false);
    expect(present(row({ state: "left", updated_at: ago(1) }), NOW)).toBe(false);
  });

  it("an away person keeps the call going for the others, a hang-up doesn't", () => {
    const me = row({ state: "joined", invited_by: null, seen_at: ago(1) });
    expect(endReason([me, row({ user_id: "anu", state: "away", updated_at: ago(5) })], "me", true, NOW)).toBeNull();
    expect(endReason([me, row({ user_id: "anu", state: "left", updated_at: ago(5) })], "me", true, NOW)).toBe("left");
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
