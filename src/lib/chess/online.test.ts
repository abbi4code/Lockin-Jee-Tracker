import { describe, expect, it } from "vitest";
import { moveLanded } from "./online";
import type { OnlineGame } from "./rules";

const at = (ply: number) => ({ id: "g", ply }) as OnlineGame;
const move = { type: "move", ply: 4, from: "e2", to: "e4" } as const;

describe("moveLanded", () => {
  it("is true once the saved game is past the move's ply", () => {
    expect(moveLanded(move, at(5))).toBe(true);
    // The opponent already answered too.
    expect(moveLanded(move, at(6))).toBe(true);
  });
  it("is false while the saved game is still at the move's ply", () => {
    expect(moveLanded(move, at(4))).toBe(false);
  });
  it("is false without a saved game", () => {
    expect(moveLanded(move, null)).toBe(false);
  });
  it("only counts moves", () => {
    expect(moveLanded({ type: "resign" }, at(9))).toBe(false);
  });
});
