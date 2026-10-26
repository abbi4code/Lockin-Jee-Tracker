import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { material, onlineStatus } from "./display";
import type { OnlineGame } from "./rules";

describe("material", () => {
  it("counts captures from the moves", () => {
    const c = new Chess();
    for (const m of ["e4", "d5", "exd5", "Qxd5"]) c.move(m);
    const m = material(c, c.history({ verbose: true }));
    expect(m.lost).toEqual({ w: ["p"], b: ["p"] });
    expect(m.diff).toBe(0);
  });

  it("a pawn that promoted isn't shown as captured", () => {
    const c = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    c.move("a8=Q");
    const m = material(c, c.history({ verbose: true }));
    expect(m.lost).toEqual({ w: [], b: [] });
    expect(m.diff).toBe(9);
  });
});

describe("onlineStatus", () => {
  const row = (over: Partial<OnlineGame>): OnlineGame => ({ id: "g", white: "w", black: "b", white_name: "anu", black_name: "abhi", pgn: "", ply: 0, status: "over", result: null, reason: null, updated_at: "", ...over });
  const c = new Chess();

  it("says how a game ended, from your side", () => {
    expect(onlineStatus(row({ result: "1-0", reason: "abandonment" }), "w", c, null).text).toBe("abhi left the game. you win.");
    expect(onlineStatus(row({ result: "1-0", reason: "resignation" }), "b", c, null).text).toBe("you resigned. anu wins.");
    expect(onlineStatus(row({ result: "1/2-1/2", reason: "agreement" }), "b", c, null).text).toBe("draw by agreement.");
    expect(onlineStatus(row({ reason: "cancelled" }), "w", c, null).text).toBe("game cancelled.");
  });
});
