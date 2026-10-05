import type { Color, PieceSymbol } from "chess.js";
import { CBURNETT } from "./cburnett";

/** dots: dot-matrix glyphs in the app's style · classic: the standard Staunton set · letters: K Q R B N P. */
export type PieceSet = "dots" | "classic" | "letters";

// Dot-matrix pieces on a 7×7 grid, in the same style as the app's numerals and icon.
// prettier-ignore
const GLYPHS: Record<PieceSymbol, string[]> = {
  k: ["...X...", "..XXX..", "...X...", ".XXXXX.", "..XXX..", ".XXXXX.", "XXXXXXX"],
  q: ["X..X..X", ".X.X.X.", ".XXXXX.", "..XXX..", "..XXX..", ".XXXXX.", "XXXXXXX"],
  r: ["X.X.X.X", "XXXXXXX", ".XXXXX.", ".XXXXX.", ".XXXXX.", "XXXXXXX", "XXXXXXX"],
  b: ["...X...", "..XXX..", ".XX.XX.", ".XXXXX.", "..XXX..", "...X...", ".XXXXX."],
  n: ["..X.X..", ".XXXXX.", "XXX.XXX", "XXXXXXX", "...XXXX", "..XXXX.", ".XXXXX."],
  p: [".......", "...X...", "..XXX..", "..XXX..", "...X...", "..XXX..", ".XXXXX."],
};

const DOTS = Object.fromEntries(
  Object.entries(GLYPHS).map(([k, rows]) => [k, rows.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "X" ? [[c * 10 + 5, r * 10 + 5]] : [])))]),
) as Record<PieceSymbol, number[][]>;

/** White pieces in the foreground colour, black in the accent red (dots and letters sets). */
export const pieceColor = (color: Color) => (color === "w" ? "var(--color-fg)" : "var(--color-red)");

/**
 * `outlined`: the piece sits on a light classic board (wood/green), where the theme's white would vanish,
 * so white dot/letter pieces get a fixed near-white fill with a dark edge.
 */
export function Piece({ type, color, set = "dots", outlined = false, className = "" }: { type: PieceSymbol; color: Color; set?: PieceSet; outlined?: boolean; className?: string }) {
  const edged = outlined && color === "w";
  const fill = edged ? "var(--color-board-piece-light)" : pieceColor(color);
  const edge = edged ? "var(--color-board-outline)" : undefined;
  if (set === "classic") {
    // Trusted, static markup from ./cburnett (no user input).
    return <svg viewBox="0 0 45 45" className={className} aria-hidden dangerouslySetInnerHTML={{ __html: CBURNETT[color + type] }} />;
  }
  if (set === "letters") {
    return (
      <svg viewBox="0 0 70 70" className={className} aria-hidden>
        <circle cx={35} cy={35} r={31} fill="none" stroke={edge ?? fill} strokeWidth={2.5} strokeDasharray="0.1 6" strokeLinecap="round" />
        <text x={35} y={49} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={40} fontWeight={700} fill={fill} stroke={edge} strokeWidth={edge ? 4 : 0} paintOrder="stroke" strokeLinejoin="round">
          {type.toUpperCase()}
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 70 70" className={className} aria-hidden>
      {DOTS[type].map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={4.2} fill={fill} stroke={edge} strokeWidth={edge ? 1.6 : 0} />
      ))}
    </svg>
  );
}
