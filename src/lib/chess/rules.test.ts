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

describe("clocks", () => {
  const timed = (over: Partial<OnlineGame> = {}) => ({ time_base: 180, time_inc: 2, white_ms: 180_000, black_ms: 180_000, ...over });
  /** A timed game after these moves, last moved at NOW. */
  const timedAfter = (sans: string[], over: Partial<OnlineGame> = {}) => ({ ...after(...sans), ...timed(over) });

  it("the first move of each side is free", () => {
    const p = ok(decide({ ...game(), ...timed() }, W, { type: "move", ply: 0, from: "e2", to: "e4" }, NOW + 60_000));
    expect(p.white_ms).toBe(180_000);
  });

  it("takes the time used off the mover and adds the increment", () => {
    const p = ok(decide(timedAfter(["e4", "e5"]), W, { type: "move", ply: 2, from: "g1", to: "f3" }, NOW + 10_000));
    expect(p.white_ms).toBe(172_000);
    expect(p.black_ms).toBe(180_000);
    expect(p.moved_at).toBe(new Date(NOW + 10_000).toISOString());
  });

  it("a move after your time ran out loses on time instead", () => {
    const p = ok(decide(timedAfter(["e4", "e5"], { white_ms: 5_000 }), W, { type: "move", ply: 2, from: "g1", to: "f3" }, NOW + 6_000));
    expect(p).toMatchObject({ status: "over", result: "0-1", reason: "time", white_ms: 0 });
    expect(p.pgn).toBeUndefined();
  });

  it("either player can report a flag, but only once it has really fallen", () => {
    const g = timedAfter(["e4", "e5"], { white_ms: 5_000 });
    expect(decide(g, B, { type: "flag" }, NOW + 4_000)).toEqual({ error: "not yet." });
    expect(ok(decide(g, B, { type: "flag" }, NOW + 5_000))).toMatchObject({ status: "over", result: "0-1", reason: "time" });
    expect(ok(decide(g, W, { type: "flag" }, NOW + 5_000))).toMatchObject({ result: "0-1" });
    expect(decide(after("e4", "e5"), B, { type: "flag" }, NOW + 5_000)).toEqual({ error: "this game has no clock." });
  });

  it("running out against a bare king is a draw", () => {
    const g: OnlineGame = { ...game({ pgn: "", ply: 40 }), ...timed({ white_ms: 1_000 }) };
    // Rebuild the game from a position: white (to move) has a rook, black only a king.
    const c = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    const flagged = { ...g, pgn: c.pgn() };
    expect(ok(decide(flagged, B, { type: "flag" }, NOW + 2_000))).toMatchObject({ result: "1/2-1/2", reason: "timeout vs insufficient material" });
  });

  it("untimed games are unchanged", () => {
    const p = ok(decide(after("e4", "e5"), W, { type: "move", ply: 2, from: "g1", to: "f3" }, NOW + 999_000));
    expect(p.white_ms).toBeUndefined();
    expect(parseAction({ type: "flag" })).toEqual({ type: "flag" });
  });
});
