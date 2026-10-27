"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { playSound } from "../../lib/tanks/sound";
import { BARREL, finish, groundAt, H, HZ, MAX_HP, pivotOf, step, W, type Side, type Sim, type World } from "../../lib/tanks/world";

// The battlefield, drawn on a canvas: dotted ground (the app's dot-matrix look) with a bright edge, the two tanks
// with their health bars, the wind, the aim of the tank whose turn it is, and a shot in flight with its blasts,
// debris, damage numbers and a little screen shake. A shot (`sim`) is stepped here in real time; once it's done
// and the dust has settled, `onLanded` gets the world after it. Dragging on the field aims (angle: the direction
// from the tank, power: the distance).

export interface Aim {
  angle: number;
  power: number;
}

interface Blast {
  x: number;
  y: number;
  r: number;
  born: number;
  dirt: boolean;
}
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  dirt: boolean;
}
interface Float {
  x: number;
  y: number;
  text: string;
  born: number;
}

const COLORS = ["fg", "mute", "dim", "dot-off", "red", "tank-0", "tank-1", "blast"] as const;
type Palette = Record<(typeof COLORS)[number], string>;
const readPalette = (): Palette => {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(COLORS.map((c) => [c, css.getPropertyValue(`--color-${c}`).trim() || "#888"])) as Palette;
};

/** Dot spacing and size of the ground, in CSS pixels. */
const DOT_GAP = 5;
const DOT_R = 1.1;
/** How long after the last blast a shot counts as landed (ms). */
const SETTLE_MS = 650;

export function Field({
  world,
  sim,
  onLanded,
  aim,
  aimSide,
  onAim,
}: {
  world: World;
  sim: Sim | null;
  onLanded: (after: World) => void;
  /** The aim to show for the tank whose turn it is (its last shot's aim otherwise). */
  aim: Aim | null;
  /** The tank the pointer aims, or null when you can't aim now. */
  aimSide: Side | null;
  onAim?: (aim: Aim) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef({ world, sim, onLanded, aim, aimSide, onAim });
  props.current = { world, sim, onLanded, aim, aimSide, onAim };
  /** Where each tank is drawn: it drives over to where the world says it is. */
  const shownX = useRef<number[] | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const ground = document.createElement("canvas");
    const cache = {
      ground: null as number[] | null,
      version: -1,
      width: 0,
      palette: "",
    };
    let size = { w: 0, h: 0, dpr: 1 };
    let palette = readPalette();
    let font = "monospace";
    let frames = 0;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let seen: Sim | null = null;
    let counts = { booms: 0, hits: 0, bounces: 0 };
    let lastBlast = 0;
    let landed: Sim | null = null;
    let seed = -1;
    const driving = [false, false];
    let shake = 0;
    let flash = 0;
    const blasts: Blast[] = [];
    const bits: Bit[] = [];
    const floats: Float[] = [];

    const resize = () => {
      const w = wrap.current!.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w, h: (w * H) / W, dpr };
      el.width = Math.round(w * dpr);
      el.height = Math.round(size.h * dpr);
      el.style.height = `${size.h}px`;
      ground.width = el.width;
      ground.height = el.height;
      cache.width = 0;
      font = getComputedStyle(el).fontFamily || "monospace";
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);
    resize();

    const drawGround = (heights: number[], s: number) => {
      const g = ground.getContext("2d")!;
      g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);
      g.fillStyle = palette.dim;
      g.beginPath();
      for (let cx = DOT_GAP / 2; cx < size.w; cx += DOT_GAP) {
        const top = size.h - groundAt(heights, cx / s) * s;
        for (let cy = size.h - DOT_GAP / 2; cy > top; cy -= DOT_GAP) {
          g.moveTo(cx + DOT_R, cy);
          g.arc(cx, cy, DOT_R, 0, Math.PI * 2);
        }
      }
      g.fill();
      g.strokeStyle = palette.mute;
      g.lineWidth = 1.5;
      g.lineJoin = "round";
      g.beginPath();
      for (let cx = 0; cx <= size.w; cx += 2) {
        const y = size.h - groundAt(heights, cx / s) * s;
        if (cx === 0) g.moveTo(cx, y);
        else g.lineTo(cx, y);
      }
      g.stroke();
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (++frames % 30 === 0) palette = readPalette();
      const p = props.current;
      const sim = p.sim;

      // ---- Run the shot ----
      if (sim !== seen) {
        seen = sim;
        counts = { booms: 0, hits: 0, bounces: 0 };
        acc = 0;
        lastBlast = 0;
        if (sim) playSound("fire");
      }
      if (sim && !sim.done) {
        acc += dt;
        for (let n = 0; acc >= 1 / HZ && n < 12 && !sim.done; n++) {
          step(sim);
          acc -= 1 / HZ;
        }
      }
      if (sim) {
        for (const b of sim.booms.slice(counts.booms)) {
          blasts.push({ x: b.x, y: b.y, r: b.radius, born: t, dirt: b.dirt });
          lastBlast = t;
          const big = b.radius >= 60;
          playSound(b.dirt ? "dirt" : big ? "big" : "boom");
          shake = Math.max(shake, big ? 16 : b.dirt ? 3 : b.radius / 5);
          if (big) flash = 1;
          for (let i = 0; i < (big ? 46 : 18); i++) {
            const a = Math.random() * Math.PI;
            const v = (60 + Math.random() * 160) * (big ? 1.6 : 1);
            bits.push({
              x: b.x,
              y: b.y + 2,
              vx: Math.cos(a) * v,
              vy: Math.sin(a) * v,
              born: t,
              life: 600 + Math.random() * 500,
              dirt: b.dirt || Math.random() < 0.55,
            });
          }
        }
        for (const h of sim.hits.slice(counts.hits)) {
          const tank = sim.world.tanks[h.tank];
          floats.push({
            x: tank.x,
            y: groundAt(sim.world.ground, tank.x) + 34,
            text: `-${h.damage}`,
            born: t,
          });
          if (!h.fall) playSound("hit");
        }
        if (sim.bounces.length > counts.bounces) playSound("bounce");
        counts = {
          booms: sim.booms.length,
          hits: sim.hits.length,
          bounces: sim.bounces.length,
        };
        if (sim.done && landed !== sim && t - lastBlast > SETTLE_MS) {
          landed = sim;
          p.onLanded(finish(sim));
        }
      }

      const w = sim ? sim.world : p.world;
      const s = size.w / W;
      if (!size.w) return;

      // ---- Tanks drive over to where they are ----
      if (!shownX.current || w.seed !== seed) {
        shownX.current = w.tanks.map((k) => k.x);
        seed = w.seed;
        blasts.length = bits.length = floats.length = 0;
      }
      const xs = shownX.current;
      w.tanks.forEach((k, i) => {
        const diff = k.x - xs[i];
        if (Math.abs(diff) < 0.5) {
          xs[i] = k.x;
          driving[i] = false;
          return;
        }
        if (!driving[i]) playSound("drive");
        driving[i] = true;
        xs[i] += Math.sign(diff) * Math.min(Math.abs(diff), 110 * dt);
      });

      // ---- Draw ----
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      shake *= 0.88;
      if (shake > 0.3) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
      const X = (x: number) => x * s;
      const Y = (y: number) => size.h - y * s;

      const key = `${palette.dim}${palette.mute}`;
      if (cache.ground !== w.ground || cache.version !== (sim?.groundVersion ?? -1) || cache.width !== size.w || cache.palette !== key) {
        drawGround(w.ground, s);
        Object.assign(cache, {
          ground: w.ground,
          version: sim?.groundVersion ?? -1,
          width: size.w,
          palette: key,
        });
      }
      ctx.drawImage(ground, 0, 0, size.w, size.h);

      // Wind, top middle: an arrow as long as the wind is strong.
      ctx.font = `11px ${font}`;
      ctx.textAlign = "center";
      ctx.fillStyle = palette.mute;
      ctx.strokeStyle = palette.mute;
      ctx.fillText(w.wind ? `wind ${Math.abs(w.wind)}` : "no wind", size.w / 2, 16);
      if (w.wind) {
        const len = 6 + Math.abs(w.wind) * 3;
        const dir = Math.sign(w.wind);
        const y = 25;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(size.w / 2 - (dir * len) / 2, y);
        ctx.lineTo(size.w / 2 + (dir * len) / 2, y);
        ctx.moveTo(size.w / 2 + (dir * len) / 2 - dir * 4, y - 3);
        ctx.lineTo(size.w / 2 + (dir * len) / 2, y);
        ctx.lineTo(size.w / 2 + (dir * len) / 2 - dir * 4, y + 3);
        ctx.stroke();
      }

      // Tanks, with a health bar above each.
      w.tanks.forEach((k, i) => {
        const x = xs[i];
        const gy = groundAt(w.ground, x);
        const color = palette[i === 0 ? "tank-0" : "tank-1"];
        const alive = k.hp > 0;
        ctx.globalAlpha = alive ? 1 : 0.35;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.roundRect(X(x - 13), Y(gy + 8), 26 * s, 8 * s, 3 * s);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(X(x), Y(gy + 8), 7 * s, Math.PI, 0);
        ctx.fill();
        const angle = alive && w.turn === i && p.aim && !sim ? p.aim.angle : k.angle;
        const a = (angle * Math.PI) / 180;
        const piv = pivotOf(w.ground, { ...k, x });
        ctx.lineWidth = Math.max(2, 3.5 * s);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(X(piv.x), Y(piv.y));
        ctx.lineTo(X(piv.x + Math.cos(a) * BARREL), Y(piv.y + Math.sin(a) * BARREL));
        ctx.stroke();
        ctx.globalAlpha = 1;
        const barW = Math.max(26, 32 * s);
        const barH = 3;
        const bx = X(x) - barW / 2;
        // Clear of the barrel, even pointing straight up.
        const by = Y(gy + 34) - 8;
        ctx.fillStyle = palette["dot-off"];
        ctx.beginPath();
        ctx.roundRect(bx, by, barW, barH, barH / 2);
        ctx.fill();
        if (k.hp > 0) {
          ctx.fillStyle = k.hp <= 25 ? palette.red : color;
          ctx.beginPath();
          ctx.roundRect(bx, by, Math.max(barH, (barW * k.hp) / MAX_HP), barH, barH / 2);
          ctx.fill();
        }
        // The aim: dots out from the barrel, more of them the harder it'll fire.
        if (alive && !sim && !w.over && w.turn === i && p.aim) {
          ctx.fillStyle = palette.fg;
          const dots = 2 + Math.round(p.aim.power / 7);
          for (let d = 1; d <= dots; d++) {
            const r = BARREL + 4 + d * 7;
            ctx.globalAlpha = 0.85 - (0.6 * d) / dots;
            ctx.beginPath();
            ctx.arc(X(piv.x + Math.cos(a) * r), Y(piv.y + Math.sin(a) * r), Math.max(1.2, 1.6 * s), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      });

      // The shot in flight.
      if (sim) {
        for (const b of sim.bullets) {
          if (b.dead) continue;
          ctx.fillStyle = palette.fg;
          b.trail.forEach((pt, j) => {
            ctx.globalAlpha = (0.5 * (j + 1)) / b.trail.length;
            ctx.beginPath();
            ctx.arc(X(pt.x), Y(pt.y), Math.max(1, 1.5 * s), 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.globalAlpha = 1;
          ctx.fillStyle = b.weapon === "nuke" ? palette.red : b.weapon === "dirt" ? palette.mute : palette.fg;
          ctx.beginPath();
          ctx.arc(X(b.x), Y(b.y), Math.max(2, (b.weapon === "nuke" ? 4.5 : 3) * s), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Blasts: a quick swell, then a fade.
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        const age = (t - b.born) / 1000;
        if (age > 0.7) {
          blasts.splice(i, 1);
          continue;
        }
        const grow = Math.min(1, age / 0.12);
        const fade = age < 0.12 ? 1 : 1 - (age - 0.12) / 0.58;
        ctx.globalAlpha = Math.max(0, fade) * (b.dirt ? 0.5 : 0.85);
        ctx.fillStyle = b.dirt ? palette.mute : palette.blast;
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), b.r * s * (0.4 + 0.6 * grow), 0, Math.PI * 2);
        ctx.fill();
        if (!b.dirt) {
          ctx.strokeStyle = palette.red;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Debris.
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        const age = t - b.born;
        if (age > b.life) {
          bits.splice(i, 1);
          continue;
        }
        b.vy -= 300 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        ctx.globalAlpha = 1 - age / b.life;
        ctx.fillStyle = b.dirt ? palette.dim : palette.blast;
        ctx.fillRect(X(b.x) - 1, Y(b.y) - 1, 2.2, 2.2);
      }
      ctx.globalAlpha = 1;
      // Damage numbers float up and fade.
      ctx.font = `600 13px ${font}`;
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        const age = (t - f.born) / 1200;
        if (age > 1) {
          floats.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - age * age;
        ctx.fillStyle = palette.red;
        ctx.fillText(f.text, X(f.x), Y(f.y + age * 25));
      }
      ctx.globalAlpha = 1;
      // The nuke's flash.
      if (flash > 0.02) {
        ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        ctx.globalAlpha = flash * 0.45;
        ctx.fillStyle = palette.fg;
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.globalAlpha = 1;
        flash *= 0.9;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const aimAt = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = props.current;
    if (p.aimSide === null || !p.onAim || p.sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const s = rect.width / W;
    const wx = (e.clientX - rect.left) / s;
    const wy = H - (e.clientY - rect.top) / s;
    const tank = p.world.tanks[p.aimSide];
    const piv = pivotOf(p.world.ground, {
      ...tank,
      x: shownX.current?.[p.aimSide] ?? tank.x,
    });
    const dx = wx - piv.x;
    const dy = wy - piv.y;
    let angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    if (angle < 0) angle = dx >= 0 ? 0 : 180;
    p.onAim({
      angle,
      power: Math.max(0, Math.min(100, Math.round(Math.hypot(dx, dy) / 2.2))),
    });
  };

  return (
    <div ref={wrap} className="w-full">
      <canvas
        ref={canvas}
        className="block w-full font-mono select-none"
        style={{
          touchAction: aimSide === null ? "auto" : "none",
          cursor: aimSide === null ? "default" : "crosshair",
        }}
        aria-label="the battlefield"
        onPointerDown={(e) => {
          if (props.current.aimSide === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          aimAt(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) aimAt(e);
        }}
      />
    </div>
  );
}
