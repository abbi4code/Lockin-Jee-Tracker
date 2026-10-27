"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Flag, FlipVertical2, Globe, Handshake, Maximize2, Minimize2, RotateCcw, RotateCw, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { CallButton } from "../components/call/CallButton";
import { Piece, type PieceSet } from "../components/chess/Piece";
import { buzz, Segmented, Stepper } from "../components/Controls";
import { Page } from "../components/Shell";
import { DotText, fadeUp, Label, Section } from "../components/ui";
import { afterMove, formatClock, fresh, INCREMENTS, label, LOW_MS, MINUTES, parseTc, running, timeLeft, timeoutResult, type Clocks, type TimeControl } from "../lib/chess/clock";
import { material, onlineStatus } from "../lib/chess/display";
import type { Level } from "../lib/chess/engine";
import { createGame, myGames, useOnlineGame, type OnlineGame } from "../lib/chess/online";
import { canClaimAbandoned, clockOf, waitingSince } from "../lib/chess/rules";
import { moveSound, playSound, setSoundOn, soundOn, unlockSound } from "../lib/chess/sound";
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
  /** The chosen time control ("none", or minutes + seconds added per move like "10+5"), for new games. */
  tc?: string;
  /** This device's game clock (time left as of the last move; it waits while the page is closed). */
  clock?: { tc: TimeControl | null; c: Clocks; flagged: Color | null };
}

/** A local game's clock. `since`: when the side to move's clock started. */
interface LocalClock {
  tc: TimeControl | null;
  c: Clocks;
  since: number;
  flagged: Color | null;
}
const noClock = (tc: TimeControl | null): LocalClock => ({ tc, c: tc ? fresh(tc) : { w: 0, b: 0 }, since: Date.now(), flagged: null });

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
/** The computer never answers faster than this, so its move doesn't land the instant yours does. */
const MIN_THINK_MS = 400;
/** The engine stops itself within 2 s; no answer by this point means the worker died or hung. */
const ENGINE_TIMEOUT_MS = 15_000;

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

function status(game: Chess, mode: Mode, you: Color, thinking: boolean, flagged: Color | null) {
  const name = (c: Color) => (mode === "cpu" ? (c === you ? "you" : "computer") : c === "w" ? "white" : "black");
  if (flagged) {
    const out = timeoutResult(game, flagged);
    if (!out.winner) return { text: `${name(flagged)} ran out of time, but ${name(flagged === "w" ? "b" : "w")} can't mate. draw.`, over: true };
    return { text: `${name(flagged)} ran out of time. ${mode === "cpu" && out.winner === you ? "you win." : `${name(out.winner)} wins.`}`, over: true };
  }
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

/** A clock reading in dot-matrix digits; the decimal point of the last ten seconds as a solid dot, so "8.8" can't read as "88". */
function ClockText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\.)/).map((part, i) => (part === "." ? <span key={i} className="mx-[0.1em] inline-block size-[0.16em] rounded-full bg-current align-baseline" /> : <DotText key={i}>{part}</DotText>))}
    </>
  );
}

/** A side's name, the pieces it has captured and its material lead, shown above and below the board. */
function PlayerStrip({ label, captured, capturedColor, lead, active, set, clock }: { label: string; captured: PieceSymbol[]; capturedColor: Color; lead: number; active: boolean; set: PieceSet; clock?: { ms: number; running: boolean } }) {
  return (
    <div className="flex h-9 items-center gap-3">
      <span className={`size-1.5 rounded-full ${active ? "bg-red" : "bg-dot-off"}`} />
      <span className={`font-mono text-[13px] ${active ? "text-fg" : "text-mute"}`}>{label}</span>
      <div className="flex min-w-0 items-center">
        {captured.map((t, i) => (
          <Piece key={i} type={t} color={capturedColor} set={set} className="-mr-1 size-4 opacity-70" />
        ))}
      </div>
      {lead > 0 && <span className="font-mono text-[12px] text-mute">+{lead}</span>}
      {clock && (
        // The running clock is lit (red in its last ten seconds); the waiting one is dim.
        <span
          className={`ml-auto rounded-md border px-2 py-0.5 text-[19px] leading-none tabular-nums transition-colors lg:text-[21px] ${
            clock.running ? (clock.ms < LOW_MS ? "border-red text-red" : "border-fg text-fg") : clock.ms < LOW_MS ? "border-line-2 text-red/70" : "border-line-2 text-mute"
          }`}
          aria-label={`${label}: ${formatClock(clock.ms)} left`}
        >
          <ClockText text={formatClock(clock.ms)} />
        </span>
      )}
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
  /** The engine worker crashed or never answered: the computer waits for a retry instead of thinking forever. */
  const [engineStuck, setEngineStuck] = useState(false);
  const [dragging, setDragging] = useState<Square | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tcId, setTcId] = useState<string>("none");
  const [clock, setClock] = useState<LocalClock>(() => noClock(null));
  const [sound, setSound] = useState(true);
  /** Re-renders the clocks while one is running. */
  const [, setTick] = useState(0);
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
  // The real result comes first: a stuck engine only matters while the game is on and the computer is to move.
  const real = online ? onlineStatus(net.row, net.color, g, net.error) : status(g, mode, you, thinking, clock.flagged);
  const cpuTurn = !online && mode === "cpu" && g.turn() !== you && !real.over;
  const stuck = engineStuck && cpuTurn;
  const st = stuck ? { text: "the computer got stuck.", over: false } : real;

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
      setTcId(saved.tc ?? "none");
      // The local clock waits while the page is closed: it picks up from the last move. A board saved before
      // clocks existed (or not started yet) takes the chosen clock.
      if (!gameId && saved.clock) setClock({ ...saved.clock, since: Date.now() });
      else if (!gameId && !game.current.history().length) setClock(noClock(parseTc(saved.tc)));
    }
    setSound(soundOn());
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
      persist({ pgn: saved?.pgn ?? "", mode: saved?.mode ?? "two", level: saved?.level ?? "medium", you: saved?.you ?? "w", flipped: saved?.flipped ?? false, pieces, board: boardStyle, tc: tcId, clock: saved?.clock });
    } else {
      const c = timeLeft(clock.c, game.current.turn(), game.current.history().length, clock.since, Date.now(), !clock.tc || !!clock.flagged);
      persist({ pgn: game.current.pgn(), mode, level, you, flipped, pieces, board: boardStyle, tc: tcId, clock: { tc: clock.tc, c, flagged: clock.flagged } });
    }
    // The clock is saved with each move (and setting), not on every tick.
  }, [loaded, gameId, version, mode, level, you, flipped, pieces, boardStyle, tcId, clock.flagged, clock.tc]);

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
    if (!loaded || !cpuTurn || engineStuck) return;
    const id = ++request.current;
    const started = performance.now();
    setThinking(true);
    // A crashed or hung worker is thrown away (the next turn starts a fresh one) and the player gets a retry.
    const fail = () => {
      if (id !== request.current) return;
      window.clearTimeout(watchdog);
      worker.current?.terminate();
      worker.current = null;
      setThinking(false);
      setEngineStuck(true);
    };
    const watchdog = window.setTimeout(fail, ENGINE_TIMEOUT_MS);
    worker.current ??= spawnEngine();
    worker.current.onerror = fail;
    worker.current.onmessageerror = fail;
    worker.current.onmessage = (e: MessageEvent<{ id: number; move: { from: string; to: string; promotion?: string } | null }>) => {
      if (e.data.id !== request.current) return;
      window.clearTimeout(watchdog);
      window.setTimeout(
        () => {
          if (e.data.id !== request.current) return;
          setThinking(false);
          if (e.data.move) {
            try {
              const mover = game.current.turn();
              const before = game.current.history().length;
              game.current.move(e.data.move);
              recordMove(mover, before);
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
    // The positions so far let the engine see repetitions coming.
    const history = game.current.history({ verbose: true }).map((m) => m.before);
    worker.current.postMessage({ id, fen: game.current.fen(), level, history });
    // Mode, level or position changed before the answer came: forget it.
    return () => {
      window.clearTimeout(watchdog);
      if (request.current === id) {
        request.current++;
        setThinking(false);
      }
    };
  }, [loaded, cpuTurn, ply, level, engineStuck, rerender]);

  useEffect(() => {
    moveList.current?.scrollTo({ top: moveList.current.scrollHeight, behavior: "smooth" });
  }, [ply]);

  const canMove = (sq: Square) => {
    const p = g.get(sq);
    if (online) return !!p && p.color === g.turn() && p.color === net.color && net.row?.status === "active" && !promotion && !net.busy;
    return !!p && p.color === g.turn() && !st.over && !promotion && !thinking && !(mode === "cpu" && p.color !== you);
  };
  const targets = selected ? g.moves({ square: selected, verbose: true }) : [];
  const targetSquares = new Set(targets.map((m) => m.to));

  /** A move on this device: the mover's time comes off and the increment goes on; too late, and their flag falls. */
  const recordMove = (mover: Color, before: number) => {
    const now = Date.now();
    setClock((k) => {
      if (!k.tc || k.flagged) return k;
      const next = afterMove(k.c, k.tc, mover, before, k.since, now);
      return next ? { ...k, c: next, since: now } : { ...k, c: { ...k.c, [mover]: 0 }, flagged: mover };
    });
  };

  const play = (from: Square, to: Square, promo?: PieceSymbol) => {
    const options = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return false;
    if (options.some((m) => m.promotion) && !promo) {
      setPromotion({ from, to });
      return true;
    }
    const before = g.history().length;
    const mover = g.turn();
    g.move({ from, to, promotion: promo });
    if (!online) recordMove(mover, before);
    setSelected(null);
    setPromotion(null);
    buzz(g.isCheckmate() ? 30 : 8);
    rerender();
    // The server checks the move and decides any result; if it says no, the board goes back.
    if (online) net.act({ type: "move", ply: before, from, to, ...(promo ? { promotion: promo } : {}) });
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
    setEngineStuck(false);
    setPromotion(null);
    setSelected(null);
    if (mode === "cpu") {
      // Take back to your last turn (your move and the computer's reply).
      do g.undo();
      while (g.history().length && g.turn() !== you);
    } else g.undo();
    // The clocks keep the time they had; the side now to move starts using its time from here.
    setClock((k) => ({ ...k, since: Date.now() }));
    buzz();
    rerender();
  };
  const newGame = () => {
    request.current++;
    setThinking(false);
    setEngineStuck(false);
    setPromotion(null);
    setSelected(null);
    g.reset();
    setClock(noClock(parseTc(tcId)));
    buzz(12);
    rerender();
  };

  const startOnline = async () => {
    setOnlineMsg("creating game…");
    try {
      const id = await createGame(myName, parseTc(tcId));
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
    net.act({ type: "resign" });
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
  const mat = material(g, history);
  const myOffer = !!net.color && net.row?.draw_offer === net.color;
  const theirOffer = !!net.color && !!net.row?.draw_offer && net.row.draw_offer !== net.color;
  const drawAsk = online && net.row?.status === "active" && theirOffer;
  const opponent = (net.color === "w" ? net.row?.black_name : net.row?.white_name) || "your opponent";
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
    <PlayerStrip label={sideLabel(c)} captured={mat.lost[c === "w" ? "b" : "w"]} capturedColor={c === "w" ? "b" : "w"} lead={c === "w" ? mat.diff : -mat.diff} active={!st.over && g.turn() === c} set={pieces} clock={clockFor(c)} />
  );
  const checkSquare = g.inCheck() ? g.board().flat().find((p) => p?.type === "k" && p.color === g.turn())?.square : undefined;
  const look = BOARDS[boardStyle];
  // Classic black pieces would vanish on the app's near-black squares: give them a faint light edge there.
  const pieceEdge = (c: Color) => (pieces === "classic" && c === "b" && boardStyle === "app" ? { filter: "drop-shadow(0 0 1px var(--color-mute))" } : undefined);
  const pairs = Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => [history[i * 2], history[i * 2 + 1]]);

  // The clocks. Online they're the server's (counted on its clock, turn by its saved ply, so a move you've just
  // made doesn't start your opponent's clock before the server has it); on this device, our own.
  const onlineClock = online && net.row ? clockOf(net.row) : null;
  const clocks: { c: Clocks; toMove: Color; running: boolean; tc: TimeControl } | null = onlineClock
    ? (() => {
        const row = net.row!;
        const toMove: Color = row.ply % 2 === 0 ? "w" : "b";
        const over = row.status !== "active";
        return { c: timeLeft(onlineClock.clocks, toMove, row.ply, waitingSince(row), net.now(), over), toMove, running: running(row.ply, over), tc: onlineClock.tc };
      })()
    : !online && clock.tc
      ? { c: timeLeft(clock.c, g.turn(), ply, clock.since, Date.now(), real.over), toMove: g.turn(), running: running(ply, real.over), tc: clock.tc }
      : null;
  const clockFor = (c: Color) => (clocks ? { ms: clocks.c[c], running: clocks.running && clocks.toMove === c } : undefined);

  // A running clock redraws ten times a second.
  const ticking = !!clocks?.running;
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [ticking]);

  // A clock hit zero. On this device that ends the game; online, the server decides: either player's app tells it,
  // and if it's a moment early (the clocks are a little apart) asks again a second later.
  const flagFell = !!clocks && clocks.running && clocks.c[clocks.toMove] <= 0;
  useEffect(() => {
    if (!flagFell || !clocks) return;
    const side = clocks.toMove;
    if (!online) {
      setClock((k) => (k.flagged ? k : { ...k, c: { ...k.c, [side]: 0 }, flagged: side }));
      return;
    }
    let t = 0;
    const report = async () => {
      if (!(await net.act({ type: "flag" }))) t = window.setTimeout(report, 1000);
    };
    report();
    return () => window.clearTimeout(t);
    // Only the moment the flag falls matters; `clocks` and `net` are read then.
  }, [flagFell]);

  // Sounds, so you know the other side has moved without watching the board: every move (capture, check and
  // checkmate each sound different), the end of the game, and the opponent arriving in an online game.
  const heard = useRef<{ ply: number; over: boolean; status?: string } | null>(null);
  useEffect(() => {
    if (!loaded || (online && !net.row)) return;
    const prev = heard.current;
    heard.current = { ply, over: st.over, status: net.row?.status };
    if (!prev) return;
    if (ply === prev.ply + 1 && last) playSound(moveSound(g, !!last.captured));
    else if (st.over && !prev.over) playSound(g.isCheckmate() ? "mate" : "end");
    if (online && prev.status === "waiting" && net.row?.status === "active") playSound("start");
  }, [loaded, ply, st.over, net.row?.status]);

  // A short warning when your clock (on this device: the clock that's running) drops under ten seconds.
  const warned = useRef<Record<Color, boolean>>({ w: false, b: false });
  const watched = online ? net.color : clocks?.toMove;
  const watchedMs = clocks && watched ? clocks.c[watched] : null;
  useEffect(() => {
    if (!watched || watchedMs == null) return;
    if (watchedMs >= LOW_MS) warned.current[watched] = false;
    else if (watchedMs > 0 && clocks?.running && clocks.toMove === watched && !warned.current[watched]) {
      warned.current[watched] = true;
      playSound("low");
      buzz(15);
    }
  });

  // Browsers only play sound once the page has been touched.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockSound, { once: true });
    window.addEventListener("keydown", unlockSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
    };
  }, []);

  // Online, in another tab: the tab's title says when it's your move.
  const yourTurn = online && net.row?.status === "active" && !!net.color && (net.row.ply % 2 === 0 ? "w" : "b") === net.color;
  useEffect(() => {
    if (!online) return;
    const base = document.title;
    const update = () => {
      document.title = yourTurn && document.hidden ? "● your move · chess" : base;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [online, yourTurn]);

  const chosenTc = parseTc(tcId);
  const tcHint = chosenTc
    ? `${chosenTc.base / 60} min each, ${chosenTc.inc ? `+${chosenTc.inc}s added after every move` : "nothing added per move"} · clocks start after each side's first move`
    : "no clock: take as long as you like";
  // Turning the clock off and on again keeps the seconds per move you'd picked.
  const lastInc = useRef(0);
  if (chosenTc) lastInc.current = chosenTc.inc;
  const pickTc = (id: string) => {
    setTcId(id);
    // A fresh board takes the new clock at once; a game in progress keeps its own.
    if (!ply) setClock(noClock(parseTc(id)));
  };

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
          className={full ? "fixed inset-0 z-[60] flex items-center justify-center bg-ink px-3 py-3" : "mx-auto w-full lg:col-span-7 lg:max-w-[min(100%,calc(100dvh-290px))]"}
        >
          <div className={full ? "w-[min(100%,calc(100dvh-150px))]" : ""}>
          {full && (
            <div className="mb-1 flex items-center justify-between gap-3">
              {/* The side panel is covered here, so what needs an answer shows up in this row instead. */}
              {net.notice ? (
                <span role="alert" className="line-clamp-2 min-w-0 font-mono text-[13px] text-red">
                  {net.notice}
                </span>
              ) : drawAsk ? (
                <span className="line-clamp-2 min-w-0 font-mono text-[13px] text-fg">{opponent} offers a draw.</span>
              ) : (
                <span className={`truncate font-mono text-[13px] ${st.over ? "text-red" : "text-mute"}`}>{st.text}</span>
              )}
              <div className="flex shrink-0 gap-1.5">
                {drawAsk && (
                  <>
                    <button onClick={() => net.act({ type: "accept-draw" })} disabled={net.busy} aria-label="accept draw" data-cursor="go" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                      <Check className="size-4" />
                    </button>
                    <button onClick={() => net.act({ type: "decline-draw" })} disabled={net.busy} aria-label="decline draw" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                      <X className="size-4" />
                    </button>
                  </>
                )}
                {stuck && (
                  <button onClick={() => setEngineStuck(false)} aria-label="let the computer try again" data-cursor="go" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
                    <RotateCw className="size-4" />
                  </button>
                )}
                {/* Online games have no takebacks: the dead button would only crowd a phone's row. */}
                {!online && (
                  <button onClick={undo} disabled={!ply || !!clock.flagged} aria-label="undo" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                    <Undo2 className="size-4" />
                  </button>
                )}
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
          {online && net.row?.black && net.color && (
            <Section label="call">
              <p className="mb-3 text-[14.5px] text-mute">See and hear {opponent} while you play. The call stays open if you leave this page.</p>
              <CallButton context={`chess:${net.row.id}`} invitees={[{ id: net.color === "w" ? net.row.black : net.row.white, name: opponent }]} />
            </Section>
          )}
          {online && (
            <Section label="online game" right={net.row ? `${onlineClock ? label(onlineClock.tc) : "no clock"} · ${net.row.status}` : undefined}>
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
                {drawAsk && (
                  <div>
                    <p className="mb-2 text-[14px] text-fg">{opponent} offers a draw.</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => net.act({ type: "accept-draw" })} disabled={net.busy} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
                        accept draw
                      </button>
                      <button onClick={() => net.act({ type: "decline-draw" })} disabled={net.busy} className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
                        decline
                      </button>
                    </div>
                  </div>
                )}
                {net.row?.status === "active" && net.color && canClaimAbandoned(net.row, net.color, Date.now()) && (
                  <div>
                    <p className="mb-2 text-[14px] text-mute">They haven&apos;t moved in 3 days. You can take the win.</p>
                    <button onClick={() => net.act({ type: "claim-abandoned" })} disabled={net.busy} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
                      claim the win
                    </button>
                  </div>
                )}
                {net.row?.status === "active" && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={resign}
                      onBlur={() => setConfirmResign(false)}
                      disabled={net.busy}
                      data-cursor="danger"
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] transition disabled:opacity-40 ${confirmResign ? "border-red text-red" : "border-line-2 text-mute hover:border-red hover:text-red"}`}
                    >
                      <Flag className="size-3.5" /> {confirmResign ? "tap again to resign" : "resign"}
                    </button>
                    {/* Hidden until the chess_server migration adds the column (draw_offer is then null, not missing). */}
                    {net.row.draw_offer !== undefined && !theirOffer && (
                      <button
                        onClick={() => net.act({ type: "offer-draw" })}
                        disabled={net.busy || myOffer}
                        className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40"
                      >
                        <Handshake className="size-3.5" /> {myOffer ? "draw offered" : "offer a draw"}
                      </button>
                    )}
                  </div>
                )}
                {net.row?.status === "waiting" && net.color === "w" && (
                  <button onClick={() => net.act({ type: "cancel" })} disabled={net.busy} data-cursor="danger" className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-red hover:text-red disabled:opacity-40">
                    cancel this game
                  </button>
                )}
                {net.notice && (
                  <p role="alert" className="font-mono text-[12px] text-red">
                    {net.notice}
                  </p>
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
                  onChange={(m) => {
                    setMode(m);
                    setEngineStuck(false); // a new setup gets a fresh engine
                  }}
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
                      onChange={(l) => {
                        setLevel(l);
                        setEngineStuck(false);
                      }}
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
                      onChange={(c) => {
                        setYou(c);
                        setEngineStuck(false);
                      }}
                      options={[
                        { value: "w", label: "white" },
                        { value: "b", label: "black" },
                      ]}
                    />
                  </div>
                </>
              )}
              {!online && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[15px]">
                      clock <span className="font-mono text-[11.5px] text-dim">min each</span>
                    </span>
                    <Segmented<string>
                      id="chess-clock"
                      value={chosenTc ? String(chosenTc.base / 60) : "off"}
                      onChange={(v) => pickTc(v === "off" ? "none" : `${v}+${lastInc.current}`)}
                      options={[{ value: "off", label: "off" }, ...MINUTES.map((m) => ({ value: String(m), label: String(m) }))]}
                    />
                  </div>
                  {chosenTc && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[15px]">added per move</span>
                      <Stepper label="seconds added per move" values={INCREMENTS} value={chosenTc.inc} onChange={(sec) => pickTc(`${chosenTc.base / 60}+${sec}`)} format={(sec) => (sec ? `+${sec}s` : "off")} />
                    </div>
                  )}
                  <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-dim">
                    {tcHint}
                    {ply > 0 && (chosenTc ? label(chosenTc) : null) !== (clock.tc ? label(clock.tc) : null) ? " · from your next new game" : ""}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px]">sound</span>
                <Segmented<"on" | "off">
                  id="chess-sound"
                  value={sound ? "on" : "off"}
                  onChange={(v) => {
                    setSound(v === "on");
                    setSoundOn(v === "on");
                    if (v === "on") playSound("move");
                  }}
                  options={[
                    { value: "on", label: "on" },
                    { value: "off", label: "off" },
                  ]}
                />
              </div>
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
                <button onClick={undo} disabled={!ply || !!clock.flagged} className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40">
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
              {stuck && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-mono text-[12px] text-red">the computer stopped answering.</p>
                  <button onClick={() => setEngineStuck(false)} data-cursor="go" className="rounded-full border border-line-2 px-3.5 py-1.5 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg">
                    let it try again
                  </button>
                </div>
              )}
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
                    <span className="font-mono text-[12px] text-dim">
                      {x.time_base ? `${x.time_base / 60}+${x.time_inc ?? 0} · ` : ""}
                      {x.status === "over" ? (x.result ?? "over") : x.status === "waiting" ? "open" : `move ${Math.floor(x.ply / 2) + 1}`}
                    </span>
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
