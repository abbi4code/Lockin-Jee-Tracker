"use client";

import { useState } from "react";

// Small, dependency-free charts for the admin panel. Colours come from theme tokens; text never wears a series
// colour. Every chart has a hover readout line (the value under the pointer), so nothing is colour-only or
// hover-only: the readout repeats in words what the marks show.

export interface Series {
  name: string;
  color: string;
}

/** How the top-of-scale label is written (a string, so server pages can pass it to this client component). */
export type Unit = "minutes" | "count" | "level";
const formatMax = (n: number, unit: Unit) =>
  unit === "minutes" ? (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${Math.round(n % 60)}m` : ""}` : `${Math.round(n)}m`) : unit === "level" ? `L${Math.round(n)}` : String(Math.round(n));

export interface Column {
  key: string;
  /** x-axis label; empty for unlabeled ticks. */
  tick: string;
  /** One value per series, stacked bottom-up in series order. */
  parts: number[];
  /** What the readout says when this column is hovered. */
  tip: string;
  /** Today / the current period: its tick is drawn in the primary ink. */
  current?: boolean;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-mute">
      {series.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Columns over time (one per day), optionally stacked. `reference` draws a labelled hairline (e.g. the daily
 * target). Bars are capped at 24px wide with 4px rounded tops and 2px gaps between stacked segments.
 */
export function ColumnChart({
  columns,
  series,
  caption,
  height = 140,
  reference,
  unit,
}: {
  columns: Column[];
  series: Series[];
  caption: string;
  height?: number;
  reference?: { value: number; label: string };
  unit: Unit;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = columns.map((c) => c.parts.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, reference?.value ?? 0, 1);
  const y = (v: number) => (v / max) * height;
  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-h-5 font-mono text-[12.5px] text-fg" aria-live="polite">
          {hover != null ? columns[hover].tip : caption}
        </p>
        <Legend series={series} />
      </div>
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {/* Top-of-scale label + baseline + optional reference line (hairlines, recessive). */}
        {/* When the reference line sits at the top of the scale, its own label already says the value. */}
        {!(reference && reference.value >= max) && <span className="absolute -top-2 left-0 font-mono text-[10.5px] text-dim">{formatMax(max, unit)}</span>}
        <div className="absolute inset-x-0 bottom-0 h-px bg-line-2" />
        {reference && reference.value > 0 && (
          <div className="absolute inset-x-0 border-t border-line-2" style={{ bottom: y(reference.value) }}>
            <span className="absolute -top-4 right-0 font-mono text-[10.5px] text-dim">{reference.label}</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[2px] pl-8">
          {columns.map((c, i) => (
            <div
              key={c.key}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={c.tip}
              className={`flex h-full flex-1 cursor-default flex-col items-center justify-end outline-none ${hover === i ? "bg-ink-2" : ""}`}
            >
              <div className="flex w-full max-w-6 flex-col-reverse gap-[2px]">
                {c.parts.map((v, k) =>
                  v > 0 ? (
                    <div
                      key={k}
                      className={k === c.parts.findLastIndex((p) => p > 0) ? "rounded-t-[4px]" : ""}
                      style={{ height: Math.max(y(v), 2), background: series[k].color }}
                    />
                  ) : null,
                )}
                {totals[i] === 0 && <div className="h-[2px] rounded-full bg-dot-off" />}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[2px] pl-8">
        {columns.map((c) => (
          <span key={c.key} className={`flex-1 text-center font-mono text-[10px] ${c.current ? "text-fg" : "text-dim"}`}>
            {c.tick}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Test scores in the order they were taken: a 2px line through ringed dots, with 40% / 70% guide lines. */
export function ScoreLine({ points, caption, height = 160 }: { points: { key: string; value: number; tip: string }[]; caption: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const pad = 14;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - 2 * pad));
  const y = (v: number) => pad + (1 - v / 100) * (height - 2 * pad);
  return (
    <figure>
      <p className="mb-3 min-h-5 font-mono text-[12.5px] text-fg" aria-live="polite">
        {hover != null ? points[hover].tip : caption}
      </p>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
          {[40, 70].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="var(--color-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Dots as HTML so they stay round under the stretched SVG; the hit area is wider than the dot. */}
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={p.tip}
            className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center"
            style={{ left: `${(x(i) / W) * 100}%`, top: y(p.value) }}
          >
            <span className={`rounded-full ring-2 ring-ink ${hover === i ? "size-3" : "size-2.5"}`} style={{ background: p.value < 40 ? "var(--color-red)" : "var(--color-fg)" }} />
          </button>
        ))}
        <span className="absolute left-0 font-mono text-[10.5px] text-dim" style={{ top: y(70) - 16 }}>
          70%
        </span>
        <span className="absolute left-0 font-mono text-[10.5px] text-dim" style={{ top: y(40) - 16 }}>
          40%
        </span>
      </div>
    </figure>
  );
}
