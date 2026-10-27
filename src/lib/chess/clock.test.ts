import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { afterMove, canMate, CLOCK_FROM_PLY, formatClock, fresh, label, parseTc, timeLeft, timeoutResult } from "./clock";

const T = 1_000_000;
const tc = { base: 180, inc: 2 };

describe("clocks", () => {
  it("each side's first move is free", () => {
    const c = fresh(tc);
    expect(afterMove(c, tc, "w", 0, T, T + 50_000)).toEqual(c);
    expect(afterMove(c, tc, "b", 1, T, T + 50_000)).toEqual(c);
    expect(timeLeft(c, "w", 1, T, T + 50_000)).toEqual(c);
    expect(CLOCK_FROM_PLY).toBe(2);
  });

  it("takes off the time used and adds the increment", () => {
    const c = afterMove(fresh(tc), tc, "w", 2, T, T + 10_000)!;
    expect(c.w).toBe(180_000 - 10_000 + 2_000);
    expect(c.b).toBe(180_000);
    expect(timeLeft(c, "b", 3, T, T + 4_000).b).toBe(176_000);
  });

  it("a move after the time ran out doesn't count", () => {
    expect(afterMove({ w: 5_000, b: 9_000 }, tc, "w", 4, T, T + 5_000)).toBeNull();
    expect(timeLeft({ w: 5_000, b: 9_000 }, "w", 4, T, T + 9_000).w).toBe(0);
  });

  it("stops when the game is over", () => {
    expect(timeLeft({ w: 5_000, b: 9_000 }, "w", 4, T, T + 9_000, true).w).toBe(5_000);
  });

  it("formats like a chess clock", () => {
    expect(formatClock(180_000)).toBe("3:00");
    expect(formatClock(61_200)).toBe("1:02");
    expect(formatClock(9_460)).toBe("9.4");
    expect(formatClock(0)).toBe("0.0");
    expect(formatClock(3_600_000)).toBe("1:00:00");
  });

  it("reads any minutes + seconds, with nothing added allowed", () => {
    expect(parseTc("10+5")).toEqual({ base: 600, inc: 5 });
    expect(parseTc("15+0")).toEqual({ base: 900, inc: 0 });
    expect(parseTc("30+45")).toEqual({ base: 1800, inc: 45 });
    expect(label(parseTc("3+2")!)).toBe("3+2");
    expect(parseTc("none")).toBeNull();
    expect(parseTc("0+5")).toBeNull();
    expect(parseTc("10+99")).toBeNull();
    expect(parseTc("abc")).toBeNull();
  });

  it("with nothing added, a move just takes its time off", () => {
    const tc = { base: 600, inc: 0 };
    expect(afterMove(fresh(tc), tc, "w", 2, T, T + 7_000)!.w).toBe(593_000);
  });
});

describe("running out of time (FIDE 6.9)", () => {
  const at = (fen: string) => new Chess(fen);
  it("is a loss when the opponent could still mate", () => {
    // White flags; black has a rook.
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/r3K3 w - - 0 1"), "w")).toMatchObject({ result: "0-1", reason: "time" });
  });
  it("is a draw when the opponent has only a king", () => {
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), "w")).toMatchObject({ result: "1/2-1/2" });
  });
  it("judges lone minor pieces by what the flagged side has", () => {
    // A lone knight or bishop can't mate a bare king…
    expect(canMate(at("4k3/8/8/8/8/8/8/n3K3 w - - 0 1"), "b")).toBe(false);
    expect(canMate(at("4k3/8/8/8/8/8/8/b3K3 w - - 0 1"), "b")).toBe(false);
    // …but can if the other side has a piece that can block its own king.
    expect(canMate(at("4k3/8/8/8/8/8/P7/n3K3 w - - 0 1"), "b")).toBe(true);
    // Bishops all on one colour against bishops of that colour: never.
    expect(canMate(at("4k3/8/8/8/8/8/1B6/b3K3 w - - 0 1"), "b")).toBe(false);
    // Bishops on both colours, or two knights: possible.
    expect(canMate(at("4k3/8/8/8/8/8/8/bb2K3 w - - 0 1"), "b")).toBe(true);
    expect(canMate(at("4k3/8/8/8/8/8/8/nn2K3 w - - 0 1"), "b")).toBe(true);
    expect(canMate(at("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "b")).toBe(false);
  });
});
