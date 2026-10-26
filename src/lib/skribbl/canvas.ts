// The skribbl drawing, as a list of operations every app replays onto its own canvas. The drawer's app sends them
// over a Realtime broadcast a few times a second; nothing is stored. The canvas is always 800×600 (scaled to fit the
// screen), so a fill spreads over the same pixels on every device.

export const W = 800;
export const H = 600;
/** Brush diameters, in canvas pixels. */
export const SIZES = [4, 9, 16, 28, 44];
/** Colours are --color-sketch-0 … in globals.css; 0 is the paper (the eraser paints with it). */
export const COLORS = 22;
export const PAPER = 0;
export const INK = 1;

/** A stroke piece through points [x0, y0, x1, y1, …] (one point: a dot), or a fill. `g` groups one undo step. */
export type DrawOp = { k: "l"; g: number; c: number; w: number; p: number[] } | { k: "f"; g: number; c: number; x: number; y: number };
/** u: undo the last group · x: clear. */
export type Op = DrawOp | { k: "u" } | { k: "x" };

/** The palette, read once from the CSS tokens (they don't change with the theme: a drawing looks the same to all). */
export function readPalette() {
  const css = getComputedStyle(document.documentElement);
  return Array.from({ length: COLORS }, (_, i) => css.getPropertyValue(`--color-sketch-${i}`).trim() || "#000");
}

function rgb(color: string): [number, number, number] {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function clearCanvas(ctx: CanvasRenderingContext2D, palette: string[]) {
  ctx.fillStyle = palette[PAPER];
  ctx.fillRect(0, 0, W, H);
}

/**
 * Paint-bucket fill from (x, y) over every connected pixel close in colour to the one clicked. The tolerance takes in
 * the soft (anti-aliased) edge of strokes, so a filled shape doesn't keep a pale rim inside its outline.
 */
export function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;
  const start = (y * W + x) * 4;
  const [tr, tg, tb] = [d[start], d[start + 1], d[start + 2]];
  const [fr, fg, fb] = rgb(color);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 8) return;
  const TOLERANCE = 110;
  const near = (i: number) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= TOLERANCE;
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  stack[top++] = y * W + x;
  seen[y * W + x] = 1;
  while (top) {
    const n = stack[--top];
    const i = n * 4;
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
    const px = n % W;
    const py = (n - px) / W;
    const visit = (m: number) => {
      if (!seen[m] && near(m * 4)) {
        seen[m] = 1;
        stack[top++] = m;
      }
    };
    if (px > 0) visit(n - 1);
    if (px < W - 1) visit(n + 1);
    if (py > 0) visit(n - W);
    if (py < H - 1) visit(n + W);
  }
  ctx.putImageData(image, 0, 0);
}

export function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp, palette: string[]) {
  const color = palette[op.c] ?? palette[INK];
  if (op.k === "f") return floodFill(ctx, op.x, op.y, color);
  const p = op.p;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineWidth = op.w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

export function replay(ctx: CanvasRenderingContext2D, ops: DrawOp[], palette: string[]) {
  clearCanvas(ctx, palette);
  for (const op of ops) drawOp(ctx, op, palette);
}

/**
 * Applies one op to the drawing's log and canvas. Drawing ops paint on top; undo and clear rewrite the log and repaint.
 * Returns the new log (the same array when only appended).
 */
export function applyOp(ctx: CanvasRenderingContext2D, log: DrawOp[], op: Op, palette: string[]): DrawOp[] {
  if (op.k === "x") {
    clearCanvas(ctx, palette);
    return [];
  }
  if (op.k === "u") {
    const last = log.at(-1)?.g;
    if (last == null) return log;
    const next = log.filter((o) => o.g !== last);
    replay(ctx, next, palette);
    return next;
  }
  log.push(op);
  drawOp(ctx, op, palette);
  return log;
}

const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const MAX_POINTS = 4000;

/** Checks an op that came over the network (any player could send anything). */
export function validOp(x: unknown): x is Op {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.k === "u" || o.k === "x") return true;
  if (!num(o.g, 0, Number.MAX_SAFE_INTEGER) || !Number.isInteger(o.c) || !num(o.c, 0, COLORS - 1)) return false;
  if (o.k === "f") return num(o.x, 0, W) && num(o.y, 0, H);
  if (o.k !== "l" || !num(o.w, 1, 64) || !Array.isArray(o.p) || o.p.length < 2 || o.p.length % 2 || o.p.length > MAX_POINTS) return false;
  return o.p.every((v, i) => num(v, -50, i % 2 ? H + 50 : W + 50));
}

/** Splits a drawing into broadcast-sized pieces (a message has a size limit). */
export function chunks(log: DrawOp[], maxNumbers = 6000) {
  const out: DrawOp[][] = [[]];
  let size = 0;
  for (const op of log) {
    const n = op.k === "l" ? op.p.length + 4 : 6;
    if (size + n > maxNumbers && out.at(-1)!.length) {
      out.push([]);
      size = 0;
    }
    out.at(-1)!.push(op);
    size += n;
  }
  return out;
}
