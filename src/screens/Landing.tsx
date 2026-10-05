"use client";

import { useEffect, useMemo, useState } from "react";
import { Rolling, useCountdown } from "../components/Numbers";
import { findExam } from "../data";

/** Live countdown to JEE Main Session 1 (client-only: it depends on the current time). */
export function LandingCountdown() {
  const main = findExam(/Main 2027 Session 1$/);
  const target = useMemo(() => new Date(`${main?.start ?? "2027-01-22"}T09:00:00+05:30`), [main?.start]);
  const t = useCountdown(target);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cells: [number, string][] = [
    [t.days, "days"],
    [t.hours, "hrs"],
    [t.minutes, "min"],
    [t.seconds, "sec"],
  ];
  return (
    <div>
      <p className="mb-4 font-mono text-[12px] tracking-[0.18em] text-mute uppercase">until jee main · 22 jan 2027</p>
      <div className="flex items-end gap-5 sm:gap-8">
        {cells.map(([v, l], i) => (
          <div key={l}>
            <div className={`dot text-[40px] leading-none sm:text-[56px] xl:text-[72px] ${i === 3 ? "text-red" : ""}`}>{mounted ? <Rolling value={v} pad={i === 0 ? 3 : 2} /> : "–"}</div>
            <div className="mt-2 font-mono text-[11px] text-dim">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
