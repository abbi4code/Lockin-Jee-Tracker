"use client";

import { Minus, Plus } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

export const buzz = (ms = 8) => navigator.vibrate?.(ms);

interface SegmentedProps<T extends string> {
  id: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}

/** Compact switch: the active option is a white pill that slides between choices. */
export function Segmented<T extends string>({ id, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="relative inline-flex rounded-full border border-line-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => {
              buzz();
              onChange(o.value);
            }}
            className={`relative z-10 rounded-full px-3 py-1 text-[13px] font-medium whitespace-nowrap transition-colors ${active ? "text-ink" : "text-mute hover:text-fg"}`}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-full bg-fg" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Square checkbox: white fill, black tick that draws itself. */
export function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <motion.button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        buzz(checked ? 5 : 10);
        onToggle();
      }}
      whileTap={{ scale: 0.85 }}
      className={`grid size-[18px] shrink-0 place-items-center rounded-[4px] border transition-colors duration-150 ${checked ? "border-fg bg-fg" : "border-line-2 hover:border-mute"}`}
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" style={{ stroke: "var(--color-ink)" }} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.2 }} />
      </svg>
    </motion.button>
  );
}

/** − value + over a fixed list of values. */
export function Stepper({ values, value, onChange, format = String, disabled = false, label }: { values: readonly number[]; value: number; onChange: (v: number) => void; format?: (v: number) => string; disabled?: boolean; label: string }) {
  const i = Math.max(0, values.indexOf(value));
  const step = (d: number) => {
    const next = values[i + d];
    if (next == null) return;
    buzz();
    onChange(next);
  };
  if (disabled) return <span className="font-mono text-[13px] text-fg">{format(value)}</span>;
  return (
    <div className="inline-flex items-center rounded-full border border-line-2">
      <button onClick={() => step(-1)} disabled={i === 0} aria-label={`fewer ${label}`} className="grid size-8 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30">
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-14 text-center font-mono text-[13px] text-fg">{format(value)}</span>
      <button onClick={() => step(1)} disabled={i === values.length - 1} aria-label={`more ${label}`} className="grid size-8 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
