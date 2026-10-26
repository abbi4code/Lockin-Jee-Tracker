import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { bestMove, fromFen, perft } from "./engine";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
const POS3 = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
const POS4 = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1";
const POS5 = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8";

const play = (fen: string, m: { from: string; to: string; promotion?: string }) => {
  const c = new Chess(fen);
  c.move(m);
  return c;
};

describe("move generator", () => {
  it.each([
    ["start", START, 4, 197281],
    ["kiwipete", KIWIPETE, 3, 97862],
    ["pos3", POS3, 5, 674624],
    ["pos4", POS4, 4, 422333],
    ["pos5", POS5, 3, 62379],
  ])("perft %s", (_, fen, depth, nodes) => {
    expect(perft(fromFen(fen), depth)).toBe(nodes);
  });

  it("matches chess.js perft at depth 2", () => {
    for (const fen of [START, KIWIPETE, POS3, POS4, POS5]) expect(perft(fromFen(fen), 2)).toBe(new Chess(fen).perft(2));
  });
});

// Hard has slack 0, so these never touch Math.random.
describe("bestMove", () => {
  it("finds mate in one", () => {
    expect(bestMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "hard")).toEqual({ from: "a1", to: "a8" });
  });

  it("still mates when the mating move would also reach the 50-move limit", () => {
    expect(bestMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80", "hard")).toEqual({ from: "a1", to: "a8" });
  });

  it("avoids repeating a position when winning", () => {
    const x = "8/8/8/4k3/8/8/8/3QK3 w - - 10 40";
    const first = bestMove(x, "hard")!;
    const y = play(x, first).fen();
    const second = bestMove(x, "hard", [y, y])!;
    expect(second).not.toEqual(first);
    expect(play(x, second).fen()).not.toBe(y);
  }, 10_000);

  it("steers into a repetition when losing", () => {
    // Black is a queen and rook down; Nb8 undevelops the knight but recreates the first position.
    const g = new Chess("1n2k3/8/8/8/8/8/8/R2QK3 w - - 0 1");
    const history: string[] = [];
    for (const m of ["Qd2", "Nc6", "Qd1"]) {
      history.push(g.fen());
      g.move(m);
    }
    const move = bestMove(g.fen(), "hard", history)!;
    expect(move).toEqual({ from: "c6", to: "b8" });
    expect(play(g.fen(), move).fen().split(" ").slice(0, 4)).toEqual(history[0].split(" ").slice(0, 4));
  }, 10_000);

  it("takes a 50-move draw instead of a capture when losing", () => {
    // Kxe4 wins a pawn but resets the clock in a lost ending; any quiet king move ends the game drawn.
    const fen = "8/8/8/4k2p/4P3/8/8/R2QK3 b - - 99 90";
    const move = bestMove(fen, "hard")!;
    expect(play(fen, move).isDrawByFiftyMoves()).toBe(true);
    // Control: with a fresh clock the same position grabs the pawn.
    expect(bestMove(fen.replace(" 99 ", " 0 "), "hard")).toEqual({ from: "e5", to: "e4" });
  }, 10_000);
});
