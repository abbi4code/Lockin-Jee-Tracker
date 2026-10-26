import type { Chess, Color, PieceSymbol } from "chess.js";
import type { OnlineGame } from "./rules";

// What the chess screen shows about a game, kept out of the component so it can be tested.

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER: PieceSymbol[] = ["q", "r", "b", "n", "p"];

/**
 * Pieces each side has lost, and the material balance (positive = white ahead). Losses come from the moves, not
 * from counting the board, so a pawn that promoted isn't shown as captured.
 */
export function material(game: Chess, moves: { color: Color; captured?: PieceSymbol }[]) {
  const lost: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  for (const m of moves) if (m.captured) lost[m.color === "w" ? "b" : "w"].push(m.captured);
  for (const c of ["w", "b"] as Color[]) lost[c].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  let diff = 0;
  for (const row of game.board()) for (const p of row) if (p) diff += p.color === "w" ? VALUE[p.type] : -VALUE[p.type];
  return { lost, diff };
}

/** The status line for an online game, from your side. */
export function onlineStatus(row: OnlineGame | null, color: Color | null, game: Chess, error: string | null) {
  if (error) return { text: error, over: true };
  if (!row) return { text: "connecting…", over: false };
  const name = (c: Color) => (c === color ? "you" : (c === "w" ? row.white_name : row.black_name) || (c === "w" ? "white" : "black"));
  if (row.status === "waiting") return { text: color === "w" ? "waiting for your opponent. send them the link." : "joining…", over: false };
  if (row.status === "over") {
    if (!row.result) return { text: "game cancelled.", over: true };
    if (row.result === "1/2-1/2") return { text: `draw by ${row.reason ?? "agreement"}.`, over: true };
    const winner: Color = row.result === "1-0" ? "w" : "b";
    const loser: Color = winner === "w" ? "b" : "w";
    const win = name(winner) === "you" ? "you win." : `${name(winner)} wins.`;
    if (row.reason === "resignation") return { text: `${name(loser)} resigned. ${win}`, over: true };
    if (row.reason === "abandonment") return { text: `${name(loser)} left the game. ${win}`, over: true };
    return { text: `checkmate. ${win}`, over: true };
  }
  const check = game.inCheck() ? " check!" : "";
  return { text: game.turn() === color ? `your move.${check}` : `${name(game.turn())} to move.${check}`, over: false };
}
