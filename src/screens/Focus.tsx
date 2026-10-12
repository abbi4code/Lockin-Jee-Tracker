"use client";

import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { buzz, Segmented } from "../components/Controls";
import { finishedListeners, formatClock, lastFinished, useTick } from "../components/FocusTimer";
import { Page } from "../components/Shell";
import { DotText, fadeUp, Label, Section } from "../components/ui";
import { ChapterSelect, SessionLog, type OpenRequest } from "../components/SessionLog";
import { celebrate } from "../lib/celebrate";
import { LONG_SESSION_MIN } from "../lib/sessions";
import { formatMinutes, minutesByDay } from "../lib/stats";
import { timerElapsed, useProgress, type StudySession, type TimerMode } from "../store/progress";

const LENGTHS = [25, 50, 90];
const RING_DOTS = 60;

/** 60 dots in a circle: pomodoro fills toward its length; stopwatch fills one dot per second of the minute. */
function DotRing({ fraction, running }: { fraction: number; running: boolean }) {
  const size = 280;
  const r = size / 2 - 10;
  const lit = Math.round(fraction * RING_DOTS);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full">
      {Array.from({ length: RING_DOTS }, (_, i) => {
        const a = (i / RING_DOTS) * Math.PI * 2 - Math.PI / 2;
        const on = i < lit;
        const head = running && i === lit - 1;
        return (
          <motion.circle
            key={i}
            cx={size / 2 + r * Math.cos(a)}
            cy={size / 2 + r * Math.sin(a)}
            style={{ fill: head ? "var(--color-red)" : on ? "var(--color-fg)" : "var(--color-line-2)", transition: "fill 0.3s" }}
            initial={false}
            animate={{ r: head ? 3.6 : on ? 2.6 : 1.9 }}
            transition={{ duration: 0.3 }}
          />
        );
      })}
    </svg>
  );
}

function ChapterPicker() {
  const { timer, timerSet } = useProgress();
  return (
    <label className="block">
      <Label>studying</Label>
      <ChapterSelect value={timer.chapterId} onChange={(chapterId) => timerSet({ chapterId })} className="mt-2" />
    </label>
  );
}

export function FocusScreen() {
  const store = useProgress();
  const { timer } = store;
  const running = !!timer.runningSince;
  const active = !!timer.sessionStart;
  const now = useTick(running);
  const elapsed = timerElapsed(timer, now);
  const pomodoro = timer.mode === "pomodoro";
  const remaining = Math.max(timer.target * 60_000 - elapsed, 0);
  const fraction = pomodoro ? elapsed / (timer.target * 60_000) : ((elapsed / 1000) % 60) / 60;
  // What just got logged; "edit" opens it in the log below.
  const [toast, setToast] = useState<{ text: string; id: string | null } | null>(null);
  const [openLog, setOpenLog] = useState<OpenRequest | null>(null);
  const edit = (id: string, notice: string | null = null) => setOpenLog({ id, notice, key: Date.now() });

  useEffect(() => {
    const onDone = (s: StudySession | null) => {
      setToast(s ? { text: `${s.minutes} min logged. take 5 — stretch, water, no phone.`, id: s.id } : null);
      if (s?.subject && (s.subject === "physics" || s.subject === "chemistry" || s.subject === "maths")) celebrate(s.subject);
    };
    finishedListeners.add(onDone);
    // Finished just before this screen mounted (it ended while the app was closed): still say so.
    if (lastFinished && Date.now() - lastFinished.at < 10_000) onDone(lastFinished.session);
    return () => void finishedListeners.delete(onDone);
  }, []);

  const start = () => {
    buzz(12);
    setToast(null);
    if (pomodoro && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    store.timerStart();
  };
  const stop = () => {
    buzz(20);
    const s = store.timerStop();
    setToast(s ? { text: `${formatMinutes(s.minutes)} logged.`, id: s.id } : { text: "under a minute — not logged.", id: null });
    // A long stopwatch run is often one left running: ask him to check it right away.
    if (s && s.mode === "stopwatch" && s.minutes > LONG_SESSION_MIN) edit(s.id, `${formatMinutes(s.minutes)} on the stopwatch. if you stepped away, trim it to what you actually studied.`);
  };

  const week = minutesByDay(store.sessions, 7);
  const weekMax = Math.max(...week.map((d) => d.minutes), 60);

  return (
    <Page>
      {/* Laptops: the timer on the left, what was studied on the right. */}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-16">
      <div className="lg:sticky lg:top-10 lg:col-span-6">
      <motion.header variants={fadeUp} className="flex items-center justify-between pb-6">
        <span className="dot text-lg">focus</span>
        <AnimatePresence initial={false}>
          {!active && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Segmented<TimerMode>
                id="mode"
                value={timer.mode}
                onChange={(mode) => store.timerSet({ mode })}
                options={[
                  { value: "pomodoro", label: "pomodoro" },
                  { value: "stopwatch", label: "stopwatch" },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      <motion.div variants={fadeUp} className="relative mx-auto aspect-square w-full max-w-[300px] lg:max-w-[400px]">
        <DotRing fraction={fraction} running={running} />
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <DotText className={`block text-[54px] leading-none lg:text-[72px] ${active && !running ? "text-mute" : ""}`}>{formatClock(pomodoro ? remaining : elapsed)}</DotText>
            <div className="mt-3 font-mono text-[12px] text-mute">{!active ? (pomodoro ? `${timer.target} min session` : "stopwatch") : running ? "locked in" : "paused"}</div>
          </div>
        </div>
      </motion.div>

      {!active && pomodoro && (
        <motion.div variants={fadeUp} className="mt-6 flex justify-center gap-2">
          {LENGTHS.map((m) => (
            <button
              key={m}
              onClick={() => store.timerSet({ target: m })}
              className={`rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition ${timer.target === m ? "border-fg text-fg" : "border-line-2 text-dim hover:text-mute"}`}
            >
              {m}m
            </button>
          ))}
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="mt-8 flex items-center justify-center gap-3">
        {running ? (
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => store.timerPause()} className="flex items-center gap-2 rounded-full border border-line-2 px-6 py-3.5 text-[15px]">
            <Pause className="size-4" /> pause
          </motion.button>
        ) : (
          <motion.button whileTap={{ scale: 0.95 }} onClick={start} data-cursor="go" className="flex items-center gap-2 rounded-full bg-fg px-7 py-3.5 text-[15px] font-medium text-ink">
            <Play className="size-4 fill-current" /> {active ? "resume" : "start"}
          </motion.button>
        )}
        {active && (
          <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} whileTap={{ scale: 0.95 }} onClick={stop} className="flex items-center gap-2 rounded-full border border-line-2 px-6 py-3.5 text-[15px] text-mute hover:text-fg">
            <Square className="size-3.5 fill-current" /> stop &amp; log
          </motion.button>
        )}
      </motion.div>

      {/* A pomodoro logs itself when it ends; a stopwatch only counts once it's stopped. Say so. */}
      {!pomodoro && !toast && (
        <motion.p variants={fadeUp} className={`mt-5 text-center font-mono text-[12.5px] ${active ? "text-red" : "text-dim"}`}>
          {active ? `${formatClock(elapsed)} not counted yet · press stop & log to add it to today` : "stopwatch time counts once you press stop & log"}
        </motion.p>
      )}

      <AnimatePresence>
        {toast && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 text-center font-mono text-[13px] text-mute">
            {toast.text}
            {toast.id && (
              <>
                {" "}
                <button onClick={() => edit(toast.id!)} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
                  edit
                </button>
              </>
            )}
          </motion.p>
        )}
      </AnimatePresence>

      </div>

      <div className="lg:col-span-6">
      <motion.div variants={fadeUp} className="mt-10 mb-8 lg:mt-0">
        <ChapterPicker />
      </motion.div>

      <SessionLog open={openLog} />

      <Section label="last 7 days" right={formatMinutes(week.reduce((n, d) => n + d.minutes, 0))}>
        <div className="flex h-24 items-end gap-2">
          {week.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <motion.div
                className="w-full rounded-sm bg-fg"
                initial={{ height: 0 }}
                animate={{ height: `${Math.max((d.minutes / weekMax) * 72, d.minutes ? 3 : 1)}px` }}
                style={{ opacity: d.minutes ? 1 : 0.15 }}
                transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
              />
              <span className="font-mono text-[10px] text-dim">{new Date(d.date + "T00:00").toLocaleDateString([], { weekday: "narrow" })}</span>
            </div>
          ))}
        </div>
      </Section>
      </div>
      </div>
    </Page>
  );
}
