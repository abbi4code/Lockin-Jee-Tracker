"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Flag, FlipVertical2, Globe, Maximize2, Minimize2, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Piece, type PieceSet } from "../components/chess/Piece";
import { buzz, Segmented } from "../components/Controls";
import { Page } from "../components/Shell";
import { fadeUp, Label, Section } from "../components/ui";
import type { Level } from "../lib/chess/engine";
import { createGame, myGames, useOnlineGame, type OnlineGame } from "../lib/chess/online";
import { useProgress } from "../store/progress";

type Mode = "two" | "cpu";
type BoardStyle = "app" | "wood" | "green";
interface Saved {
  pgn: string;
  mode: Mode;
  level: Level;
  you: Color;
  flipped: boolean;
  pieces: PieceSet;
  board: BoardStyle;
}

/** Square colours, move hints and coordinate colours per board. "app" follows the night / paper / sepia theme. */
const BOARDS: Record<BoardStyle, { light: string; dark: string; hint: string; move: string; coord: [onLight: string, onDark: string] }> = {
  app: {
    light: "var(--color-sq-light)",
    dark: "var(--color-sq-dark)",
    hint: "color-mix(in srgb, var(--color-fg) 35%, transparent)",
    move: "color-mix(in srgb, var(--color-fg) 10%, transparent)",
    coord: ["var(--color-dim)", "var(--color-dim)"],
  },
  wood: {
    light: "var(--color-board-wood-light)",
    dark: "var(--color-board-wood-dark)",
    hint: "var(--color-board-hint)",
    move: "var(--color-board-move)",
    coord: ["var(--color-board-wood-dark)", "var(--color-board-wood-light)"],
  },
  green: {
    light: "var(--color-board-green-light)",
    dark: "var(--color-board-green-dark)",
    hint: "var(--color-board-hint)",
    move: "var(--color-board-move)",
    coord: ["var(--color-board-green-dark)", "var(--color-board-green-light)"],
  },
};

const KEY = "lockin-chess";
const FILES = "abcdefgh";
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
/** The computer never answers faster than this, so its move doesn't land the instant yours does. */
const MIN_THINK_MS = 400;

/** The engine runs in a web worker (bundled as its own entry), so searching never freezes the board. */
function spawnEngine() {
  return new Worker(new URL("../lib/chess/engine.worker.ts", import.meta.url), { type: "module" });
}

function load(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
function persist(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: the game just isn't remembered.
  }
}

/** Pieces each side has lost, and the material balance (positive = white ahead). */
function material(game: Chess) {
  const left: Record<Color, Record<PieceSymbol, number>> = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
  for (const row of game.board()) for (const p of row) if (p) left[p.color][p.type]++;
  const lost = (c: Color) => (["q", "r", "b", "n", "p"] as PieceSymbol[]).flatMap((t) => Array<PieceSymbol>(Math.max(START[t] - left[c][t], 0)).fill(t));
  const score = (c: Color) => (Object.keys(left[c]) as PieceSymbol[]).reduce((n, t) => n + left[c][t] * VALUE[t], 0);
  return { lost: { w: lost("w"), b: lost("b") }, diff: score("w") - score("b") };
}

function status(game: Chess, mode: Mode, you: Color, thinking: boolean) {
  const name = (c: Color) => (mode === "cpu" ? (c === you ? "you" : "computer") : c === "w" ? "white" : "black");
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "b" : "w";
    return { text: mode === "cpu" ? (winner === you ? "checkmate. you win." : "checkmate. computer wins.") : `checkmate. ${name(winner)} wins.`, over: true };
  }
  if (game.isStalemate()) return { text: "stalemate. it's a draw.", over: true };
  if (game.isThreefoldRepetition()) return { text: "draw by repetition.", over: true };
  if (game.isInsufficientMaterial()) return { text: "draw. not enough pieces to mate.", over: true };
  if (game.isDraw()) return { text: "draw by the 50-move rule.", over: true };
  if (thinking) return { text: "computer is thinking…", over: false };
  const check = game.inCheck() ? " check!" : "";
  if (mode === "cpu") return { text: game.turn() === you ? `your move.${check}` : `computer to move.${check}`, over: false };
  return { text: `${name(game.turn())} to move.${check}`, over: false };
}

/** How a game that just ended should be recorded online (empty while it's still going). */
function endState(game: Chess): Partial<Pick<OnlineGame, "status" | "result" | "reason">> {
  if (game.isCheckmate()) return { status: "over", result: game.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (game.isStalemate()) return { status: "over", result: "1/2-1/2", reason: "stalemate" };
  if (game.isThreefoldRepetition()) return { status: "over", result: "1/2-1/2", reason: "repetition" };
  if (game.isInsufficientMaterial()) return { status: "over", result: "1/2-1/2", reason: "insufficient material" };
  if (game.isDraw()) return { status: "over", result: "1/2-1/2", reason: "the 50-move rule" };
  return {};
}

function onlineStatus(row: OnlineGame | null, color: Color | null, game: Chess, error: string | null) {
  if (error) return { text: error, over: true };
  if (!row) return { text: "connecting…", over: false };
  const name = (c: Color) => (c === color ? "you" : (c === "w" ? row.white_name : row.black_name) || (c === "w" ? "white" : "black"));
  if (row.status === "waiting") return { text: color === "w" ? "waiting for your opponent. send them the link." : "joining…", over: false };
  if (row.status === "over") {
    if (row.result === "1/2-1/2") return { text: `draw by ${row.reason ?? "agreement"}.`, over: true };
    const winner: Color = row.result === "1-0" ? "w" : "b";
    const loser: Color = winner === "w" ? "b" : "w";
    const win = name(winner) === "you" ? "you win." : `${name(winner)} wins.`;
    return { text: row.reason === "resignation" ? `${name(loser) === "you" ? "you" : name(loser)} resigned. ${win}` : `checkmate. ${win}`, over: true };
  }
  const check = game.inCheck() ? " check!" : "";
  return { text: game.turn() === color ? `your move.${check}` : `${name(game.turn())} to move.${check}`, over: false };
}

/** A side's name, the pieces it has captured and its material lead, shown above and below the board. */
function PlayerStrip({ label, captured, capturedColor, lead, active, set }: { label: string; captured: PieceSymbol[]; capturedColor: Color; lead: number; active: boolean; set: PieceSet }) {
  return (
    <div className="flex h-8 items-center gap-3">
      <span className={`size-1.5 rounded-full ${active ? "bg-red" : "bg-dot-off"}`} />
      <span className={`font-mono text-[13px] ${active ? "text-fg" : "text-mute"}`}>{label}</span>
      <div className="flex min-w-0 items-center">
        {captured.map((t, i) => (
          <Piece key={i} type={t} color={capturedColor} set={set} className="-mr-1 size-4 opacity-70" />
        ))}
      </div>
      {lead > 0 && <span className="font-mono text-[12px] text-mute">+{lead}</span>}
    </div>
  );
}

/** Local play at /extras/chess; with `gameId`, an online game against another signed-in player. */
export function ChessScreen({ gameId }: { gameId?: string } = {}) {
  const game = useRef(new Chess());
  const [version, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((v) => v + 1), []);
  const router = useRouter();
  const myName = useProgress((s) => s.settings.name) || "player";
  const online = !!gameId;
  const net = useOnlineGame(gameId, myName, game, rerender);
  const [games, setGames] = useState<{ me: string | null; games: OnlineGame[] }>({ me: null, games: [] });
  const [onlineMsg, setOnlineMsg] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<Mode>("two");
  const [level, setLevel] = useState<Level>("medium");
  const [you, setYou] = useState<Color>("w");
  const [flipped, setFlipped] = useState(false);
  const [pieces, setPieces] = useState<PieceSet>("dots");
  const [boardStyle, setBoardStyle] = useState<BoardStyle>("app");
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [dragging, setDragging] = useState<Square | null>(null);
  const [loaded, setLoaded] = useState(false);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const board = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: Square } | null>(null);
  const moveList = useRef<HTMLDivElement>(null);

  const g = game.current;
  const history = g.history({ verbose: true });
  const last = history.at(-1);
  const ply = history.length;
  const st = online ? onlineStatus(net.row, net.color, g, net.error) : status(g, mode, you, thinking);
  const cpuTurn = !online && mode === "cpu" && g.turn() !== you && !st.over;

  // Restore the saved game once, in the browser.
  useEffect(() => {
    const saved = load();
    if (saved) {
      try {
        if (saved.pgn && !gameId) game.current.loadPgn(saved.pgn);
      } catch {
        game.current.reset();
      }
      setMode(saved.mode ?? "two");
      setLevel(saved.level ?? "medium");
      setYou(saved.you ?? "w");
      setFlipped(!!saved.flipped);
      setPieces(saved.pieces ?? "dots");
      setBoardStyle(saved.board ?? "app");
    }
    setLoaded(true);
    rerender();
    if (!gameId) myGames().then(setGames);
    return () => worker.current?.terminate();
  }, [gameId, rerender]);

  useEffect(() => {
    if (!loaded) return;
    // An online game lives on the server: only the look is saved here, and the local game is left alone.
    if (gameId) {
      const saved = load();
      persist({ pgn: saved?.pgn ?? "", mode: saved?.mode ?? "two", level: saved?.level ?? "medium", you: saved?.you ?? "w", flipped: saved?.flipped ?? false, pieces, board: boardStyle });
    } else persist({ pgn: game.current.pgn(), mode, level, you, flipped, pieces, board: boardStyle });
  }, [loaded, gameId, version, mode, level, you, flipped, pieces, boardStyle]);

  // Full screen: the board fills the window (and the browser goes full screen where it can; iPhones can't,
  // so there it's just the in-app layout). Esc or the button exits; "f" toggles on a keyboard.
  const enterFull = () => {
    setFull(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const exitFull = () => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "f") (document.fullscreenElement || full ? exitFull : enterFull)();
      if (e.key === "Escape" && full) exitFull();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = full ? "hidden" : "";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);

  // The computer's turn: ask the worker, apply its answer unless the game changed meanwhile.
  useEffect(() => {
    if (!loaded || !cpuTurn) return;
    const id = ++request.current;
    const started = performance.now();
    setThinking(true);
    worker.current ??= spawnEngine();
    worker.current.onmessage = (e: MessageEvent<{ id: number; move: { from: string; to: string; promotion?: string } | null }>) => {
      if (e.data.id !== request.current) return;
      window.setTimeout(
        () => {
          if (e.data.id !== request.current) return;
          setThinking(false);
          if (e.data.move) {
            try {
              game.current.move(e.data.move);
              buzz(8);
            } catch {
              // The engine and chess.js disagreed; leave the position for the player.
            }
          }
          rerender();
        },
        Math.max(0, MIN_THINK_MS - (performance.now() - started)),
      );
    };
    worker.current.postMessage({ id, fen: game.current.fen(), level });
    // Mode, level or position changed before the answer came: forget it.
    return () => {
      if (request.current === id) {
        request.current++;
        setThinking(false);
      }
    };
  }, [loaded, cpuTurn, ply, level]);

  useEffect(() => {
    moveList.current?.scrollTo({ top: moveList.current.scrollHeight, behavior: "smooth" });
  }, [ply]);

  const canMove = (sq: Square) => {
    const p = g.get(sq);
    if (online) return !!p && p.color === g.turn() && p.color === net.color && net.row?.status === "active" && !promotion;
    return !!p && p.color === g.turn() && !st.over && !promotion && !thinking && !(mode === "cpu" && p.color !== you);
  };
  const targets = selected ? g.moves({ square: selected, verbose: true }) : [];
  const targetSquares = new Set(targets.map((m) => m.to));

  const play = (from: Square, to: Square, promo?: PieceSymbol) => {
    const options = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return false;
    if (options.some((m) => m.promotion) && !promo) {
      setPromotion({ from, to });
      return true;
    }
    g.move({ from, to, promotion: promo });
    setSelected(null);
    setPromotion(null);
    buzz(g.isCheckmate() ? 30 : 8);
    rerender();
    if (online) net.send(endState(g));
    return true;
  };

  const squareAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-square]")?.dataset.square as Square | undefined;
  const moveFloating = (x: number, y: number) => {
    const rect = board.current!.getBoundingClientRect();
    const size = rect.width / 8;
    floating.current!.style.transform = `translate(${x - rect.left - size / 2}px, ${y - rect.top - size / 2}px)`;
  };

  // Click a piece then a square, or drag the piece there. Works the same with a mouse and a finger.
  const onPointerDown = (e: PointerEvent) => {
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq || promotion) return;
    if (selected && targetSquares.has(sq)) {
      play(selected, sq);
      return;
    }
    if (canMove(sq)) {
      setSelected(sq);
      drag.current = { from: sq };
      setDragging(sq);
      board.current!.setPointerCapture(e.pointerId);
      moveFloating(e.clientX, e.clientY);
    } else setSelected(null);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current) moveFloating(e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag.current) return;
    const { from } = drag.current;
    drag.current = null;
    setDragging(null);
    const to = squareAt(e.clientX, e.clientY);
    if (to && to !== from && !play(from, to)) setSelected(null);
  };

  const undo = () => {
    request.current++; // drop any answer the computer is still working on
    setThinking(false);
    setPromotion(null);
    setSelected(null);
    if (mode === "cpu") {
      // Take back to your last turn (your move and the computer's reply).
      do g.undo();
      while (g.history().length && g.turn() !== you);
    } else g.undo();
    buzz();
    rerender();
  };
  const newGame = () => {
    request.current++;
    setThinking(false);
    setPromotion(null);
    setSelected(null);
    g.reset();
    buzz(12);
    rerender();
  };

  const startOnline = async () => {
    setOnlineMsg("creating game…");
    try {
      const id = await createGame(myName);
      setOnlineMsg(null);
      router.push(`/extras/chess/${id}`);
    } catch (e) {
      setOnlineMsg(e instanceof Error ? e.message : "Couldn't create the game.");
    }
  };
  const resign = () => {
    if (!confirmResign) return setConfirmResign(true);
    setConfirmResign(false);
    buzz(20);
    net.send({ status: "over", result: net.color === "w" ? "0-1" : "1-0", reason: "resignation" });
  };
  const inviteUrl = gameId && typeof window !== "undefined" ? `${window.location.origin}/extras/chess/${gameId}` : "";
  const copyInvite = async () => {
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "chess on lockin.", url: inviteUrl });
      else {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  // Your side at the bottom (online, or playing the computer); white otherwise. "flip" turns it around.
  const bottomColor: Color = online ? (net.color ?? "w") : mode === "cpu" ? you : "w";
  const whiteBottom = (bottomColor === "w") !== flipped;
  const ranks = whiteBottom ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = whiteBottom ? [...FILES] : [...FILES].reverse();
  const mat = material(g);
  const sideLabel = (c: Color) => {
    const colorName = c === "w" ? "white" : "black";
    if (online) {
      const n = c === "w" ? net.row?.white_name : net.row?.black_name;
      if (c === net.color) return `you · ${colorName}`;
      return n ? `${n} · ${colorName}` : `waiting · ${colorName}`;
    }
    return mode === "cpu" ? (c === you ? `you · ${colorName}` : `computer · ${level}`) : colorName;
  };
  const top: Color = whiteBottom ? "b" : "w";
  const bottom: Color = whiteBottom ? "w" : "b";
  const strip = (c: Color) => (
    <PlayerStrip label={sideLabel(c)} captured={mat.lost[c === "w" ? "b" : "w"]} capturedColor={c === "w" ? "b" : "w"} lead={c === "w" ? mat.diff : -mat.diff} active={!st.over && g.turn() === c} set={pieces} />
  );
  const checkSquare = g.inCheck() ? g.board().flat().find((p) => p?.type === "k" && p.color === g.turn())?.square : undefined;
  const look = BOARDS[boardStyle];
  // Classic black pieces would vanish on the app's near-black squares: give them a faint light edge there.
  const pieceEdge = (c: Color) => (pieces === "classic" && c === "b" && boardStyle === "app" ? { filter: "drop-shadow(0 0 1px var(--color-mute))" } : undefined);
  const pairs = Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => [history[i * 2], history[i * 2 + 1]]);

  return (
    <Page>
      <motion.header variants={fadeUp} className="flex items-baseline justify-between pb-6">
        <div className="flex items-baseline gap-3">
          <Link href="/extras" className="font-mono text-[12px] text-mute transition hover:text-fg">
            extras /
          </Link>
          <span className="dot text-lg">chess</span>
        </div>
        <span className={`font-mono text-[13px] ${st.over ? "text-red" : "text-mute"}`}>{st.text}</span>
      </motion.header>

      {/* Laptops: the board as big as the screen height allows, controls and moves beside it. */}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-14">
        <motion.div
          variants={fadeUp}
          className={full ? "fixed inset-0 z-[60] flex items-center justify-center bg-ink px-3 py-3" : "mx-auto w-full lg:col-span-7 lg:max-w-[min(100%,calc(100dvh-230px))]"}
        >
          <div className={full ? "w-[min(100%,calc(100dvh-130px))]" : ""}>
          {full && (
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className={`truncate font-mono text-[13px] ${st.over ? "text-red" : "text-mute"}`}>{st.text}</span>
              <div className="flex shrink-0 gap-1.5">
                <button onClick={undo} disabled={!ply || online} aria-label="undo" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                  <Undo2 className="size-4" />
                </button>
                <button onClick={() => setFlipped((v) => !v)} aria-label="flip board" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
                  <FlipVertical2 className="size-4" />
                </button>
                <button onClick={exitFull} aria-label="exit full screen" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
                  <Minimize2 className="size-4" />
                </button>
              </div>
            </div>
          )}
          {strip(top)}
          <div
            ref={board}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(null);
            }}
            className="relative my-2 grid aspect-square w-full touch-none grid-cols-8 overflow-hidden rounded-md border border-line-2 select-none"
          >
            {ranks.flatMap((rank, r) =>
              files.map((file, f) => {
                const sq = `${file}${rank}` as Square;
                const light = (FILES.indexOf(file) + rank) % 2 === 0; // a1 is dark
                const piece = g.get(sq);
                const isTarget = targetSquares.has(sq);
                return (
                  <div key={sq} data-square={sq} className="relative" style={{ background: light ? look.light : look.dark }}>
                    {(last?.from === sq || last?.to === sq) && <div className="absolute inset-0" style={{ background: look.move }} />}
                    {selected === sq && <div className="absolute inset-0 bg-fg/20" />}
                    {checkSquare === sq && <div className="absolute inset-0" style={{ background: "radial-gradient(circle, var(--color-red) 0%, transparent 70%)", opacity: 0.55 }} />}
                    {f === 0 && <span className="absolute top-0 left-0.5 font-mono text-[9px] leading-none lg:top-0.5 lg:left-1 lg:text-[10px]" style={{ color: look.coord[light ? 0 : 1] }}>{rank}</span>}
                    {r === 7 && <span className="absolute right-0.5 bottom-0 font-mono text-[9px] leading-none lg:right-1 lg:bottom-0.5 lg:text-[10px]" style={{ color: look.coord[light ? 0 : 1] }}>{file}</span>}
                    {piece && (
                      <div className={`absolute transition-opacity ${pieces === "classic" ? "inset-[4%]" : "inset-[16%]"} ${dragging === sq ? "opacity-25" : ""}`} style={pieceEdge(piece.color)}>
                        <Piece type={piece.type} color={piece.color} set={pieces} outlined={boardStyle !== "app"} className="size-full" />
                      </div>
                    )}
                    {/* Legal moves: a dot on empty squares, a dotted ring around pieces that can be taken. */}
                    {isTarget && !piece && <div className="absolute inset-[38%] rounded-full" style={{ background: look.hint }} />}
                    {isTarget && piece && <div className="absolute inset-[5%] rounded-full border-[3px] border-dotted" style={{ borderColor: look.hint }} />}
                  </div>
                );
              }),
            )}

            {/* The piece under the finger/mouse while dragging. */}
            <div ref={floating} className={`pointer-events-none absolute top-0 left-0 z-10 aspect-square w-[12.5%] ${dragging ? "" : "hidden"}`}>
              {dragging && g.get(dragging) && (
                <div className={`size-full scale-110 ${pieces === "classic" ? "p-[2%]" : "p-[10%]"}`} style={pieceEdge(g.get(dragging)!.color)}>
                  <Piece type={g.get(dragging)!.type} color={g.get(dragging)!.color} set={pieces} outlined={boardStyle !== "app"} className="size-full" />
                </div>
              )}
            </div>

            <AnimatePresence>
              {promotion && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 grid place-items-center bg-ink/80 backdrop-blur-sm">
                  <div className="text-center">
                    <Label className="mb-3">promote to</Label>
                    <div className="flex gap-2">
                      {(["q", "r", "b", "n"] as PieceSymbol[]).map((t) => (
                        <button key={t} onClick={() => play(promotion.from, promotion.to, t)} className="size-16 rounded-lg border border-line-2 bg-ink-2 p-2 transition hover:border-fg lg:size-20">
                          <Piece type={t} color={g.turn()} set={pieces} className="size-full" />
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setPromotion(null)} className="mt-3 font-mono text-[12px] text-mute hover:text-fg">
                      cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {strip(bottom)}
          </div>
        </motion.div>

        <aside className="mt-6 lg:sticky lg:top-10 lg:col-span-5 lg:mt-0">
          {online && (
            <Section label="online game" right={net.row ? net.row.status : undefined}>
              <div className="space-y-4">
                {net.color === "w" && (
                  <div>
                    <p className="mb-2 text-[14px] text-mute">{net.row?.black ? "Your link (works for the two of you only):" : "Send this link to your opponent. Whoever opens it first plays black."}</p>
                    <div className="flex items-center gap-2">
                      <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 border-b border-line-2 bg-transparent py-2 font-mono text-[12.5px] text-mute outline-none" />
                      <button onClick={copyInvite} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-mute transition hover:border-fg hover:text-fg">
                        <Copy className="size-3.5" /> {copied ? "copied" : "copy link"}
                      </button>
                    </div>
                  </div>
                )}
                {net.row?.status === "active" && (
                  <button
                    onClick={resign}
                    onBlur={() => setConfirmResign(false)}
                    data-cursor="danger"
                    className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] transition ${confirmResign ? "border-red text-red" : "border-line-2 text-mute hover:border-red hover:text-red"}`}
                  >
                    <Flag className="size-3.5" /> {confirmResign ? "tap again to resign" : "resign"}
                  </button>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={startOnline} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink">
                    <Globe className="size-3.5" /> new online game
                  </button>
                  <Link href="/extras/chess" className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
                    play on this device
                  </Link>
                </div>
                {onlineMsg && <p className="font-mono text-[12px] text-mute">{onlineMsg}</p>}
              </div>
            </Section>
          )}

          <Section label={online ? "board" : "game"}>
            <div className="space-y-4">
              {!online && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px]">opponent</span>
                <Segmented<Mode>
                  id="chess-mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "two", label: "2 players" },
                    { value: "cpu", label: "computer" },
                  ]}
                />
              </div>
              )}
              {!online && mode === "cpu" && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[15px]">level</span>
                    <Segmented<Level>
                      id="chess-level"
                      value={level}
                      onChange={setLevel}
                      options={[
                        { value: "easy", label: "easy" },
                        { value: "medium", label: "medium" },
                        { value: "hard", label: "hard" },
                      ]}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[15px]">you play</span>
                    <Segmented<Color>
                      id="chess-side"
                      value={you}
                      onChange={setYou}
                      options={[
                        { value: "w", label: "white" },
                        { value: "b", label: "black" },
                      ]}
                    />
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px]">pieces</span>
                <Segmented<PieceSet>
                  id="chess-pieces"
                  value={pieces}
                  onChange={setPieces}
                  options={[
                    { value: "dots", label: "dots" },
                    { value: "classic", label: "classic" },
                    { value: "letters", label: "letters" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px]">board</span>
                <Segmented<BoardStyle>
                  id="chess-board"
                  value={boardStyle}
                  onChange={setBoardStyle}
                  options={[
                    { value: "app", label: "app" },
                    { value: "wood", label: "wood" },
                    { value: "green", label: "green" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {!online && (
                <button onClick={newGame} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink">
                  <RotateCcw className="size-3.5" /> new game
                </button>
                )}
                {!online && (
                <button onClick={startOnline} className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
                  <Globe className="size-3.5" /> play online
                </button>
                )}
                {!online && (
                <button onClick={undo} disabled={!ply} className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                  <Undo2 className="size-3.5" /> undo
                </button>
                )}
                <button onClick={() => setFlipped((v) => !v)} className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
                  <FlipVertical2 className="size-3.5" /> flip
                </button>
                <button onClick={enterFull} className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
                  <Maximize2 className="size-3.5" /> full screen
                </button>
              </div>
              {!online && onlineMsg && <p className="font-mono text-[12px] text-mute">{onlineMsg}</p>}
              {pieces === "classic" && <p className="font-mono text-[11px] text-dim">classic pieces by Colin M.L. Burnett (cburnett), BSD licence.</p>}
            </div>
          </Section>

          {!online && games.games.length > 0 && (
            <Section label="your online games">
              {games.games.map((x) => {
                const opp = x.black ? (x.white === games.me ? x.black_name : x.white_name) || "opponent" : null;
                return (
                  <Link key={x.id} href={`/extras/chess/${x.id}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-ink-2">
                    <span className={`size-1.5 rounded-full ${x.status === "active" ? "bg-red" : "bg-dot-off"}`} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{opp ? `vs ${opp}` : "waiting for an opponent"}</span>
                    <span className="font-mono text-[12px] text-dim">{x.status === "over" ? (x.result ?? "over") : x.status === "waiting" ? "open" : `move ${Math.floor(x.ply / 2) + 1}`}</span>
                  </Link>
                );
              })}
            </Section>
          )}

          <Section label="moves" right={ply ? `${ply} ${ply === 1 ? "move" : "moves"}` : undefined}>
            {pairs.length === 0 ? (
              <p className="font-mono text-[13px] text-dim">no moves yet. white starts.</p>
            ) : (
              <div ref={moveList} className="no-scrollbar max-h-64 overflow-y-auto font-mono text-[13.5px] lg:max-h-[calc(100dvh-560px)] lg:min-h-40">
                {pairs.map(([w, b], i) => (
                  <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr] py-0.5">
                    <span className="text-dim">{i + 1}.</span>
                    <span className={w === last ? "text-fg" : "text-mute"}>{w?.san}</span>
                    <span className={b === last ? "text-fg" : "text-mute"}>{b?.san ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </aside>
      </div>
    </Page>
  );
}
