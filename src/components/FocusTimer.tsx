"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getChapter } from "../data";
import { breakSoundOn, playAlarm } from "../lib/alarm";
import { breakPhase, endDue, ringNow } from "../lib/breaks";
import { chime } from "../lib/chime";
import { resultLine, sessionToAsk } from "../lib/focus";
import { askLater, SolvedPrompt, usePutOff } from "./FocusQuestions";
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

// ── The break's end ─────────────────────────────────────────────────────
// Rung from the shell, so it goes off on any page. Every open tab of the app has its own copy of the store,
// so the first tab to ring claims that break in localStorage and the others stay quiet.

let stopSound: (() => void) | null = null;
let titleBefore: string | null = null;

/** Stops the alarm and puts the tab title back. Any tap or key does this, and so does ending the break. */
export function silenceAlarm() {
  stopSound?.();
  stopSound = null;
  if (titleBefore != null) document.title = titleBefore;
  titleBefore = null;
}

function claimRing(endsAt: number) {
  try {
    if (localStorage.getItem("lockin-break-rang") === String(endsAt)) return false;
    localStorage.setItem("lockin-break-rang", String(endsAt));
  } catch {
    // No storage: ring anyway.
  }
  return true;
}

function ringBreakEnd(endsAt: number) {
  if (!claimRing(endsAt)) return;
  silenceAlarm();
  if (breakSoundOn()) stopSound = playAlarm();
  if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.([200, 100, 200, 100, 400]);
  titleBefore = document.title;
  document.title = "● break over · lockin.";
  if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification("break's over", { body: "Back to it. Start the next session.", icon: "/pwa-192x192.png", tag: "lockin-break" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
  const stop = () => {
    silenceAlarm();
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("keydown", stop, true);
  };
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("keydown", stop, true);
}

/** Shared by the pill and the focus screen: called when a pomodoro reaches its length. */
export const finishedListeners = new Set<(s: StudySession | null) => void>();
/** The last pomodoro that finished, for a focus screen that mounts just after (one that ended while the app was closed). */
export let lastFinished: { session: StudySession | null; at: number } | null = null;

/**
 * Lives in the app shell: finishes pomodoros on time (even after the app was backgrounded)
 * and shows a small running-timer pill above the nav on every page except /focus.
 */
export function FocusTimer() {
  const timer = useProgress((s) => s.timer);
  const brk = useProgress((s) => s.breakTimer);
  const running = !!timer.runningSince;
  const now = useTick(running || !!brk);
  const pathname = usePathname();
  // The one-second tick can be held back while the tab is hidden: also wake exactly when the break ends,
  // and as soon as the app is looked at again.
  const [, wake] = useState(0);
  useEffect(() => {
    if (!brk || brk.rung) return;
    const id = setTimeout(() => wake((n) => n + 1), Math.max(0, brk.endsAt - Date.now()) + 30);
    const onShow = () => document.visibilityState === "visible" && wake((n) => n + 1);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [brk]);
  const clock = Math.max(now, Date.now());

  useEffect(() => {
    if (!brk) return silenceAlarm();
    if (breakPhase(brk, clock) === "stale") return useProgress.getState().breakEnd();
    if (!endDue(brk, clock)) return;
    // Mark it first, so a re-render (or React dev mode running effects twice) can't ring it again.
    useProgress.getState().breakHandled();
    // Ended long ago (the app was closed): it just shows as over, no alarm.
    if (ringNow(brk, clock)) ringBreakEnd(brk.endsAt);
  }, [brk, clock]);
  const elapsed = timerElapsed(timer, now);
  const due = timer.mode === "pomodoro" && running && elapsed >= timer.target * 60_000;

  useEffect(() => {
    // Only once per pomodoro, even if this runs twice (React dev mode) or after another tab already stopped it.
    if (!due || !useProgress.getState().timer.runningSince) return;
    const logged = useProgress.getState().timerStop();
    lastFinished = { session: logged, at: Date.now() };
    chime();
    // Browsers refuse to vibrate before the first tap (e.g. a pomodoro that ended while the app was closed).
    if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.([120, 80, 120]);
    if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
      new Notification("lockin.", { body: `${logged?.minutes ?? timer.target} min logged. Take 5.`, icon: "/pwa-192x192.png" });
    }
    finishedListeners.forEach((l) => l(logged));
  }, [due, timer.target]);

  const show = (!!timer.sessionStart || !!brk) && pathname !== "/focus";
  // A session with an aim that ended while he was on another page: ask here, where the pill was. The focus page
  // asks on its own.
  const sessions = useProgress((s) => s.sessions);
  const putOff = usePutOff();
  const asking = !show && !timer.sessionStart && !brk && pathname !== "/focus" ? sessionToAsk(sessions, Date.now(), putOff) : null;
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done]);
  const chapter = timer.chapterId ? getChapter(timer.chapterId) : null;
  const shown = timer.mode === "pomodoro" ? Math.max(timer.target * 60_000 - elapsed, 0) : elapsed;
  const breakOver = !!brk && clock >= brk.endsAt;

  return (
    <AnimatePresence>
      {(asking || done) && !show && (
        <motion.div
          key="ask"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),14px)+64px)] z-40 flex justify-center"
        >
          <div role="dialog" aria-label="questions solved" className="w-full max-w-md rounded-2xl border border-line-2 bg-ink-2/95 px-4 py-3.5 shadow-[0_20px_60px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl">
            {asking ? (
              <SolvedPrompt key={asking.id} session={asking} compact onSaved={(n) => setDone(resultLine(asking, n))} onLater={() => askLater(asking.id)} />
            ) : (
              <p className="text-center font-mono text-[13px] text-fg">{done}</p>
            )}
          </div>
        </motion.div>
      )}
      {show && (
        <motion.div
          key="pill"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),14px)+64px)] z-40 flex justify-center"
        >
          {brk ? (
            // On a break (a paused session waits underneath): time left, then how far over it's run.
            <Link href="/focus" className={`flex items-center gap-2.5 rounded-full border bg-ink-2/90 px-4 py-2 backdrop-blur-xl ${breakOver ? "border-red/60" : "border-line-2"}`}>
              <span className={`size-1.5 rounded-full ${breakOver ? "animate-pulse bg-red" : "border border-mute"}`} />
              <DotText className={`text-[16px] ${breakOver ? "text-red" : ""}`}>{breakOver ? `+${formatClock(clock - brk.endsAt)}` : formatClock(brk.endsAt - clock)}</DotText>
              <span className={`font-mono text-[12px] ${breakOver ? "text-fg" : "text-mute"}`}>{breakOver ? "break over · back to it" : "break"}</span>
            </Link>
          ) : (
            <Link href="/focus" className="flex items-center gap-2.5 rounded-full border border-line-2 bg-ink-2/90 px-4 py-2 backdrop-blur-xl">
              <span className={`size-1.5 rounded-full ${running ? "animate-pulse bg-red" : "bg-mute"}`} />
              <DotText className="text-[16px]">{formatClock(shown)}</DotText>
              <span className="max-w-40 truncate font-mono text-[12px] text-mute">{running ? (chapter?.name ?? "focus") : timer.mode === "stopwatch" ? "paused · not logged" : "paused"}</span>
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
