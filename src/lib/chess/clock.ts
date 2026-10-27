import type { Chess, Color, Square } from "chess.js";

// Chess clocks. A time control "3+2" means 3 minutes each, plus 2 seconds added to your clock after every move you
// make. Your clock runs only on your turn; if it reaches zero you lose, unless your opponent has nothing left that
// could ever checkmate you, which makes it a draw (FIDE Laws of Chess, Article 6.9). Like lichess, the clocks start
// once both sides have made their first move, so nobody loses time while the game is being set up. Used by the
// local game and by the server's referee for online games (lib/chess/rules.ts).

export interface TimeControl {
  /** Seconds each player starts with. */
  base: number;
  /** Seconds added after each of your moves. */
  inc: number;
}

/** What the chess page offers: minutes each, and seconds added per move (0: nothing added). */
export const MINUTES = [1, 3, 5, 10, 15, 30] as const;
export const INCREMENTS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60] as const;

/** "10+5" → 10 minutes each, 5 seconds added per move. "none" (or anything else) → no clock. */
export function parseTc(id: string | null | undefined): TimeControl | null {
  const m = /^(\d+)\+(\d+)$/.exec(id ?? "");
  if (!m) return null;
  const minutes = Number(m[1]);
  const inc = Number(m[2]);
  if (minutes < 1 || minutes > 60 || inc > 60) return null;
  return { base: minutes * 60, inc };
}
export const label = (tc: TimeControl) => `${tc.base / 60}+${tc.inc}`;

/** The first move of each side is free: clocks run from this ply on (white's clock starts after black's first move). */
export const CLOCK_FROM_PLY = 2;
/** Under this, a clock shows tenths and turns red. */
export const LOW_MS = 10_000;

/** Milliseconds left for each side (for the side to move: as of when its clock started running). */
export interface Clocks {
  w: number;
  b: number;
}

export const fresh = (tc: TimeControl): Clocks => ({ w: tc.base * 1000, b: tc.base * 1000 });

/** Whether the side to move's clock is running at `ply`. */
export const running = (ply: number, over: boolean) => !over && ply >= CLOCK_FROM_PLY;

/** Each side's time at `now`: the side to move has been using its time since `since`. */
export function timeLeft(c: Clocks, toMove: Color, ply: number, since: number, now: number, over = false): Clocks {
  if (!running(ply, over)) return c;
  return { ...c, [toMove]: Math.max(0, c[toMove] - (now - since)) };
}

/**
 * The clocks after `mover` moves at `ply` (the ply before the move): their time used is taken off and the
 * increment added. Null if their time had already run out, so the move doesn't count.
 */
export function afterMove(c: Clocks, tc: TimeControl, mover: Color, ply: number, since: number, now: number): Clocks | null {
  if (ply < CLOCK_FROM_PLY) return c;
  const left = c[mover] - (now - since);
  if (left <= 0) return null;
  return { ...c, [mover]: left + tc.inc * 1000 };
}

const squareShade = (sq: Square) => (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2;

/**
 * Whether `color` could checkmate by any series of legal moves with what's on the board (FIDE 6.9). A pawn, rook or
 * queen always can. A lone knight, or bishops all on one colour, can only with the other side's help: they need it
 * to have something that blocks its own king (for bishops, anything but bishops on the same colour).
 */
export function canMate(game: Chess, color: Color) {
  const all = game.board().flat().filter((p): p is NonNullable<typeof p> => !!p && p.type !== "k");
  const mine = all.filter((p) => p.color === color);
  const theirs = all.filter((p) => p.color !== color);
  if (mine.some((p) => p.type === "p" || p.type === "r" || p.type === "q")) return true;
  if (!mine.length) return false;
  const bishops = mine.filter((p) => p.type === "b");
  if (bishops.length === mine.length && new Set(bishops.map((p) => squareShade(p.square))).size === 1) {
    const shade = squareShade(bishops[0].square);
    return theirs.some((p) => !(p.type === "b" && squareShade(p.square) === shade));
  }
  if (mine.length === 1) return theirs.length > 0; // a lone knight
  return true; // two knights, or a knight and a bishop, or bishops on both colours
}

/** The result when `flagged` runs out of time: a loss, or a draw if the other side can't mate. */
export function timeoutResult(game: Chess, flagged: Color) {
  const winner: Color = flagged === "w" ? "b" : "w";
  if (!canMate(game, winner)) return { result: "1/2-1/2" as const, reason: "timeout vs insufficient material", winner: null };
  return { result: winner === "w" ? ("1-0" as const) : ("0-1" as const), reason: "time", winner };
}

/** "4:59", "0:42", and under ten seconds "9.4". */
export function formatClock(ms: number) {
  if (ms < LOW_MS) return (Math.max(0, Math.floor(ms / 100)) / 10).toFixed(1);
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
