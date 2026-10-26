import { Chess, type Color } from "chess.js";

// The server's referee for online chess. Players can't write public.chess_games themselves
// (20261026000000_chess_server.sql); every move, resignation, draw offer and claim goes through
// /api/chess/[id], which runs it through `decide` here. The game is replayed with chess.js, so an illegal move,
// a move out of turn or a made-up result is refused, not just hidden by the client.

export interface OnlineGame {
  id: string;
  white: string;
  black: string | null;
  white_name: string;
  black_name: string;
  pgn: string;
  ply: number;
  status: "waiting" | "active" | "over";
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  reason: string | null;
  /** The side with a draw offer on the table. Absent before the chess_server migration. */
  draw_offer?: Color | null;
  /** When the game last moved (or started). Absent before the chess_server migration; updated_at stands in. */
  moved_at?: string | null;
  updated_at: string;
}

export type Action =
  | { type: "move"; ply: number; from: string; to: string; promotion?: string }
  | { type: "resign" }
  | { type: "offer-draw" }
  | { type: "accept-draw" }
  | { type: "decline-draw" }
  | { type: "claim-abandoned" }
  | { type: "cancel" };

export type Patch = Partial<Pick<OnlineGame, "pgn" | "ply" | "status" | "result" | "reason" | "draw_offer" | "moved_at">>;

/** A side that hasn't moved on its turn for this long has abandoned the game: the other side may claim it. */
export const ABANDON_MS = 3 * 86_400_000;

const other = (c: Color): Color => (c === "w" ? "b" : "w");
const winFor = (c: Color): "1-0" | "0-1" => (c === "w" ? "1-0" : "0-1");

export const seatOf = (g: Pick<OnlineGame, "white" | "black">, user: string): Color | null => (g.white === user ? "w" : g.black === user ? "b" : null);

/** The game as chess.js sees it. */
export function replay(pgn: string) {
  const c = new Chess();
  if (pgn) c.loadPgn(pgn);
  return c;
}

/** How a position ends a game, or null while it goes on. */
export function endOf(c: Chess): Pick<OnlineGame, "result" | "reason"> | null {
  if (c.isCheckmate()) return { result: c.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (c.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (c.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "repetition" };
  if (c.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
  if (c.isDraw()) return { result: "1/2-1/2", reason: "the 50-move rule" };
  return null;
}

/** When the side to move started waiting: the last move, or the start of the game. */
export const waitingSince = (g: Pick<OnlineGame, "moved_at" | "updated_at">) => new Date(g.moved_at ?? g.updated_at).getTime();

/** Whether `me` may claim the game because the other side has gone quiet on its turn. */
export function canClaimAbandoned(g: OnlineGame, me: Color, now: number) {
  return g.status === "active" && g.ply % 2 === (me === "w" ? 1 : 0) && now - waitingSince(g) >= ABANDON_MS;
}

/** What `user` doing `action` changes in game `g`, or why it's refused. Pure: the caller writes the patch. */
export function decide(g: OnlineGame, user: string, action: Action, now = Date.now()): { patch: Patch } | { error: string } {
  const me = seatOf(g, user);
  if (!me) return { error: "you're not playing in this game." };
  const at = new Date(now).toISOString();

  if (action.type === "cancel") {
    if (g.status !== "waiting" || me !== "w") return { error: "only an open game you created can be cancelled." };
    return { patch: { status: "over", result: null, reason: "cancelled" } };
  }
  if (g.status !== "active") return { error: g.status === "waiting" ? "your opponent hasn't joined yet." : "this game is over." };

  switch (action.type) {
    case "move": {
      if (action.ply !== g.ply) return { error: "the board changed. it's been reloaded." };
      let c: Chess;
      try {
        c = replay(g.pgn);
      } catch {
        return { error: "this game's record is broken." };
      }
      if (c.turn() !== me) return { error: "it's not your move." };
      try {
        c.move({ from: action.from, to: action.to, promotion: action.promotion });
      } catch {
        return { error: "that move isn't legal." };
      }
      const end = endOf(c);
      // A move answers any draw offer: an offer from the other side is declined, and your own is withdrawn.
      return { patch: { pgn: c.pgn(), ply: c.history().length, draw_offer: null, moved_at: at, ...(end ? { status: "over", ...end } : {}) } };
    }
    case "resign":
      return { patch: { status: "over", result: winFor(other(me)), reason: "resignation", draw_offer: null } };
    case "offer-draw":
      if (g.draw_offer === other(me)) return { error: "they've already offered a draw. accept it instead." };
      return { patch: { draw_offer: me } };
    case "accept-draw":
      if (g.draw_offer !== other(me)) return { error: "there's no draw offer to accept." };
      return { patch: { status: "over", result: "1/2-1/2", reason: "agreement", draw_offer: null } };
    case "decline-draw":
      if (g.draw_offer !== other(me)) return { error: "there's no draw offer to decline." };
      return { patch: { draw_offer: null } };
    case "claim-abandoned":
      if (!canClaimAbandoned(g, me, now)) return { error: "you can claim the game once they've been away for 3 days on their move." };
      return { patch: { status: "over", result: winFor(me), reason: "abandonment", draw_offer: null } };
  }
}

/** Checks a request body is an Action (it comes from the network). */
export function parseAction(x: unknown): Action | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  const square = (s: unknown) => typeof s === "string" && /^[a-h][1-8]$/.test(s);
  switch (a.type) {
    case "move":
      if (!Number.isInteger(a.ply) || !square(a.from) || !square(a.to)) return null;
      if (a.promotion !== undefined && !(typeof a.promotion === "string" && /^[qrbn]$/.test(a.promotion))) return null;
      return { type: "move", ply: a.ply as number, from: a.from as string, to: a.to as string, ...(a.promotion ? { promotion: a.promotion as string } : {}) };
    case "resign":
    case "offer-draw":
    case "accept-draw":
    case "decline-draw":
    case "claim-abandoned":
    case "cancel":
      return { type: a.type };
    default:
      return null;
  }
}
