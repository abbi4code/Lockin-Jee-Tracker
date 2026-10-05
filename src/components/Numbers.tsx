"use client";

import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";

/** Number that counts up/down to its value. */
export function CountUp({ value, decimals = 0, className = "" }: { value: number; decimals?: number; className?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}

/** Single digit that rolls when it changes. */
function Digit({ d }: { d: string }) {
  return (
    <span className="relative inline-block overflow-hidden align-bottom" style={{ width: "0.62em", height: "1.05em" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={d}
          initial={{ y: "100%", opacity: 0, filter: "blur(4px)" }}
          animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
          exit={{ y: "-100%", opacity: 0, filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="absolute inset-0 text-center"
        >
          {d}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Rolling({ value, pad = 2, className = "" }: { value: number; pad?: number; className?: string }) {
  return (
    <span className={`inline-flex tabular-nums ${className}`}>
      {String(Math.max(0, value))
        .padStart(pad, "0")
        .split("")
        .map((d, i, arr) => (
          <Digit key={arr.length - i} d={d} />
        ))}
    </span>
  );
}

function parts(target: Date) {
  const ms = Math.max(0, target.getTime() - Date.now());
  return {
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor(ms / 3_600_000) % 24,
    minutes: Math.floor(ms / 60_000) % 60,
    seconds: Math.floor(ms / 1000) % 60,
  };
}

export function useCountdown(target: Date) {
  const [t, setT] = useState(() => parts(target));
  useEffect(() => {
    const id = setInterval(() => setT(parts(target)), 1000);
    return () => clearInterval(id);
  }, [target]);
  return t;
}
