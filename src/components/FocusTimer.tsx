"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getChapter } from "../data";
import { chime } from "../lib/chime";
import { DotText } from "./ui";
import { timerElapsed, useProgress, type StudySession } from "../store/progress";

export function formatClock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Re-renders every second while the timer runs. */
export function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Shared by the pill and the focus screen: called when a pomodoro reaches its length. */
export const finishedListeners = new Set<(s: StudySession | null) => void>();

/**
 * Lives in the app shell: finishes pomodoros on time (even after the app was backgrounded)
 * and shows a small running-timer pill above the nav on every page except /focus.
 */
export function FocusTimer() {
  const timer = useProgress((s) => s.timer);
  const running = !!timer.runningSince;
  const now = useTick(running);
  const pathname = usePathname();
  const elapsed = timerElapsed(timer, now);
  const due = timer.mode === "pomodoro" && running && elapsed >= timer.target * 60_000;

  useEffect(() => {
    if (!due) return;
    const logged = useProgress.getState().timerStop();
    chime();
    navigator.vibrate?.([120, 80, 120]);
    if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
      new Notification("lockin.", { body: `${logged?.minutes ?? timer.target} min logged. Take 5.`, icon: "/pwa-192x192.png" });
    }
    finishedListeners.forEach((l) => l(logged));
  }, [due, timer.target]);

  const show = !!timer.sessionStart && pathname !== "/focus";
  const chapter = timer.chapterId ? getChapter(timer.chapterId) : null;
  const shown = timer.mode === "pomodoro" ? Math.max(timer.target * 60_000 - elapsed, 0) : elapsed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),14px)+64px)] z-40 flex justify-center"
        >
          <Link href="/focus" className="flex items-center gap-2.5 rounded-full border border-line-2 bg-ink-2/90 px-4 py-2 backdrop-blur-xl">
            <span className={`size-1.5 rounded-full ${running ? "animate-pulse bg-red" : "bg-mute"}`} />
            <DotText className="text-[16px]">{formatClock(shown)}</DotText>
            <span className="max-w-40 truncate font-mono text-[12px] text-mute">{running ? (chapter?.name ?? "focus") : timer.mode === "stopwatch" ? "paused · not logged" : "paused"}</span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
