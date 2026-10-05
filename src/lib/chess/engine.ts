// A small chess engine for the /extras/chess opponent. chess.js handles the game itself (rules, SAN, history);
// it's too slow to search with (~10k positions/s), so this file has its own mailbox board and move generator
// (~50× faster), searched with alpha-beta + quiescence and iterative deepening against a time limit.

// 10×12 mailbox: squares 21..98, off-board cells hold OFF. Row 0 is rank 8.
const OFF = 99;
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6; // white positive, black negative

const KNIGHT = [-21, -19, -12, -8, 8, 12, 19, 21];
const BISHOP = [-11, -9, 9, 11];
const ROOK = [-10, -1, 1, 10];
const KING = [...BISHOP, ...ROOK];

const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

export interface Position {
  board: Int8Array;
  /** 1 = white to move, -1 = black. */
  side: 1 | -1;
  castling: number;
  /** En passant target square (mailbox index) or 0. */
  ep: number;
}

export interface Move {
  from: number;
  to: number;
  promo: number; // piece type, 0 if none
  /** For ordering: value of the captured piece type (0 = quiet). */
  capture: number;
}

const sq = (name: string) => 21 + (name.charCodeAt(0) - 97) + (8 - Number(name[1])) * 10;
const name = (s: number) => String.fromCharCode(97 + ((s - 21) % 10)) + (8 - Math.floor((s - 21) / 10));

export function fromFen(fen: string): Position {
  const [placement, turn, castle, ep] = fen.split(" ");
  const board = new Int8Array(120).fill(OFF);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) board[21 + r * 10 + f] = 0;
  const types: Record<string, number> = { p: P, n: N, b: B, r: R, q: Q, k: K };
  placement.split("/").forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        const t = types[ch.toLowerCase()];
        board[21 + r * 10 + f] = ch === ch.toUpperCase() ? t : -t;
        f++;
      }
    }
  });
  let castling = 0;
  if (castle.includes("K")) castling |= CASTLE_WK;
  if (castle.includes("Q")) castling |= CASTLE_WQ;
  if (castle.includes("k")) castling |= CASTLE_BK;
  if (castle.includes("q")) castling |= CASTLE_BQ;
  return { board, side: turn === "w" ? 1 : -1, castling, ep: ep && ep !== "-" ? sq(ep) : 0 };
}

/** Is `s` attacked by `by` (1 white, -1 black)? */
function attacked(b: Int8Array, s: number, by: 1 | -1): boolean {
  // Pawns attack diagonally forward: a white pawn attacks s from s+9 / s+11.
  if (by === 1 ? b[s + 9] === P || b[s + 11] === P : b[s - 9] === -P || b[s - 11] === -P) return true;
  for (const d of KNIGHT) if (b[s + d] === N * by) return true;
  for (const d of KING) if (b[s + d] === K * by) return true;
  for (const d of BISHOP) {
    let t = s + d;
    while (b[t] === 0) t += d;
    if (b[t] === B * by || b[t] === Q * by) return true;
  }
  for (const d of ROOK) {
    let t = s + d;
    while (b[t] === 0) t += d;
    if (b[t] === R * by || b[t] === Q * by) return true;
  }
  return false;
}

const kingSquare = (b: Int8Array, side: 1 | -1) => b.indexOf(K * side);
export const inCheck = (p: Position) => attacked(p.board, kingSquare(p.board, p.side), (-p.side) as 1 | -1);

/** Pseudo-legal moves (may leave the king in check; `make` rejects those). `capturesOnly` for quiescence. */
function generate(p: Position, capturesOnly = false): Move[] {
  const { board: b, side } = p;
  const out: Move[] = [];
  const add = (from: number, to: number, promo = 0) => out.push({ from, to, promo, capture: Math.abs(b[to]) });
  for (let s = 21; s <= 98; s++) {
    const piece = b[s] * side;
    if (piece <= 0 || piece === OFF) continue;
    if (piece === P) {
      const fwd = -10 * side;
      const lastRow = side === 1 ? s + fwd < 31 : s + fwd > 88;
      const pushPromo = (to: number) => {
        if (lastRow) for (const t of [Q, N, R, B]) add(s, to, t);
        else add(s, to);
      };
      if (!capturesOnly || lastRow) {
        if (b[s + fwd] === 0) {
          pushPromo(s + fwd);
          const startRow = side === 1 ? s >= 81 && s <= 88 : s >= 31 && s <= 38;
          if (startRow && b[s + 2 * fwd] === 0 && !capturesOnly) add(s, s + 2 * fwd);
        }
      }
      for (const d of [fwd - 1, fwd + 1]) {
        const t = s + d;
        if (b[t] !== OFF && b[t] * side < 0) pushPromo(t);
        else if (t === p.ep) out.push({ from: s, to: t, promo: 0, capture: P });
      }
      continue;
    }
    const slide = piece === B || piece === R || piece === Q;
    const dirs = piece === N ? KNIGHT : piece === B ? BISHOP : piece === R ? ROOK : KING;
    for (const d of dirs) {
      let t = s + d;
      while (b[t] !== OFF) {
        if (b[t] * side > 0) break;
        if (b[t] !== 0) {
          add(s, t);
          break;
        }
        if (!capturesOnly) add(s, t);
        if (!slide) break;
        t += d;
      }
    }
    if (piece === K && !capturesOnly) {
      const enemy = (-side) as 1 | -1;
      const home = side === 1 ? 95 : 25;
      if (s === home && !attacked(b, s, enemy)) {
        const [kRight, qRight] = side === 1 ? [CASTLE_WK, CASTLE_WQ] : [CASTLE_BK, CASTLE_BQ];
        if (p.castling & kRight && b[s + 1] === 0 && b[s + 2] === 0 && b[s + 3] === R * side && !attacked(b, s + 1, enemy) && !attacked(b, s + 2, enemy)) add(s, s + 2);
        if (p.castling & qRight && b[s - 1] === 0 && b[s - 2] === 0 && b[s - 3] === 0 && b[s - 4] === R * side && !attacked(b, s - 1, enemy) && !attacked(b, s - 2, enemy)) add(s, s - 2);
      }
    }
  }
  return out;
}

interface Undo {
  captured: number;
  castling: number;
  ep: number;
  capturedAt: number;
}

/** Plays a move in place. Returns undo info, or null (and leaves the position unchanged) if it leaves the king in check. */
function make(p: Position, m: Move): Undo | null {
  const b = p.board;
  const side = p.side;
  const piece = b[m.from];
  const type = piece * side;
  const undo: Undo = { captured: b[m.to], castling: p.castling, ep: p.ep, capturedAt: m.to };
  // En passant: the captured pawn sits behind the target square.
  if (type === P && m.to === p.ep) {
    undo.capturedAt = m.to + 10 * side;
    undo.captured = b[undo.capturedAt];
    b[undo.capturedAt] = 0;
  }
  b[m.to] = m.promo ? m.promo * side : piece;
  b[m.from] = 0;
  if (type === K && Math.abs(m.to - m.from) === 2) {
    const [rookFrom, rookTo] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    b[rookTo] = b[rookFrom];
    b[rookFrom] = 0;
  }
  p.ep = type === P && Math.abs(m.to - m.from) === 20 ? (m.from + m.to) / 2 : 0;
  // Castling rights vanish when the king or a rook moves, or a rook is captured on its corner.
  for (const s of [m.from, m.to]) {
    if (s === 95) p.castling &= ~(CASTLE_WK | CASTLE_WQ);
    if (s === 25) p.castling &= ~(CASTLE_BK | CASTLE_BQ);
    if (s === 98) p.castling &= ~CASTLE_WK;
    if (s === 91) p.castling &= ~CASTLE_WQ;
    if (s === 28) p.castling &= ~CASTLE_BK;
    if (s === 21) p.castling &= ~CASTLE_BQ;
  }
  p.side = (-side) as 1 | -1;
  if (attacked(b, kingSquare(b, side), p.side)) {
    unmake(p, m, undo);
    return null;
  }
  return undo;
}

function unmake(p: Position, m: Move, u: Undo) {
  const b = p.board;
  p.side = (-p.side) as 1 | -1;
  const side = p.side;
  const moved = b[m.to];
  b[m.from] = m.promo ? P * side : moved;
  b[m.to] = 0;
  b[u.capturedAt] = u.captured;
  if (Math.abs(b[m.from]) === K && Math.abs(m.to - m.from) === 2) {
    const [rookFrom, rookTo] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    b[rookFrom] = b[rookTo];
    b[rookTo] = 0;
  }
  p.castling = u.castling;
  p.ep = u.ep;
}

/** Legal moves only. */
export function legalMoves(p: Position): Move[] {
  return generate(p).filter((m) => {
    const u = make(p, m);
    if (!u) return false;
    unmake(p, m, u);
    return true;
  });
}

/** Counts leaf positions at `depth`; used to check the move generator against chess.js. */
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of generate(p)) {
    const u = make(p, m);
    if (!u) continue;
    n += perft(p, depth - 1);
    unmake(p, m, u);
  }
  return n;
}

// ── Evaluation: material + piece-square tables (the "simplified evaluation function"), white's view ──
const VALUE = [0, 100, 320, 330, 500, 900, 20000];
// prettier-ignore
const PST: number[][] = [
  [],
  [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
];

/** Score from the side to move's point of view. */
function evaluate(p: Position): number {
  const b = p.board;
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const v = b[21 + r * 10 + f];
      if (!v) continue;
      const t = Math.abs(v);
      // Tables are written from white's side (row 0 = rank 8); black reads them mirrored.
      score += v > 0 ? VALUE[t] + PST[t][r * 8 + f] : -(VALUE[t] + PST[t][(7 - r) * 8 + f]);
    }
  }
  return score * p.side;
}

const MATE = 100_000;

class Timeout extends Error {}

/** Captures first, most valuable victim first; promotions count as captures of a queen. */
const order = (moves: Move[]) => moves.sort((a, c) => c.capture * 10 + (c.promo ? 900 : 0) - (a.capture * 10 + (a.promo ? 900 : 0)));

function search(p: Position, deadline: number) {
  let nodes = 0;
  const tick = () => {
    if (++nodes % 2048 === 0 && performance.now() > deadline) throw new Timeout();
  };

  const quiesce = (alpha: number, beta: number): number => {
    tick();
    const stand = evaluate(p);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    for (const m of order(generate(p, true))) {
      const u = make(p, m);
      if (!u) continue;
      const score = -quiesce(-beta, -alpha);
      unmake(p, m, u);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    tick();
    if (depth === 0) return quiesce(alpha, beta);
    let legal = 0;
    for (const m of order(generate(p))) {
      const u = make(p, m);
      if (!u) continue;
      legal++;
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      unmake(p, m, u);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    // No legal move: checkmate (prefer the quickest) or stalemate.
    if (!legal) return inCheck(p) ? -MATE + ply : 0;
    return alpha;
  };

  /**
   * Scores every root move at `depth`, best first. `exact` searches each move with a full window so every score
   * is real (needed to pick among near-best moves); otherwise worse moves only get an upper bound, which is faster.
   */
  const root = (moves: Move[], depth: number, exact: boolean) => {
    const scored: { move: Move; score: number }[] = [];
    let alpha = -Infinity;
    for (const m of moves) {
      const u = make(p, m)!;
      const score = -negamax(depth - 1, -Infinity, exact ? Infinity : -alpha + 1, 1);
      unmake(p, m, u);
      scored.push({ move: m, score });
      alpha = Math.max(alpha, score);
    }
    return scored.sort((a, c) => c.score - a.score);
  };

  return { root, nodes: () => nodes };
}

export type Level = "easy" | "medium" | "hard";

const LIMITS: Record<Level, { depth: number; ms: number; slack: number }> = {
  // Easy looks one move ahead and picks loosely among moves within ~1.5 pawns of the best.
  easy: { depth: 1, ms: 300, slack: 150 },
  medium: { depth: 3, ms: 800, slack: 15 },
  hard: { depth: 8, ms: 2000, slack: 0 },
};

/** The engine's move for a FEN, as { from, to, promotion } squares, or null if there's no legal move. */
export function bestMove(fen: string, level: Level): { from: string; to: string; promotion?: string } | null {
  const p = fromFen(fen);
  const legal = order(legalMoves(p));
  if (!legal.length) return null;
  const { depth, ms, slack } = LIMITS[level];
  const deadline = performance.now() + ms;
  const s = search(p, deadline);
  let best = [{ move: legal[0], score: 0 }];
  // Iterative deepening: each finished depth refines the answer; a timeout keeps the last finished one.
  for (let d = 1; d <= depth; d++) {
    try {
      const scored = s.root(best.length > 1 ? best.map((x) => x.move) : legal, d, slack > 0);
      best = scored;
      if (Math.abs(scored[0].score) > MATE - 100) break; // found a forced mate
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  const top = best[0].score;
  const pool = best.filter((x) => x.score >= top - slack);
  const pick = pool[Math.floor(Math.random() * pool.length)].move;
  return { from: name(pick.from), to: name(pick.to), ...(pick.promo ? { promotion: " pnbrqk"[pick.promo] } : {}) };
}
