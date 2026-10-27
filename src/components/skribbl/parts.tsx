"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activePlayers, HUES, type Player, type Room } from "../../lib/skribbl/rules";
import { DotText } from "../ui";

// Small pieces of the skribbl screens (/extras/skribbl), in the app's own look.

// Dot-matrix pencil on a 7×7 grid, like the chess pieces; the tip is red.
// prettier-ignore
const PENCIL = [".....XX", "....XXX", "...XXX.", "..XXX..", ".XXX...", ".XX....", "X......"];
const PENCIL_DOTS = PENCIL.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "X" ? [[c * 10 + 5, r * 10 + 5]] : [])));

export function SketchGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 70 70" className={className} aria-hidden>
      {PENCIL_DOTS.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={4.2} fill={y >= 55 ? "var(--color-red)" : "var(--color-fg)"} />
      ))}
    </svg>
  );
}

export const hueColor = (hue: number) => `var(--color-sketch-hue-${((hue % HUES) + HUES) % HUES})`;

/** A player's colour as a hex value (confetti can't read CSS variables). */
const hueHex = (hue: number) => getComputedStyle(document.documentElement).getPropertyValue(`--color-sketch-hue-${((hue % HUES) + HUES) % HUES}`).trim();

/** Confetti from the board in the guesser's colour: a big burst for your own guess, a small one for anyone else's. */
export function burst(hue: number, mine: boolean) {
  const board = document.querySelector("canvas")?.getBoundingClientRect();
  const origin = board ? { x: (board.left + board.width / 2) / window.innerWidth, y: (board.top + board.height * 0.6) / window.innerHeight } : { x: 0.5, y: 0.6 };
  confetti({ particleCount: mine ? 90 : 28, spread: mine ? 80 : 50, startVelocity: mine ? 42 : 28, origin, colors: [hueHex(hue), "#ffffff"], scalar: 0.9, ticks: 160, disableForReducedMotion: true });
}

/** A number that counts up (or down) to its new value; `start` makes its first appearance count up from there too. */
export function CountUp({ value, start: initial }: { value: number; start?: number }) {
  const [shown, setShown] = useState(initial ?? value);
  const from = useRef(initial ?? value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = Math.round(start + (value - start) * (1 - (1 - k) ** 3));
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

export function Avatar({ hue, size = 10, dim = false }: { hue: number; size?: number; dim?: boolean }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: hueColor(hue), opacity: dim ? 0.35 : 1 }} />;
}

export const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** Whole seconds until `deadline` on the server's clock, refreshed a few times a second. */
export function useSecondsLeft(deadline: number | null, now: () => number) {
  const calc = () => (deadline == null || Number.isNaN(deadline) ? null : Math.max(0, Math.ceil((deadline - now()) / 1000)));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (deadline == null) return;
    const t = window.setInterval(() => setLeft(calc()), 200);
    return () => window.clearInterval(t);
    // `calc` reads `deadline` and `now`, which are the dependencies.
  }, [deadline, now]);
  return left;
}

/** The big countdown: dot-matrix seconds, red in the last ten. */
export function Countdown({ seconds }: { seconds: number | null }) {
  if (seconds == null) return <span className="font-mono text-[13px] text-dim">–</span>;
  return <DotText className={`text-[30px] leading-none tabular-nums lg:text-[34px] ${seconds <= 10 ? "text-red" : "text-fg"}`}>{seconds}</DotText>;
}

/**
 * The word line above the board. Drawer: the word. Guessers: the blanks, letters filling in as hints come, and how
 * long each word is. Hidden mode: nothing to go on. After the turn: the word, for everyone.
 */
export function WordLine({ room, me, word, drawerName, got }: { room: Room; me: string | null; word: string | null; drawerName: string; got?: string }) {
  const drawer = room.drawer === me;
  if (room.status === "choosing") return <p className="text-[15px] text-mute">{drawer ? "pick a word to draw" : `${drawerName} is picking a word…`}</p>;
  // The word itself is under the board at the reveal; up here, how the turn went.
  if (room.status === "reveal") return got ? <p className="text-[15px] text-mute">{got}</p> : null;
  if (room.status === "over") return <p className="text-[15px] text-mute">game over</p>;
  if (room.status !== "drawing") return null;
  if (drawer)
    return (
      <div className="text-center">
        <div className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">draw this</div>
        <div className="text-[22px] leading-tight font-semibold tracking-tight lg:text-[26px]">{word ?? "…"}</div>
      </div>
    );
  if (!room.mask)
    return (
      <div className="text-center">
        <div className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">guess the word</div>
        <div className="font-mono text-[13px] text-dim">hidden mode · no blanks, no hints</div>
      </div>
    );
  const lengths = room.mask.split(" ").map((w) => [...w].filter((ch) => ch === "_" || /[\p{L}\p{N}]/u.test(ch)).length);
  return (
    <div className="text-center">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1" aria-label={`${lengths.join(" and ")} letters`}>
        {room.mask.split(" ").map((w, wi) => (
          <span key={wi} className="flex gap-[0.22em] text-[20px] lg:text-[23px]">
            {[...w].map((ch, i) =>
              ch === "_" ? (
                <span key={i} className="inline-block h-[1.35em] w-[0.7em] border-b-2 border-mute" />
              ) : (
                <motion.span key={`${i}${ch}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="inline-block w-[0.7em] text-center font-mono leading-[1.35em] font-semibold text-fg">
                  {ch}
                </motion.span>
              ),
            )}
          </span>
        ))}
      </div>
      <div className="mt-0.5 font-mono text-[11.5px] text-dim">{lengths.join(" + ")} letters</div>
    </div>
  );
}

/**
 * Everyone in the room, best score first (in the lobby: in joining order). Marks the drawer, who has guessed, who's
 * not connected, and this turn's points. The host can remove a player (tap twice).
 */
export function PlayerList({ room, players, me, online, onKick }: { room: Room; players: Player[]; me: string | null; online: Set<string>; onKick?: (user: string) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = activePlayers(players);
  const lobby = room.status === "lobby";
  const ranked = lobby ? list : [...list].sort((a, b) => b.score - a.score);
  const rank = (p: Player) => list.filter((x) => x.score > p.score).length + 1;
  return (
    <ul>
      <AnimatePresence initial={false}>
        {ranked.map((p) => {
          const away = online.size > 0 && !online.has(p.user_id);
          const drawing = p.user_id === room.drawer && (room.status === "choosing" || room.status === "drawing");
          return (
            <motion.li key={p.user_id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group relative flex items-center gap-3 border-b border-line/70 py-2.5">
              {/* A flash when they get it. */}
              {p.guessed_at && room.status === "drawing" && (
                <motion.span key={p.guessed_at} className="pointer-events-none absolute inset-0 -mx-2 rounded-md bg-red/20" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.4, ease: "easeOut" }} />
              )}
              {!lobby && <span className="w-6 shrink-0 font-mono text-[12px] text-dim">#{rank(p)}</span>}
              <Avatar hue={p.hue} dim={away} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-[15px] ${away ? "text-dim" : ""}`}>{p.name}</span>
                  {p.user_id === me && <span className="font-mono text-[11px] text-dim">you</span>}
                  {p.user_id === room.host && <span className="font-mono text-[10.5px] tracking-wider text-mute uppercase">host</span>}
                </div>
                {!lobby && (
                  <div className="font-mono text-[12px] text-mute">
                    <CountUp value={p.score} /> pts
                    {room.status === "reveal" && <span className={p.turn_points ? "text-red" : "text-dim"}> · +{p.turn_points}</span>}
                    {away && <span className="text-dim"> · away</span>}
                  </div>
                )}
              </div>
              {drawing && <Pencil className="size-4 shrink-0 text-fg" aria-label="drawing" />}
              {p.guessed_at && room.status === "drawing" && <Check className="size-4 shrink-0 text-red" strokeWidth={3} aria-label="guessed" />}
              {onKick && room.host === me && p.user_id !== me && (
                <button
                  onClick={() => {
                    if (confirm !== p.user_id) return setConfirm(p.user_id);
                    setConfirm(null);
                    onKick(p.user_id);
                  }}
                  onBlur={() => setConfirm(null)}
                  data-cursor="danger"
                  aria-label={`remove ${p.name}`}
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 font-mono text-[11px] transition ${confirm === p.user_id ? "border-red text-red" : "border-transparent text-dim opacity-100 hover:text-red lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"}`}
                >
                  {confirm === p.user_id ? "remove?" : <X className="size-3.5" />}
                </button>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
