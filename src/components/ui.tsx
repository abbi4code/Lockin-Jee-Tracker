"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { stageLabel, type Status } from "../lib/stages";

/** Calm entrance used by sections: a short fade with a 4px rise, no blur. */
export const fadeUp = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } },
} as const;

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase ${className}`}>{children}</div>;
}

/** A titled block separated by a hairline instead of a box. */
export function Section({ label, right, children, className = "" }: { label: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section variants={fadeUp} className={`border-t border-line pt-4 pb-7 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Label className="whitespace-nowrap">{label}</Label>
        {right && <div className="min-w-0 truncate text-right font-mono text-[12px] text-mute">{right}</div>}
      </div>
      {children}
    </motion.section>
  );
}

/** Row of dots filled in proportion to value (0–1). The fill sweeps in left to right. dots="auto" fills the available width. */
export function DotBar({ value, dots = 20, color = "var(--color-fg)", size = 5, gap = 3 }: { value: number; dots?: number | "auto"; color?: string; size?: number; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(24);
  useEffect(() => {
    if (dots !== "auto" || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(([entry]) => setFit(Math.max(4, Math.floor((entry.contentRect.width + gap) / (size + gap)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [dots, size, gap]);
  const count = dots === "auto" ? fit : dots;
  const filled = Math.round(Math.max(0, Math.min(1, value)) * count);
  return (
    <div ref={ref} className={`flex shrink-0 ${dots === "auto" ? "w-full" : ""}`} style={{ gap }} role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className="shrink-0 rounded-full"
          // Colour via CSS (so theme switches apply instantly); motion only animates the size.
          style={{
            width: size,
            height: size,
            background: i < filled ? color : "var(--color-dot-off)",
            transition: `background-color 0.25s ${i < filled ? Math.min(i * 0.015, 0.6) : 0}s`,
          }}
          initial={false}
          animate={{ scale: i < filled ? 1 : 0.8 }}
          transition={{ duration: 0.25, delay: i < filled ? Math.min(i * 0.015, 0.6) : 0 }}
        />
      ))}
    </div>
  );
}

/** Small mono tag, e.g. "adv only". */
export function Tag({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "red" | "fg" }) {
  const color = tone === "red" ? "text-red border-red/40" : tone === "fg" ? "text-fg border-line-2" : "text-mute border-line-2";
  return <span className={`inline-flex items-center rounded-[4px] border px-1.5 py-px font-mono text-[10.5px] tracking-wider uppercase ${color}`}>{children}</span>;
}

/** Collapsed-by-default block for anything that could pull attention (videos, books). */
export function Disclosure({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 py-4 text-left">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="size-3.5 text-mute" />
        </motion.span>
        <Label>{label}</Label>
        {count != null && <span className="font-mono text-[12px] text-dim">{count}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="pb-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Stage glyph: hollow (undone) → half (working / test) → solid (ready, mains, adv); weak is solid red. */
export function StatusDot({ status }: { status: Status }) {
  const ring = status === "undone" ? "var(--color-line-2)" : status === "working" || status === "weak" ? "var(--color-red)" : "var(--color-fg)";
  return (
    <span className="relative inline-block size-2.5 shrink-0 rounded-full border" style={{ borderColor: ring }} title={stageLabel(status)}>
      {(status === "working" || status === "testing") && (
        <span className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(90deg, ${ring} 50%, transparent 50%)` }} />
      )}
      {(status === "ready" || status === "mains" || status === "adv" || status === "weak") && <span className="absolute inset-[-1px] rounded-full" style={{ background: ring }} />}
      {status === "adv" && <span className="absolute -inset-[3px] rounded-full border border-fg" />}
    </span>
  );
}

/** Digits in dot-matrix; punctuation and units (":", ".", "%", "h", "m") in regular type so they stay legible. */
export function DotText({ children, className = "" }: { children: string | number; className?: string }) {
  const parts = String(children).match(/\d+|\D+/g) ?? [];
  return (
    <span className={className}>
      {parts.map((p, i) =>
        /\d/.test(p) ? (
          <span key={i} className="dot">
            {p}
          </span>
        ) : (
          <span key={i} className="mx-[0.04em] font-sans text-[0.62em] font-normal opacity-60">
            {p}
          </span>
        ),
      )}
    </span>
  );
}
