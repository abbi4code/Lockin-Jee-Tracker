"use client";

import { AnimatePresence, motion } from "motion/react";
import { Brush, Eraser, PaintBucket, ThumbsDown, ThumbsUp, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { applyOp, chunks, clearCanvas, COLORS, drawOp, H, INK, PAPER, readPalette, SIZES, validOp, W, type DrawOp, type Op } from "../../lib/skribbl/canvas";
import { activePlayers, CHOOSE_MS } from "../../lib/skribbl/rules";
import type { Skribbl } from "../../lib/skribbl/room";
import { buzz } from "../Controls";
import { Label } from "../ui";
import { Avatar, CountUp, hueColor, useSecondsLeft } from "./parts";

// The drawing board. The drawer's strokes are sent as small batches of ops (lib/skribbl/canvas.ts) about ten times
// a second over the room's broadcast channel; every other app replays them. Someone who opens the room mid-turn
// asks for the drawing so far ("need"), and the drawer's app sends all of it ("sync"). If the drawer is the one who
// reloaded, the first other player who has the whole drawing answers instead.

type Tool = "brush" | "fill" | "eraser";
const FLUSH_MS = 100;
const SYNC_GAP_MS = 150;

/** A finished drawing, kept by this app for the gallery at the end of the game. */
export interface Drawing {
  key: string;
  word: string;
  drawer: string;
  hue: number;
  url: string;
}

export function Board({ s, onDrawing }: { s: Skribbl; onDrawing?: (d: Drawing) => void }) {
  const room = s.room!;
  const { me } = s;
  const canvas = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const palette = useRef<string[]>([]);
  const log = useRef<DrawOp[]>([]);
  /** This app has the whole drawing of this turn (it can answer a "need"). */
  const complete = useRef(false);
  /** A sync coming in (from whom), and the drawer's newer ops held back until it's all here. */
  const syncing = useRef<unknown>(null);
  const held = useRef<Op[]>([]);
  const outbox = useRef<Op[]>([]);
  const stroke = useRef<{ g: number; c: number; w: number; p: number[]; sent: number } | null>(null);
  const group = useRef(0);
  const ring = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState(INK);
  const [size, setSize] = useState(1);
  const [colors, setColors] = useState<string[]>([]);

  // One drawing per turn: the round, the drawer and when they started.
  const key = room.status === "drawing" || room.status === "reveal" ? `${room.round}:${room.drawer}:${room.turn_started_at}` : null;
  const keyRef = useRef(key);
  const drawer = room.drawer === me;
  const canDraw = drawer && room.status === "drawing";
  const latest = useRef({ drawer: room.drawer, me, players: s.players, online: s.online, onDrawing });
  latest.current = { drawer: room.drawer, me, players: s.players, online: s.online, onDrawing };

  // The turn's word and drawer, noted once it's revealed: the drawing is saved when the board clears for the next turn.
  const finished = useRef<Omit<Drawing, "url"> | null>(null);
  useEffect(() => {
    if (room.status !== "reveal" || !key || !room.last_word) return;
    const p = s.players.find((x) => x.user_id === room.drawer);
    finished.current = { key, word: room.last_word, drawer: p?.name ?? "someone", hue: p?.hue ?? 0 };
  }, [room.status, key, room.last_word]);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d", { willReadFrequently: true })!;
    ctxRef.current = ctx;
    palette.current = readPalette();
    setColors(palette.current);
    clearCanvas(ctx, palette.current);
  }, []);

  // A new turn starts on a clean sheet. A turn that started a moment ago is complete from its first stroke.
  useEffect(() => {
    const ctx = ctxRef.current;
    const prev = keyRef.current;
    if (ctx && prev && finished.current?.key === prev && log.current.length) latest.current.onDrawing?.({ ...finished.current, url: canvas.current!.toDataURL("image/jpeg", 0.85) });
    keyRef.current = key;
    if (!ctx) return;
    log.current = [];
    outbox.current = [];
    stroke.current = null;
    syncing.current = null;
    held.current = [];
    clearCanvas(ctx, palette.current);
    complete.current = !!key && room.status === "drawing" && s.now() - Date.parse(room.turn_started_at ?? "") < 2000;
    // Only the turn matters here: `room.status` and `s.now` are read for that moment.
  }, [key]);

  // Joined mid-turn (or reloaded): ask for the drawing so far once the channel is up.
  useEffect(() => {
    if (!key || complete.current || !s.connected) return;
    const t = window.setTimeout(() => s.sendDraw({ key, from: me, need: true }), 300);
    return () => window.clearTimeout(t);
  }, [key, s.connected, s.sendDraw, me]);

  const sendSync = useCallback(
    (k: string) => {
      const parts = chunks(log.current);
      parts.forEach((ops, part) => window.setTimeout(() => s.sendDraw({ key: k, from: me, sync: true, part, last: part === parts.length - 1, ops }), part * SYNC_GAP_MS));
    },
    [s.sendDraw, me],
  );

  // Ops from the drawer, and requests for the drawing.
  useEffect(
    () =>
      s.onDraw((msg) => {
        const ctx = ctxRef.current;
        const k = keyRef.current;
        if (!ctx || !k || msg.key !== k) return;
        const { drawer: d, me: self, players, online } = latest.current;
        if (msg.need) {
          if (!complete.current) return;
          if (self === d) return sendSync(k);
          // The drawer lost their own drawing: the first other player (in joining order) who's here answers.
          const helper = activePlayers(players).find((p) => p.user_id !== d && online.has(p.user_id));
          if (msg.from === d && helper?.user_id === self) sendSync(k);
          return;
        }
        const apply = (ops: unknown) => {
          for (const op of Array.isArray(ops) ? ops : []) if (validOp(op)) log.current = applyOp(ctx, log.current, op, palette.current);
        };
        if (msg.sync) {
          if (msg.part === 0) {
            // Already have the whole drawing: someone else asked.
            if (complete.current) return;
            syncing.current = msg.from;
            log.current = [];
            clearCanvas(ctx, palette.current);
          }
          if (syncing.current !== msg.from) return;
          apply(msg.ops);
          if (msg.last) {
            // The drawing so far is in: now the strokes drawn while it arrived.
            complete.current = true;
            syncing.current = null;
            apply(held.current);
            held.current = [];
          }
          return;
        }
        if (msg.from !== d || self === d || !Array.isArray(msg.ops)) return;
        if (syncing.current) held.current.push(...(msg.ops as Op[]));
        else apply(msg.ops);
      }),
    [s.onDraw, sendSync],
  );

  // The drawer's outbox goes out every FLUSH_MS (with the stroke in progress so far).
  const flushStroke = () => {
    const st = stroke.current;
    if (!st || st.p.length <= st.sent) return;
    // Each piece starts where the last one ended, so the line stays joined.
    const op: DrawOp = { k: "l", g: st.g, c: st.c, w: st.w, p: st.p.slice(Math.max(0, st.sent - 2)) };
    log.current.push(op);
    outbox.current.push(op);
    st.sent = st.p.length;
  };
  useEffect(() => {
    if (!canDraw || !key) return;
    const t = window.setInterval(() => {
      flushStroke();
      if (!outbox.current.length) return;
      s.sendDraw({ key, from: me, ops: outbox.current });
      outbox.current = [];
    }, FLUSH_MS);
    return () => window.clearInterval(t);
  }, [canDraw, key, s.sendDraw, me]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
  };
  const nextGroup = () => (group.current = Math.max(group.current + 1, Date.now()));
  const local = (op: Op) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    log.current = applyOp(ctx, log.current, op, palette.current);
    outbox.current.push(op);
  };

  const moveRing = (e: PointerEvent) => {
    const el = ring.current;
    if (!el) return;
    const r = canvas.current!.getBoundingClientRect();
    const d = (SIZES[size] * r.width) / W;
    el.style.width = el.style.height = `${d}px`;
    el.style.translate = `${e.clientX - r.left - d / 2}px ${e.clientY - r.top - d / 2}px`;
    el.style.opacity = canDraw && tool !== "fill" ? "1" : "0";
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.preventDefault();
    const [x, y] = point(e);
    if (tool === "fill") {
      buzz(6);
      return local({ k: "f", g: nextGroup(), c: color, x, y });
    }
    canvas.current!.setPointerCapture(e.pointerId);
    const st = { g: nextGroup(), c: tool === "eraser" ? PAPER : color, w: SIZES[size], p: [x, y], sent: 0 };
    stroke.current = st;
    drawOp(ctxRef.current!, { k: "l", g: st.g, c: st.c, w: st.w, p: [x, y] }, palette.current);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    moveRing(e);
    const st = stroke.current;
    if (!st || !canDraw) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = point(ev);
      const lx = st.p[st.p.length - 2];
      const ly = st.p[st.p.length - 1];
      if (x === lx && y === ly) continue;
      drawOp(ctxRef.current!, { k: "l", g: st.g, c: st.c, w: st.w, p: [lx, ly, x, y] }, palette.current);
      st.p.push(x, y);
    }
  };
  const onUp = () => {
    flushStroke();
    stroke.current = null;
  };

  const undo = useCallback(() => {
    if (!canDraw) return;
    flushStroke();
    stroke.current = null;
    buzz();
    local({ k: "u" });
  }, [canDraw]);
  const clear = useCallback(() => {
    if (!canDraw) return;
    stroke.current = null;
    buzz(12);
    local({ k: "x" });
  }, [canDraw]);

  // Keys while drawing: B brush, E eraser, F fill, U (or ⌘/Ctrl-Z) undo, C clear, 1–5 brush size.
  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        return undo();
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "b") setTool("brush");
      else if (k === "e") setTool("eraser");
      else if (k === "f") setTool("fill");
      else if (k === "u") undo();
      else if (k === "c") clear();
      else if (/^[1-5]$/.test(k)) setSize(Number(k) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDraw, undo, clear]);

  const self = s.players.find((p) => p.user_id === me);
  const votes = s.players.filter((p) => !p.gone && !p.kicked);
  const likes = votes.filter((p) => p.vote > 0).length;
  const dislikes = votes.filter((p) => p.vote < 0).length;

  // Thumbs float up the board when someone rates the drawing.
  const [floats, setFloats] = useState<{ id: number; up: boolean; hue: number; x: number }[]>([]);
  const lastVotes = useRef(new Map<string, number>());
  useEffect(() => {
    const seen = lastVotes.current;
    const fresh = s.players.filter((p) => p.vote !== 0 && seen.has(p.user_id) && seen.get(p.user_id) !== p.vote);
    lastVotes.current = new Map(s.players.map((p) => [p.user_id, p.vote]));
    if (!fresh.length) return;
    const added = fresh.map((p) => ({ id: Math.random(), up: p.vote > 0, hue: p.hue, x: 8 + Math.random() * 18 }));
    setFloats((f) => [...f, ...added]);
    const t = window.setTimeout(() => setFloats((f) => f.filter((x) => !added.includes(x))), 1800);
    return () => window.clearTimeout(t);
  }, [s.players]);
  const rate = self && !drawer && (
    <div className="flex items-center gap-2">
      {([1, -1] as const).map((v) => (
        <button
          key={v}
          onClick={() => {
            buzz();
            s.act({ type: "vote", value: self.vote === v ? 0 : v });
          }}
          aria-label={v > 0 ? "like the drawing" : "dislike the drawing"}
          aria-pressed={self.vote === v}
          className={`grid size-9 place-items-center rounded-full border transition ${self.vote === v ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:border-fg hover:text-fg"}`}
        >
          {v > 0 ? <ThumbsUp className="size-4" /> : <ThumbsDown className="size-4" />}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="relative overflow-hidden rounded-md border border-line-2" style={{ background: "var(--color-sketch-0)" }}>
        <canvas
          ref={canvas}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => ring.current && (ring.current.style.opacity = "0")}
          className={`block aspect-[4/3] w-full select-none ${canDraw ? "touch-none" : ""}`}
          aria-label={canDraw ? "drawing board: draw the word" : "the drawing"}
        />
        {/* The brush's size under the pointer. */}
        <div ref={ring} className="pointer-events-none absolute top-0 left-0 rounded-full border border-[color:var(--color-sketch-2)] opacity-0" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-1/2 w-1/3" aria-hidden>
          <AnimatePresence>
            {floats.map((f) => (
              <motion.span
                key={f.id}
                className="absolute bottom-2 grid size-9 place-items-center rounded-full text-ink"
                style={{ right: `${f.x}%`, background: hueColor(f.hue) }}
                initial={{ y: 0, opacity: 0, scale: 0.6 }}
                animate={{ y: -150, opacity: [0, 1, 1, 0], scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, ease: "easeOut" }}
              >
                {f.up ? <ThumbsUp className="size-4" /> : <ThumbsDown className="size-4" />}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <Overlay s={s} />
      </div>

      {canDraw ? (
        <Toolbar colors={colors} color={color} setColor={setColor} size={size} setSize={setSize} tool={tool} setTool={setTool} undo={undo} clear={clear} />
      ) : room.status === "reveal" ? (
        // The word and the points under the board, so the drawing stays in view.
        <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Label>the word was</Label>
              <div className="mt-0.5 text-[24px] leading-tight font-semibold tracking-tight lg:text-[28px]">{room.last_word}</div>
              <div className="font-mono text-[12px] text-dim">drawn by {s.players.find((p) => p.user_id === room.drawer)?.name ?? "someone"}</div>
            </div>
            <div className="flex items-center gap-3">
              {(likes > 0 || dislikes > 0) && (
                <span className="font-mono text-[12px] text-mute">
                  {likes} up · {dislikes} down
                </span>
              )}
              {rate}
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line pt-3">
            {[...activePlayers(s.players)]
              .sort((a, b) => b.turn_points - a.turn_points)
              .map((p) => (
                <li key={p.user_id} className="flex items-center gap-1.5 font-mono text-[12.5px]">
                  <Avatar hue={p.hue} size={8} />
                  <span className="text-mute">{p.user_id === me ? "you" : p.name}</span>
                  <span className={p.turn_points ? "text-red" : "text-dim"}>
                    +<CountUp value={p.turn_points} start={0} />
                  </span>
                </li>
              ))}
          </ul>
        </motion.div>
      ) : (
        room.status === "drawing" &&
        !drawer && (
          <div className="mt-3 flex items-center justify-end gap-3">
            {(likes > 0 || dislikes > 0) && (
              <span className="font-mono text-[12px] text-mute">
                {likes} up · {dislikes} down
              </span>
            )}
            <span className="font-mono text-[12px] text-dim">rate the drawing</span>
            {rate}
          </div>
        )
      )}
    </div>
  );
}

function Toolbar(p: { colors: string[]; color: number; setColor: (c: number) => void; size: number; setSize: (n: number) => void; tool: Tool; setTool: (t: Tool) => void; undo: () => void; clear: () => void }) {
  const toolButton = (t: Tool, Icon: typeof Brush, label: string, key: string) => (
    <button
      onClick={() => {
        buzz();
        p.setTool(t);
      }}
      aria-label={`${label} (${key})`}
      aria-pressed={p.tool === t}
      title={`${label} · ${key}`}
      className={`grid size-10 place-items-center rounded-full border transition ${p.tool === t ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:border-fg hover:text-fg"}`}
    >
      <Icon className="size-4" />
    </button>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
      {/* Two rows of swatches. */}
      <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label="colour">
        {Array.from({ length: COLORS }, (_, i) => (
          <button
            key={i}
            role="radio"
            aria-checked={p.color === i}
            aria-label={`colour ${i + 1}`}
            onClick={() => {
              buzz();
              p.setColor(i);
              if (p.tool === "eraser") p.setTool("brush");
            }}
            className={`size-6 rounded-full border transition lg:size-[22px] ${p.color === i ? "scale-110 border-fg ring-2 ring-fg ring-offset-2 ring-offset-ink" : "border-line-2"}`}
            style={{ background: p.colors[i] }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="brush size">
        {SIZES.map((w, i) => (
          <button
            key={w}
            role="radio"
            aria-checked={p.size === i}
            aria-label={`size ${i + 1}`}
            onClick={() => {
              buzz();
              p.setSize(i);
            }}
            className={`grid size-9 place-items-center rounded-full border transition ${p.size === i ? "border-fg" : "border-transparent hover:border-line-2"}`}
          >
            <span className="rounded-full bg-fg" style={{ width: 3 + i * 3.5, height: 3 + i * 3.5 }} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {toolButton("brush", Brush, "brush", "B")}
        {toolButton("fill", PaintBucket, "fill", "F")}
        {toolButton("eraser", Eraser, "eraser", "E")}
        <span className="mx-1 h-6 w-px bg-line-2" />
        <button onClick={p.undo} aria-label="undo (U)" title="undo · U" className="grid size-10 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
          <Undo2 className="size-4" />
        </button>
        <button onClick={p.clear} data-cursor="danger" aria-label="clear (C)" title="clear · C" className="grid size-10 place-items-center rounded-full border border-line-2 text-mute transition hover:border-red hover:text-red">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Over the board: picking a word, and the final ranking. (The reveal sits under the board, leaving the drawing in view.) */
function Overlay({ s }: { s: Skribbl }) {
  const room = s.room!;
  const { me, secret } = s;
  const active = activePlayers(s.players);
  const drawerName = s.players.find((p) => p.user_id === room.drawer)?.name ?? "someone";
  const pickLeft = useSecondsLeft(room.status === "choosing" ? Date.parse(room.phase_ends_at ?? "") : null, s.now);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [room.drawer, room.status]);

  let content: ReactNode = null;
  if (room.status === "choosing") {
    content =
      room.drawer === me ? (
        <div className="text-center">
          <Label className="mb-4">pick a word · {pickLeft ?? Math.round(CHOOSE_MS / 1000)}s</Label>
          <div className="flex flex-wrap justify-center gap-2">
            {secret.choices.length === 0 && <span className="font-mono text-[13px] text-mute">…</span>}
            {secret.choices.map((w, i) => (
              <button
                key={w}
                disabled={picked != null}
                onClick={async () => {
                  buzz(10);
                  setPicked(i);
                  if (!(await s.act({ type: "choose", index: i }))) setPicked(null);
                }}
                data-cursor="go"
                className={`rounded-full border px-5 py-2.5 text-[17px] font-medium transition ${picked === i ? "border-fg bg-fg text-ink" : "border-mute bg-ink text-fg hover:border-fg disabled:opacity-40"}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[17px] text-fg">
          <Avatar hue={s.players.find((p) => p.user_id === room.drawer)?.hue ?? 0} size={12} />
          {drawerName} is picking a word
          <motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
            …
          </motion.span>
        </div>
      );
  } else if (room.status === "over") {
    const ranked = [...active].sort((a, b) => b.score - a.score);
    const host = s.players.find((p) => p.user_id === room.host);
    content = (
      <div className="w-full max-w-sm text-center">
        <Label>game over</Label>
        <ol className="mt-4 space-y-2">
          {ranked.slice(0, 3).map((p, i) => (
            <motion.li key={p.user_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.2 + (2 - i) * 0.25 } }} className="flex items-center gap-3">
              <span className={`dot w-8 text-left leading-none ${i === 0 ? "text-[34px] text-red" : "text-[24px] text-mute"}`}>{i + 1}</span>
              <Avatar hue={p.hue} size={12} />
              <span className={`min-w-0 flex-1 truncate text-left ${i === 0 ? "text-[22px] font-semibold" : "text-[17px]"}`}>{p.name}</span>
              <span className="font-mono text-[13px] text-mute">{p.score}</span>
            </motion.li>
          ))}
        </ol>
        {ranked.length > 3 && (
          <p className="mt-3 font-mono text-[12px] text-dim">
            {ranked
              .slice(3)
              .map((p, i) => `${i + 4}. ${p.name} ${p.score}`)
              .join(" · ")}
          </p>
        )}
        <div className="mt-6">
          {room.host === me ? (
            <button onClick={() => s.act({ type: "again" })} data-cursor="go" className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink">
              play again
            </button>
          ) : (
            <p className="font-mono text-[12px] text-mute">waiting for {host?.name ?? "the host"} to start another game</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {content && (
        <motion.div
          key={room.status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // Fading out, it no longer takes clicks: the drawer can start the moment they've picked.
          exit={{ opacity: 0, pointerEvents: "none" }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 grid place-items-center overflow-y-auto bg-ink/90 p-5 text-fg backdrop-blur-md"
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
