"use client";

import { useEffect, useRef } from "react";

/**
 * Dot-matrix backdrop: a grid of dots with a slow diagonal light wave and occasional twinkles,
 * fading out downward. Static when the user prefers reduced motion.
 *
 * Built to stay cheap on phones: the dim grid is drawn once to an offscreen canvas and copied each frame, only
 * the dots the wave or a twinkle lights up are drawn on top, frames are capped at 30 fps, theme colours are read
 * only when the theme changes, and nothing runs until the page has loaded, while hidden, or while off-screen.
 */
export function DotField({ className = "", gap = 16, accent = false }: { className?: string; gap?: number; accent?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const base = document.createElement("canvas");
    const bctx = base.getContext("2d")!;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let fg = "236,236,236";
    let red = "255,59,48";
    const twinkles = new Map<number, number>(); // dot index → start time

    const rgb = (name: string, fallback: string) => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const n = parseInt(hex.replace("#", ""), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    };

    // The dim grid every frame starts from.
    const paintBase = () => {
      fg = rgb("--color-fg", "#ececec");
      red = rgb("--color-red", "#ff3b30");
      bctx.clearRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) {
        bctx.fillStyle = `rgba(${fg},${0.13 * (1 - r / rows)})`;
        bctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const x = c * gap + gap / 2;
          const y = r * gap + gap / 2;
          bctx.moveTo(x + 1.3, y);
          bctx.arc(x, y, 1.3, 0, Math.PI * 2);
        }
        bctx.fill();
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      cols = Math.ceil(w / gap);
      rows = Math.ceil(h / gap);
      for (const [el, c] of [
        [canvas, ctx],
        [base, bctx],
      ] as const) {
        el.width = w * dpr;
        el.height = h * dpr;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      paintBase();
      draw(performance.now(), true);
    };

    const draw = (t: number, force = false) => {
      if (!w || !h) return; // hidden (display: none) canvases have no size, and drawImage throws on a 0×0 source
      if (!force && t - last < 33) return; // ~30 fps is plenty for a slow wave
      last = t;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      if (still) return;
      if (Math.random() < 0.08) twinkles.set(Math.floor(Math.random() * cols * rows), t);
      // The wave depends only on the diagonal (row + col), so it's computed once per diagonal.
      const wave = new Float32Array(cols + rows);
      for (let d = 0; d < wave.length; d++) wave[d] = Math.max(0, Math.sin(d * 0.18 - t * 0.0011)) ** 8;
      for (let r = 0; r < rows; r++) {
        const fade = 1 - r / rows;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let spark = 0;
          const tw = twinkles.get(i);
          if (tw !== undefined) {
            const age = (t - tw) / 900;
            if (age > 1) twinkles.delete(i);
            else spark = Math.sin(age * Math.PI);
          }
          const extra = wave[r + c] * 0.35 + spark * 0.7;
          if (extra < 0.02) continue;
          ctx.fillStyle = spark > 0.3 && accent ? `rgba(${red},${(0.13 + extra) * fade})` : `rgba(${fg},${extra * fade})`;
          ctx.beginPath();
          ctx.arc(c * gap + gap / 2, r * gap + gap / 2, 1.3 + spark * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const loop = (t: number) => {
      draw(t);
      raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const resume = () => {
      if (!still && !raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    // Recolour when the theme changes.
    const themeWatch = new MutationObserver(() => {
      paintBase();
      draw(performance.now(), true);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      resume();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("resize", resize);

    // Start after the page has loaded and the browser is idle, so the backdrop never delays the content.
    const start = () => {
      resize();
      resume();
    };
    const idle = "requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 1500 }) : null;
    const timer = idle === null ? window.setTimeout(start, 400) : 0;

    return () => {
      cancelAnimationFrame(raf);
      if (idle !== null) window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
      themeWatch.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("resize", resize);
    };
  }, [gap, accent]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none ${className}`} />;
}
