"use client";

import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Copy, Flag, Globe, Maximize2, Minimize2, Minus, Plus, RotateCcw, Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buzz, Segmented } from "../components/Controls";
import { Page } from "../components/Shell";
import { Field, type Aim } from "../components/tanks/Field";
import { fadeUp, Label, Section } from "../components/ui";
import { createBattle, myBattles, useBattle, type TankGame } from "../lib/tanks/online";
import { deadline } from "../lib/tanks/rules";
import { playSound, setSoundOn, soundOn, unlockSound } from "../lib/tanks/sound";
import {
  aim as computerAim,
  ammoOf,
  drive,
  MAX_SHOTS,
  MOVES,
  newWorld,
  randomSeed,
  shotError,
  startShot,
  weapon,
  WEAPONS,
  type Level,
  type Side,
  type Sim,
  type WeaponId,
  type World,
} from "../lib/tanks/world";
import { useProgress } from "../store/progress";

type Mode = "cpu" | "two";
interface Saved {
  world: World;
  mode: Mode;
  level: Level;
}

const KEY = "lockin-tanks";
const TANK_COLOR = ["var(--color-tank-0)", "var(--color-tank-1)"] as const;

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return s?.world?.ground?.length ? s : null;
  } catch {
    return null;
  }
}
function persist(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: the battle just isn't remembered.
  }
}

/** A − / + button that repeats while held, for fine aiming. */
function Hold({ onStep, label, disabled, children }: { onStep: () => void; label: string; disabled: boolean; children: ReactNode }) {
  const step = useRef(onStep);
  step.current = onStep;
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const repeat = (wait: number) => {
    timer.current = window.setTimeout(() => {
      step.current();
      repeat(55);
    }, wait);
  };
  useEffect(() => stop, []);
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        buzz(4);
        step.current();
        repeat(350);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      // Keyboard presses (no pointer): one step each.
      onClick={(e) => {
        if (e.detail === 0) step.current();
      }}
      className="grid size-9 place-items-center rounded-full text-mute transition select-none hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Adjust({ label, value, onStep, disabled }: { label: string; value: string; onStep: (d: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase">{label}</span>
      <div className="inline-flex items-center rounded-full border border-line-2">
        <Hold label={`less ${label}`} disabled={disabled} onStep={() => onStep(-1)}>
          <Minus className="size-3.5" />
        </Hold>
        <span className="min-w-11 text-center font-mono text-[14px] text-fg tabular-nums">{value}</span>
        <Hold label={`more ${label}`} disabled={disabled} onStep={() => onStep(1)}>
          <Plus className="size-3.5" />
        </Hold>
      </div>
    </div>
  );
}

/** A tank's name and health, above the field. */
function TankLabel({ name, hp, color, active, right, extra }: { name: string; hp: number; color: string; active: boolean; right?: boolean; extra?: ReactNode }) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${right ? "flex-row-reverse text-right" : ""}`}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color, opacity: hp > 0 ? 1 : 0.35 }} />
      <span className={`truncate font-mono text-[13px] ${active ? "text-fg" : "text-mute"}`}>{name}</span>
      <span className={`font-mono text-[12px] tabular-nums ${hp <= 25 ? "text-red" : "text-dim"}`}>{hp}</span>
      {extra}
    </div>
  );
}

/** Your battles from the list: how each one stands for you. */
function battleState(g: TankGame, me: string | null) {
  if (g.status === "waiting") return "open";
  const mine = g.p1 === me ? 0 : 1;
  if (g.status === "over") return g.winner === null ? "draw" : g.winner === mine ? "won" : "lost";
  return "on";
}

/** Practice against the computer or a friend on this device at /extras/tanks; with `gameId`, an online battle. */
export function TanksScreen({ gameId }: { gameId?: string } = {}) {
  const online = !!gameId;
  const router = useRouter();
  const myName = useProgress((s) => s.settings.name) || "player";
  const net = useBattle(gameId, myName);
  const row = net.row;
  const rowRef = useRef<TankGame | null>(null);
  rowRef.current = row;

  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>("cpu");
  const [level, setLevel] = useState<Level>("medium");
  // A fixed seed until the saved battle (or a fresh random one) loads, so the server and browser render alike.
  const [world, setWorld] = useState<World>(() => newWorld(1));
  const [sim, setSim] = useState<Sim | null>(null);
  const [aim, setAim] = useState<Aim & { weapon: WeaponId }>({
    angle: 45,
    power: 60,
    weapon: "shell",
  });
  const [thinking, setThinking] = useState(false);
  const [sound, setSound] = useState(true);
  const [full, setFull] = useState(false);
  const [battles, setBattles] = useState<{
    me: string | null;
    games: TankGame[];
  }>({ me: null, games: [] });
  const [onlineMsg, setOnlineMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  useEffect(() => {
    setSound(soundOn());
    if (!online) {
      const saved = load();
      if (saved) {
        setWorld(saved.world);
        setMode(saved.mode === "two" ? "two" : "cpu");
        setLevel(["easy", "medium", "hard"].includes(saved.level) ? saved.level : "medium");
      } else setWorld(newWorld(randomSeed()));
      myBattles().then(setBattles);
    }
    setLoaded(true);
  }, [online]);

  useEffect(() => {
    if (loaded && !online) persist({ world, mode, level });
  }, [loaded, online, world, mode, level]);

  // Each turn starts from that tank's last aim.
  useEffect(() => {
    const t = world.tanks[world.turn];
    setAim({ angle: t.angle, power: t.power, weapon: "shell" });
  }, [world.seed, world.round]);

  // ---- Online: show the server's battle, playing the other side's shots as they come ----
  /** The step of the battle on screen, and the step a shot in flight leads to. */
  const viewStep = useRef(-1);
  const simStep = useRef<number | null>(null);
  useEffect(() => {
    if (!online || !row || sim) return;
    if (row.step === viewStep.current + 1 && row.last?.kind === "fire" && viewStep.current >= 0) {
      simStep.current = row.step;
      setSim(startShot(world, row.last.shot));
      return;
    }
    if (row.step < viewStep.current) return;
    viewStep.current = row.step;
    setWorld(row.world);
    // `world` is read only to start a shot from what's on screen.
  }, [online, row, sim]);

  const landed = (after: World) => {
    setSim(null);
    if (!online) return setWorld(after);
    if (simStep.current !== null) viewStep.current = simStep.current;
    simStep.current = null;
    const latest = rowRef.current;
    // The server's world is the true one; until it arrives (your own shot), show the one played here.
    if (latest && latest.step >= viewStep.current) {
      viewStep.current = latest.step;
      setWorld(latest.world);
    } else setWorld(after);
  };

  // ---- Whose turn, and what you can do ----
  const you: Side | null = online ? net.side : mode === "cpu" ? 0 : world.turn;
  const active = online ? row?.status === "active" : true;
  const canAct = loaded && !sim && !world.over && !thinking && !!active && (online ? net.side === world.turn && !net.busy : mode === "two" || world.turn === 0);
  const controls: Side = you ?? 0;
  const tank = world.tanks[controls];

  const names: [string, string] = online
    ? [row?.p1 === net.me ? "you" : row?.p1_name || "player 1", row?.p2 ? (row.p2 === net.me ? "you" : row.p2_name || "player 2") : "waiting…"]
    : mode === "cpu"
      ? ["you", "computer"]
      : ["blue", "red"];

  const shoot = async () => {
    if (!canAct) return;
    const shot = { weapon: aim.weapon, angle: aim.angle, power: aim.power };
    if (shotError(world, world.turn, shot)) return;
    buzz(18);
    if (!online) return setSim(startShot(world, shot));
    const current = rowRef.current;
    if (!current) return;
    simStep.current = current.step + 1;
    setSim(startShot(world, shot));
    const res = await net.act({ type: "fire", step: current.step, shot });
    if (!res.ok && rowRef.current) {
      // Refused (or lost): back to the server's battle.
      setSim(null);
      simStep.current = null;
      viewStep.current = rowRef.current.step;
      setWorld(rowRef.current.world);
    }
  };

  const driveTank = async (dir: -1 | 1) => {
    if (!canAct) return;
    const next = drive(world, dir);
    if (!next) return;
    buzz(10);
    if (!online) return setWorld(next);
    const current = rowRef.current;
    if (!current) return;
    viewStep.current = current.step + 1;
    setWorld(next);
    const res = await net.act({ type: "move", step: current.step, dir });
    if (!res.ok && rowRef.current) {
      viewStep.current = rowRef.current.step;
      setWorld(rowRef.current.world);
    }
  };

  const nudge = (angle: number, power: number) =>
    setAim((a) => ({
      ...a,
      angle: Math.max(0, Math.min(180, a.angle + angle)),
      power: Math.max(0, Math.min(100, a.power + power)),
    }));

  // ---- The computer's turn: it thinks, swings its barrel round, and fires ----
  useEffect(() => {
    if (online || !loaded || mode !== "cpu" || sim || world.over || world.turn !== 1) return;
    setThinking(true);
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        const shot = computerAim(world, 1, level);
        const from = world.tanks[1];
        const steps = 16;
        for (let i = 1; i <= steps; i++) {
          timers.push(
            window.setTimeout(() => {
              setAim({
                weapon: shot.weapon,
                angle: Math.round(from.angle + ((shot.angle - from.angle) * i) / steps),
                power: Math.round(from.power + ((shot.power - from.power) * i) / steps),
              });
            }, i * 30),
          );
        }
        timers.push(
          window.setTimeout(
            () => {
              setThinking(false);
              setSim(startShot(world, shot));
            },
            steps * 30 + 350,
          ),
        );
      }, 550),
    );
    return () => {
      timers.forEach(window.clearTimeout);
      setThinking(false);
    };
  }, [online, loaded, mode, sim, world, level]);

  // ---- Online turn time: a turn that runs out is skipped (either app reports it; the server checks) ----
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!online) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, [online]);
  const secondsLeft = online && row?.status === "active" && !sim ? Math.max(0, Math.ceil((deadline(row) - net.now()) / 1000)) : null;
  const reported = useRef(0);
  useEffect(() => {
    if (secondsLeft !== 0 || !row || Date.now() - reported.current < 2000) return;
    reported.current = Date.now();
    net.act({ type: "timeout", step: row.step });
  });

  // ---- Sounds: your turn (online), and the end of the battle ----
  const heard = useRef<{ mine: boolean; over: boolean; seed: number } | null>(null);
  const mine = online && canAct;
  useEffect(() => {
    if (!loaded || (online && !row)) return;
    const prev = heard.current;
    heard.current = { mine, over: !!world.over, seed: world.seed };
    if (!prev || prev.seed !== world.seed) return;
    if (mine && !prev.mine) playSound("turn");
    if (world.over && !prev.over) {
      const w = world.over.winner;
      playSound(w === null ? "lose" : mode === "two" && !online ? "win" : w === you ? "win" : "lose");
    }
  }, [loaded, mine, world.over, world.seed]);
  useEffect(() => {
    window.addEventListener("pointerdown", unlockSound, { once: true });
    window.addEventListener("keydown", unlockSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
    };
  }, []);

  // Online, in another tab: the tab's title says when it's your shot.
  useEffect(() => {
    if (!online) return;
    const base = document.title;
    const update = () => {
      document.title = mine && document.hidden ? "● your shot · tanks" : base;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [online, mine]);

  // ---- Keyboard: ← → turn the barrel, ↑ ↓ power (shift: by 5), space fires, f full screen ----
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "f") return full ? exitFull() : enterFull();
    if (e.key === "Escape" && full) return exitFull();
    if (!canAct) return;
    const by = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [by, 0],
      ArrowRight: [-by, 0],
      ArrowUp: [0, by],
      ArrowDown: [0, -by],
    };
    if (moves[e.key]) {
      e.preventDefault();
      nudge(...moves[e.key]);
    } else if (e.key === " " || e.key === "Enter") {
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      shoot();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Full screen: the field fills the window (the browser goes full screen where it can; iPhones can't).
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
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const newBattle = () => {
    setSim(null);
    setThinking(false);
    setWorld(newWorld(randomSeed()));
    buzz(12);
  };
  const startOnline = async () => {
    setOnlineMsg("opening a battle…");
    try {
      const id = await createBattle(myName);
      setOnlineMsg(null);
      router.push(`/extras/tanks/${id}`);
    } catch (e) {
      setOnlineMsg(e instanceof Error ? e.message : "Couldn't open a battle.");
    }
  };
  const resign = () => {
    if (!confirmResign) return setConfirmResign(true);
    setConfirmResign(false);
    buzz(20);
    net.act({ type: "resign" });
  };
  const rematch = async () => {
    const res = await net.act({ type: "rematch" });
    if (res.next) router.push(`/extras/tanks/${res.next}`);
  };
  const inviteUrl = gameId && typeof window !== "undefined" ? `${window.location.origin}/extras/tanks/${gameId}` : "";
  const copyInvite = async () => {
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "tanks on lockin.", url: inviteUrl });
      else {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  // ---- What the header says ----
  const status = (() => {
    if (online && !row) return { text: net.error ?? "loading…", over: !!net.error };
    if (online && row?.status === "waiting")
      return {
        text: row.p1 === net.me ? "waiting for your opponent to open the link." : "joining…",
        over: false,
      };
    if (online && row?.reason === "cancelled") return { text: "this battle was cancelled.", over: true };
    if (world.over) {
      const { winner, reason } = world.over;
      const why = reason === "destroyed" ? "" : ` (${reason})`;
      if (winner === null) return { text: `it's a draw${why}.`, over: true };
      if (online || mode === "cpu")
        return {
          text: winner === you ? `you win${why}.` : `${names[winner]} wins${why}.`,
          over: true,
        };
      return { text: `${names[winner]} wins${why}.`, over: true };
    }
    if (sim)
      return {
        text: `${names[sim.by] === "you" ? "you fire" : `${names[sim.by]} fires`} ${weapon(sim.shot.weapon).name}.`,
        over: false,
      };
    if (thinking) return { text: "computer is aiming…", over: false };
    const who = names[world.turn];
    return {
      text: who === "you" ? "your shot." : `${who}'s shot.`,
      over: false,
    };
  })();

  // Health goes down live while a shot is in flight.
  const shown = sim ? sim.world : world;
  const timer =
    secondsLeft !== null && !world.over ? <span className={`font-mono text-[12px] tabular-nums ${secondsLeft <= 10 ? "text-red" : "text-dim"}`}>{secondsLeft}s</span> : null;
  const left = (ammo: number) => (ammo === Infinity ? "∞" : String(ammo));

  return (
    <Page>
      <motion.header variants={fadeUp} className="flex items-baseline justify-between gap-4 pb-6">
        <div className="flex items-baseline gap-3">
          <Link href="/extras" className="font-mono text-[12px] text-mute transition hover:text-fg">
            extras /
          </Link>
          <span className="dot text-lg">tanks</span>
        </div>
        <span className={`truncate font-mono text-[13px] ${status.over ? "text-red" : "text-mute"}`}>{status.text}</span>
      </motion.header>

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-14">
        <motion.div variants={fadeUp} className={full ? "fixed inset-0 z-[60] overflow-y-auto bg-ink px-3 py-3" : "lg:col-span-8"}>
          {/* Full screen on a phone held sideways: the controls go in a column beside the field. */}
          <div
            className={
              full
                ? "flex min-h-full flex-col justify-center gap-4 [@media(orientation:landscape)_and_(max-height:540px)]:flex-row [@media(orientation:landscape)_and_(max-height:540px)]:items-center"
                : ""
            }
          >
            <div
              className={
                full
                  ? "mx-auto w-[min(100%,calc((100dvh-250px)*16/9))] shrink-0 [@media(orientation:landscape)_and_(max-height:540px)]:mx-0 [@media(orientation:landscape)_and_(max-height:540px)]:w-[min(100%-230px,calc((100dvh-60px)*16/9))]"
                  : ""
              }
            >
              <div className="mb-2 flex items-center justify-between gap-4">
                <TankLabel name={names[0]} hp={shown.tanks[0].hp} color={TANK_COLOR[0]} active={!world.over && world.turn === 0} extra={world.turn === 0 ? timer : null} />
                {full && (
                  <button
                    onClick={exitFull}
                    aria-label="exit full screen"
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg"
                  >
                    <Minimize2 className="size-3.5" />
                  </button>
                )}
                <TankLabel name={names[1]} hp={shown.tanks[1].hp} color={TANK_COLOR[1]} active={!world.over && world.turn === 1} right extra={world.turn === 1 ? timer : null} />
              </div>
              <div className="overflow-hidden rounded-lg border border-line">
                <Field
                  world={world}
                  sim={sim}
                  onLanded={landed}
                  aim={canAct || thinking ? aim : null}
                  aimSide={canAct ? world.turn : null}
                  onAim={(a) => setAim((x) => ({ ...x, ...a }))}
                />
              </div>
            </div>

            {/* The controls: weapon, angle, power, drive, fire. */}
            <div
              className={`space-y-3 transition-opacity ${canAct || thinking ? "" : "opacity-60"} ${full ? "mx-auto w-[min(100%,calc((100dvh-250px)*16/9))] [@media(orientation:landscape)_and_(max-height:540px)]:mx-0 [@media(orientation:landscape)_and_(max-height:540px)]:w-auto [@media(orientation:landscape)_and_(max-height:540px)]:min-w-0 [@media(orientation:landscape)_and_(max-height:540px)]:flex-1" : "mt-4"}`}
            >
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {WEAPONS.map((w) => {
                  const n = ammoOf(world.tanks[canAct ? world.turn : controls], w.id);
                  const on = aim.weapon === w.id;
                  return (
                    <button
                      key={w.id}
                      disabled={!canAct || n <= 0}
                      onClick={() => {
                        buzz();
                        setAim((a) => ({ ...a, weapon: w.id }));
                      }}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition disabled:opacity-35 ${on ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:border-fg hover:text-fg"}`}
                    >
                      {w.name}
                      <span className={`font-mono text-[11px] ${on ? "text-ink/70" : "text-dim"}`}>{left(n)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="font-mono text-[12px] text-dim [@media(orientation:landscape)_and_(max-height:540px)]:hidden">
                {weapon(aim.weapon).name}: {weapon(aim.weapon).about}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Adjust label="angle" value={`${aim.angle}°`} disabled={!canAct} onStep={(d) => nudge(d, 0)} />
                <Adjust label="power" value={String(aim.power)} disabled={!canAct} onStep={(d) => nudge(0, d)} />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase">drive</span>
                  <div className="inline-flex items-center rounded-full border border-line-2">
                    <button
                      onClick={() => driveTank(-1)}
                      disabled={!canAct || tank.moves <= 0}
                      aria-label="drive left"
                      className="grid size-9 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-8 text-center font-mono text-[13px] text-fg tabular-nums" title="drives left">
                      {world.tanks[canAct ? world.turn : controls].moves}/{MOVES}
                    </span>
                    <button
                      onClick={() => driveTank(1)}
                      disabled={!canAct || tank.moves <= 0}
                      aria-label="drive right"
                      className="grid size-9 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </div>
                <motion.button
                  onClick={shoot}
                  disabled={!canAct}
                  whileTap={{ scale: 0.94 }}
                  data-cursor="go"
                  className="ml-auto flex items-center gap-2 rounded-full bg-red px-7 py-2.5 text-[15px] font-medium text-white transition disabled:opacity-35"
                >
                  fire
                </motion.button>
              </div>
              {net.notice && (
                <p role="alert" className="font-mono text-[12px] text-red">
                  {net.notice}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        <aside className="mt-8 lg:sticky lg:top-10 lg:col-span-4 lg:mt-0">
          {online && (
            <Section label="online battle" right={row ? row.status : undefined}>
              <div className="space-y-4">
                {row?.p1 === net.me && row?.status === "waiting" && (
                  <div>
                    <p className="mb-2 text-[14px] text-mute">Send this link to your opponent. Whoever opens it first takes the red tank.</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={inviteUrl}
                        onFocus={(e) => e.target.select()}
                        className="min-w-0 flex-1 border-b border-line-2 bg-transparent py-2 font-mono text-[12.5px] text-mute outline-none"
                      />
                      <button
                        onClick={copyInvite}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-3.5 py-1.5 text-[13px] text-mute transition hover:border-fg hover:text-fg"
                      >
                        <Copy className="size-3.5" /> {copied ? "copied" : "copy link"}
                      </button>
                    </div>
                  </div>
                )}
                {row?.status === "active" && <p className="text-[14px] text-mute">You have a minute for each shot. Let it run out three times in a row and you lose.</p>}
                {row?.status === "over" && row.reason !== "cancelled" && (
                  <div className="flex flex-wrap gap-2">
                    {row.next ? (
                      <Link href={`/extras/tanks/${row.next}`} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink">
                        <Swords className="size-3.5" /> play the rematch
                      </Link>
                    ) : (
                      <button
                        onClick={rematch}
                        disabled={net.busy}
                        data-cursor="go"
                        className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40"
                      >
                        <Swords className="size-3.5" /> rematch
                      </button>
                    )}
                  </div>
                )}
                {row?.status === "active" && (
                  <button
                    onClick={resign}
                    onBlur={() => setConfirmResign(false)}
                    disabled={net.busy}
                    data-cursor="danger"
                    className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] transition disabled:opacity-40 ${confirmResign ? "border-red text-red" : "border-line-2 text-mute hover:border-red hover:text-red"}`}
                  >
                    <Flag className="size-3.5" /> {confirmResign ? "tap again to give up" : "give up"}
                  </button>
                )}
                {row?.status === "waiting" && row.p1 === net.me && (
                  <button
                    onClick={() => net.act({ type: "cancel" })}
                    disabled={net.busy}
                    data-cursor="danger"
                    className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-red hover:text-red disabled:opacity-40"
                  >
                    cancel this battle
                  </button>
                )}
                {net.error && <p className="font-mono text-[12px] text-red">{net.error}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={startOnline}
                    className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg"
                  >
                    <Globe className="size-3.5" /> new online battle
                  </button>
                  <Link
                    href="/extras/tanks"
                    className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg"
                  >
                    play on this device
                  </Link>
                </div>
                {onlineMsg && <p className="font-mono text-[12px] text-mute">{onlineMsg}</p>}
              </div>
            </Section>
          )}

          <Section label={online ? "settings" : "battle"}>
            <div className="space-y-4">
              {!online && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[15px]">opponent</span>
                  <Segmented<Mode>
                    id="tanks-mode"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "cpu", label: "computer" },
                      { value: "two", label: "2 players" },
                    ]}
                  />
                </div>
              )}
              {!online && mode === "cpu" && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[15px]">level</span>
                  <Segmented<Level>
                    id="tanks-level"
                    value={level}
                    onChange={setLevel}
                    options={[
                      { value: "easy", label: "easy" },
                      { value: "medium", label: "medium" },
                      { value: "hard", label: "hard" },
                    ]}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px]">sound</span>
                <Segmented<"on" | "off">
                  id="tanks-sound"
                  value={sound ? "on" : "off"}
                  onChange={(v) => {
                    setSound(v === "on");
                    setSoundOn(v === "on");
                  }}
                  options={[
                    { value: "on", label: "on" },
                    { value: "off", label: "off" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {!online && (
                  <button onClick={newBattle} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink">
                    <RotateCcw className="size-3.5" /> new battle
                  </button>
                )}
                {!online && (
                  <button
                    onClick={startOnline}
                    className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg"
                  >
                    <Globe className="size-3.5" /> play online
                  </button>
                )}
                <button
                  onClick={enterFull}
                  className="flex items-center gap-1.5 rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg"
                >
                  <Maximize2 className="size-3.5" /> full screen
                </button>
              </div>
              {!online && onlineMsg && <p className="font-mono text-[12px] text-mute">{onlineMsg}</p>}
            </div>
          </Section>

          {!online && battles.games.length > 0 && (
            <Section label="your online battles">
              {battles.games.map((g) => {
                const opp = g.p2 ? (g.p1 === battles.me ? g.p2_name : g.p1_name) || "opponent" : null;
                return (
                  <Link key={g.id} href={`/extras/tanks/${g.id}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-ink-2">
                    <span className={`size-1.5 rounded-full ${g.status === "active" ? "bg-red" : "bg-dot-off"}`} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{opp ? `vs ${opp}` : "waiting for an opponent"}</span>
                    <span className="font-mono text-[12px] text-dim">{battleState(g, battles.me)}</span>
                  </Link>
                );
              })}
            </Section>
          )}

          <Section label="how to play">
            <ul className="space-y-1.5 text-[14px] text-mute">
              <li>Drag on the field to aim: the direction from your tank is the angle, the distance is the power. Fine-tune with − and +.</li>
              <li className="lg:hidden">On a phone, turn it sideways and tap full screen.</li>
              <li>Watch the wind at the top: it changes every turn and pushes every shot.</li>
              <li>Blasts hurt any tank nearby, yours too. A tank at 0 is out; after {MAX_SHOTS} shots, more health wins.</li>
              <li>You can drive {MOVES} times a battle. Driving doesn&apos;t use up your shot.</li>
              <li className="hidden lg:list-item">Keys: ← → angle, ↑ ↓ power (shift for 5), space fires, f full screen.</li>
            </ul>
            <Label className="mt-5 mb-2">weapons</Label>
            <div className="space-y-1 font-mono text-[12.5px]">
              {WEAPONS.map((w) => (
                <div key={w.id} className="grid grid-cols-[5.5rem_2rem_1fr] gap-2">
                  <span className="text-fg">{w.name}</span>
                  <span className="text-dim">{left(w.count)}</span>
                  <span className="text-mute">{w.about}</span>
                </div>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </Page>
  );
}
