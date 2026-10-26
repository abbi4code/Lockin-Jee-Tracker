import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { ABANDON_MS, canClaimAbandoned, decide, parseAction, type Action, type OnlineGame, type Patch } from "./rules";

const W = "user-white";
const B = "user-black";
const NOW = Date.parse("2026-10-26T12:00:00Z");

function game(over: Partial<OnlineGame> = {}): OnlineGame {
  return { id: "g", white: W, black: B, white_name: "a", black_name: "b", pgn: "", ply: 0, status: "active", result: null, reason: null, draw_offer: null, moved_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), ...over };
}
/** A game after these SAN moves. */
function after(...sans: string[]) {
  const c = new Chess();
  for (const m of sans) c.move(m);
  return game({ pgn: c.pgn(), ply: sans.length });
}
const ok = (r: ReturnType<typeof decide>): Patch => {
  if ("error" in r) throw new Error(r.error);
  return r.patch;
};
const refused = (r: ReturnType<typeof decide>) => "error" in r;

describe("moves", () => {
  it("plays a legal move on your turn and records it", () => {
    const p = ok(decide(game(), W, { type: "move", ply: 0, from: "e2", to: "e4" }, NOW));
    expect(p.ply).toBe(1);
    expect(p.pgn).toContain("e4");
    expect(p.status).toBeUndefined();
    expect(p.moved_at).toBe(new Date(NOW).toISOString());
  });

  it("refuses a move out of turn, an illegal move, and a stale board", () => {
    expect(refused(decide(game(), B, { type: "move", ply: 0, from: "e7", to: "e5" }))).toBe(true);
    expect(refused(decide(game(), W, { type: "move", ply: 0, from: "e2", to: "e5" }))).toBe(true);
    expect(refused(decide(after("e4"), B, { type: "move", ply: 0, from: "e7", to: "e5" }))).toBe(true);
    expect(refused(decide(game(), "someone-else", { type: "move", ply: 0, from: "e2", to: "e4" }))).toBe(true);
  });

  it("decides checkmate itself (the client can't claim a result)", () => {
    const g = after("f3", "e5", "g4");
    const p = ok(decide(g, B, { type: "move", ply: 3, from: "d8", to: "h4" }));
    expect(p).toMatchObject({ status: "over", result: "0-1", reason: "checkmate" });
  });

  it("handles promotion", () => {
    const c = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    const g = game({ pgn: c.pgn(), ply: 0 });
    const p = ok(decide(g, W, { type: "move", ply: 0, from: "a7", to: "a8", promotion: "q" }));
    expect(p.pgn).toContain("a8=Q");
  });

  it("refuses moves once the game is over or before it starts", () => {
    expect(refused(decide(game({ status: "over", result: "1-0" }), W, { type: "move", ply: 0, from: "e2", to: "e4" }))).toBe(true);
    expect(refused(decide(game({ status: "waiting", black: null }), W, { type: "move", ply: 0, from: "e2", to: "e4" }))).toBe(true);
  });

  it("a move clears any draw offer", () => {
    expect(ok(decide(game({ draw_offer: "b" }), W, { type: "move", ply: 0, from: "e2", to: "e4" })).draw_offer).toBeNull();
  });
});

describe("resigning", () => {
  it("the other side wins, whoever's turn it is", () => {
    expect(ok(decide(game(), W, { type: "resign" }))).toMatchObject({ status: "over", result: "0-1", reason: "resignation" });
    expect(ok(decide(game(), B, { type: "resign" }))).toMatchObject({ result: "1-0" });
  });
});

describe("draw offers", () => {
  it("offer, then the other side accepts", () => {
    expect(ok(decide(game(), W, { type: "offer-draw" }))).toEqual({ draw_offer: "w" });
    expect(ok(decide(game({ draw_offer: "w" }), B, { type: "accept-draw" }))).toMatchObject({ status: "over", result: "1/2-1/2", reason: "agreement" });
  });

  it("you can't accept your own offer, or one that doesn't exist", () => {
    expect(refused(decide(game({ draw_offer: "w" }), W, { type: "accept-draw" }))).toBe(true);
    expect(refused(decide(game(), B, { type: "accept-draw" }))).toBe(true);
  });

  it("decline clears it", () => {
    expect(ok(decide(game({ draw_offer: "w" }), B, { type: "decline-draw" }))).toEqual({ draw_offer: null });
  });
});

describe("abandoned games", () => {
  const waiting = (ms: number) => game({ ply: 1, moved_at: new Date(NOW - ms).toISOString() }); // black to move

  it("white can claim once black has been silent on their move for 3 days", () => {
    expect(canClaimAbandoned(waiting(ABANDON_MS), "w", NOW)).toBe(true);
    expect(ok(decide(waiting(ABANDON_MS), W, { type: "claim-abandoned" }, NOW))).toMatchObject({ status: "over", result: "1-0", reason: "abandonment" });
  });

  it("not before 3 days, and not on your own move", () => {
    expect(refused(decide(waiting(ABANDON_MS - 60_000), W, { type: "claim-abandoned" }, NOW))).toBe(true);
    expect(refused(decide(waiting(ABANDON_MS), B, { type: "claim-abandoned" }, NOW))).toBe(true);
  });

  it("falls back to updated_at before the migration adds moved_at", () => {
    const g = game({ ply: 1, moved_at: undefined, updated_at: new Date(NOW - ABANDON_MS).toISOString() });
    expect(canClaimAbandoned(g, "w", NOW)).toBe(true);
  });
});

describe("cancelling an open game", () => {
  it("only white, only while waiting", () => {
    const open = game({ status: "waiting", black: null });
    expect(ok(decide(open, W, { type: "cancel" }))).toEqual({ status: "over", result: null, reason: "cancelled" });
    expect(refused(decide(game(), W, { type: "cancel" }))).toBe(true);
    expect(refused(decide(open, B, { type: "cancel" }))).toBe(true);
  });
});

describe("parseAction", () => {
  it("accepts well-formed actions and rejects anything else", () => {
    expect(parseAction({ type: "move", ply: 3, from: "e2", to: "e4" })).toEqual({ type: "move", ply: 3, from: "e2", to: "e4" });
    expect(parseAction({ type: "move", ply: 0, from: "a7", to: "a8", promotion: "q" })).toMatchObject({ promotion: "q" });
    expect(parseAction({ type: "resign", extra: 1 })).toEqual({ type: "resign" } satisfies Action);
    for (const bad of [null, "resign", { type: "move", ply: "1", from: "e2", to: "e4" }, { type: "move", ply: 1, from: "e9", to: "e4" }, { type: "move", ply: 1, from: "e7", to: "e8", promotion: "k" }, { type: "win" }]) {
      expect(parseAction(bad)).toBeNull();
    }
  });
});
