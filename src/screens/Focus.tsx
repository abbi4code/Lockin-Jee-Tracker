"use client";

import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, Plus, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { buzz, Segmented } from "../components/Controls";
import { finishedListeners, formatClock, lastFinished, silenceAlarm, useTick } from "../components/FocusTimer";
import { Page } from "../components/Shell";
import { DotText, fadeUp, Label, Section } from "../components/ui";
import { AimPicker, askLater, SolvedPrompt, usePutOff } from "../components/FocusQuestions";
import { ChapterSelect, SessionLog, type OpenRequest } from "../components/SessionLog";
import { breakSoundOn, previewAlarm, setBreakSoundOn, unlockAlarm } from "../lib/alarm";
import { BREAK_LENGTHS, breakPhase, suggestedBreak } from "../lib/breaks";
import { celebrate } from "../lib/celebrate";
import { resultLine, sessionToAsk } from "../lib/focus";
import { dayOf, LONG_SESSION_MIN } from "../lib/sessions";
import { formatMinutes, minutesByDay } from "../lib/stats";
import { timerElapsed, today, useProgress, type StudySession, type TimerMode } from "../store/progress";

const LENGTHS = [25, 50, 90];
const RING_DOTS = 60;
/** A session at least this long gets a break offered when it ends. */
const BREAK_AFTER_MIN = 20;

/** 60 dots in a circle: pomodoro fills toward its length; stopwatch fills one dot per second of the minute; a break drains. `alert` = a break that's over. */
function DotRing({ fraction, running, alert = false }: { fraction: number; running: boolean; alert?: boolean }) {
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
            style={{ fill: alert || head ? "var(--color-red)" : on ? "var(--color-fg)" : "var(--color-line-2)", transition: "fill 0.3s" }}
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

/** The break's sound switch: switching it on plays a short preview, so he knows what to listen for. */
function SoundSwitch() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(breakSoundOn()), []);
  const flip = () => {
    buzz();
    setBreakSoundOn(!on);
    setOn(!on);
    if (!on) {
      unlockAlarm();
      previewAlarm();
    } else silenceAlarm();
  };
  return (
    <button onClick={flip} aria-pressed={on} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] text-mute transition hover:text-fg">
      {on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      {on ? "alarm on" : "alarm off"}
    </button>
  );
}

/** Break lengths as chips; `pick` = the suggested one. */
function BreakChips({ value, onPick, className = "" }: { value: number; onPick: (m: number) => void; className?: string }) {
  return (
    <div className={`flex justify-center gap-2 ${className}`}>
      {BREAK_LENGTHS.map((m) => (
        <button
          key={m}
          onClick={() => onPick(m)}
          className={`rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition ${value === m ? "border-fg text-fg" : "border-line-2 text-dim hover:text-mute"}`}
        >
          {m}m
        </button>
      ))}
    </div>
  );
}

type Tab = TimerMode | "break";
const TABS: { value: Tab; label: string }[] = [
  { value: "pomodoro", label: "pomodoro" },
  { value: "stopwatch", label: "stopwatch" },
  { value: "break", label: "break" },
];

export function FocusScreen() {
  const store = useProgress();
  const { timer } = store;
  const brk = store.breakTimer;
  const running = !!timer.runningSince;
  const active = !!timer.sessionStart;
  const now = useTick(running || !!brk);
  const elapsed = timerElapsed(timer, now);
  const pomodoro = timer.mode === "pomodoro";
  const remaining = Math.max(timer.target * 60_000 - elapsed, 0);
  // The break tab is only a view: the study timer keeps its own mode.
  const [tab, setTab] = useState<Tab>(timer.mode);
  // Pomodoros finished today: every 4th earns a long break.
  const pomodorosToday = store.sessions.filter((x) => x.mode === "pomodoro" && dayOf(x.startedAt) === today()).length;
  const [breakLen, setBreakLen] = useState(() => suggestedBreak(timer.target, pomodorosToday));
  const phase = brk ? breakPhase(brk, Math.max(now, Date.now())) : null;
  const onBreak = phase === "on" || phase === "over";
  const breakLeft = brk ? brk.endsAt - Math.max(now, Date.now()) : 0;
  const settingBreak = !onBreak && !active && tab === "break";
  const fraction = onBreak
    ? phase === "over"
      ? 1
      : breakLeft / (brk!.endsAt - brk!.startedAt)
    : settingBreak
      ? 1
      : pomodoro
        ? elapsed / (timer.target * 60_000)
        : ((elapsed / 1000) % 60) / 60;
  // What just got logged; "edit" opens it in the log below. `rest` = offer a break of about that length.
  const [toast, setToast] = useState<{ text: string; id: string | null; rest?: number } | null>(null);
  const [openLog, setOpenLog] = useState<OpenRequest | null>(null);
  const edit = (id: string, notice: string | null = null) => setOpenLog({ id, notice, key: Date.now() });
  // "How many did you solve?" for the latest session with an aim that isn't answered yet: the one that just ended,
  // or one that ended on another page or while the app was closed. Asked before the break offer.
  const putOff = usePutOff();
  const asking = active ? null : sessionToAsk(store.sessions, Date.now(), putOff);
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const answered = (s: StudySession, solved: number) => setResult({ id: s.id, text: resultLine(s, solved) });
  const offer = (s: StudySession) => (s.minutes >= BREAK_AFTER_MIN ? suggestedBreak(s.minutes, useProgress.getState().sessions.filter((x) => x.mode === "pomodoro" && dayOf(x.startedAt) === today()).length) : undefined);

  const startBreak = (minutes: number) => {
    buzz(12);
    // The alarm has to play from a context a tap started (phones), so start it now.
    unlockAlarm();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    store.breakStart(minutes);
    setToast(null);
  };
  const endBreak = () => {
    buzz(12);
    silenceAlarm();
    store.breakEnd();
    // Next up is studying: show the study timer, not the break picker.
    setTab(timer.mode);
  };

  useEffect(() => {
    const onDone = (s: StudySession | null) => {
      setToast(s ? { text: `${s.minutes} min logged. stretch, water, no phone.`, id: s.id, rest: offer(s) } : null);
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
    setResult(null);
    silenceAlarm();
    setTab(timer.mode);
    if (pomodoro && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    store.timerStart();
  };
  const stop = () => {
    buzz(20);
    const s = store.timerStop();
    setToast(s ? { text: `${formatMinutes(s.minutes)} logged.`, id: s.id, rest: offer(s) } : { text: "under a minute — not logged.", id: null });
    // A long stopwatch run is often one left running: ask him to check it right away.
    if (s && s.mode === "stopwatch" && s.minutes > LONG_SESSION_MIN) edit(s.id, `${formatMinutes(s.minutes)} on the stopwatch. if you stepped away, trim it to what you actually studied.`);
  };

  const pickTab = (t: Tab) => {
    setTab(t);
    if (t !== "break") store.timerSet({ mode: t });
    else setBreakLen(suggestedBreak(timer.target, pomodorosToday));
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
          {onBreak || settingBreak ? (
            <motion.div key="sound" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
              <SoundSwitch />
              {settingBreak && <Segmented<Tab> id="mode" value={tab} onChange={pickTab} options={TABS} />}
            </motion.div>
          ) : (
            !active && (
              <motion.div key="tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Segmented<Tab> id="mode" value={tab} onChange={pickTab} options={TABS} />
              </motion.div>
            )
          )}
        </AnimatePresence>
      </motion.header>

      <motion.div variants={fadeUp} className="relative mx-auto aspect-square w-full max-w-[300px] lg:max-w-[400px]">
        <DotRing fraction={fraction} running={running || phase === "on"} alert={phase === "over"} />
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center" aria-live="polite">
            {onBreak ? (
              <>
                <DotText className={`block text-[54px] leading-none lg:text-[72px] ${phase === "over" ? "text-red" : ""}`}>{phase === "over" ? `+${formatClock(-breakLeft)}` : formatClock(breakLeft)}</DotText>
                <div className={`mt-3 font-mono text-[12px] ${phase === "over" ? "text-fg" : "text-mute"}`}>{phase === "over" ? "break's over · back to it" : active ? "break · session paused" : "break · stretch, water, no phone"}</div>
              </>
            ) : settingBreak ? (
              <>
                <DotText className="block text-[54px] leading-none text-mute lg:text-[72px]">{formatClock(breakLen * 60_000)}</DotText>
                <div className="mt-3 font-mono text-[12px] text-mute">{breakLen} min break · rings at the end</div>
              </>
            ) : (
              <>
                <DotText className={`block text-[54px] leading-none lg:text-[72px] ${active && !running ? "text-mute" : ""}`}>{formatClock(pomodoro ? remaining : elapsed)}</DotText>
                <div className="mt-3 font-mono text-[12px] text-mute">{!active ? (pomodoro ? `${timer.target} min session` : "stopwatch") : running ? "locked in" : "paused"}</div>
                {active && (timer.aim ?? 0) > 0 && <div className="mt-1 font-mono text-[12px] text-dim">aim {timer.aim} question{timer.aim === 1 ? "" : "s"}</div>}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {settingBreak && <BreakChips value={breakLen} onPick={setBreakLen} className="mt-6" />}

      {/* Right under the ring, so it's in view: a session that just ended (or ended elsewhere) asks how many it
          solved. The next session's settings wait until it's answered or put off. */}
      {asking && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-6 max-w-md">
          <SolvedPrompt key={asking.id} session={asking} onSaved={(n) => answered(asking, n)} onLater={() => askLater(asking.id)} />
        </motion.div>
      )}

      {!asking && !active && !onBreak && !settingBreak && pomodoro && (
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

      {/* What this session is for: a number of questions (or none, for theory), set before starting. */}
      {!asking && !active && !onBreak && !settingBreak && (
        <motion.div variants={fadeUp} className="mx-auto mt-7 max-w-md">
          <AimPicker minutes={pomodoro ? timer.target : null} />
        </motion.div>
      )}

      {onBreak ? (
        <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {phase === "over" ? (
            <>
              <motion.button whileTap={{ scale: 0.95 }} onClick={start} data-cursor="go" className="flex items-center gap-2 rounded-full bg-fg px-7 py-3.5 text-[15px] font-medium text-ink">
                <Play className="size-4 fill-current" /> {active ? "resume" : pomodoro ? `start ${timer.target}m` : "start"}
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => store.breakExtend(5)} className="flex items-center gap-1.5 rounded-full border border-line-2 px-5 py-3.5 text-[15px] text-mute hover:text-fg">
                <Plus className="size-3.5" /> 5 min
              </motion.button>
              <button onClick={endBreak} className="rounded-full px-3 py-3.5 text-[14px] text-dim hover:text-fg">
                done
              </button>
            </>
          ) : (
            <>
              <motion.button whileTap={{ scale: 0.95 }} onClick={endBreak} className="flex items-center gap-2 rounded-full border border-line-2 px-6 py-3.5 text-[15px]">
                <Square className="size-3.5 fill-current" /> end break
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => store.breakExtend(2)} className="flex items-center gap-1.5 rounded-full border border-line-2 px-5 py-3.5 text-[15px] text-mute hover:text-fg">
                <Plus className="size-3.5" /> 2 min
              </motion.button>
            </>
          )}
        </motion.div>
      ) : settingBreak ? (
        <motion.div variants={fadeUp} className="mt-8 flex items-center justify-center">
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => startBreak(breakLen)} data-cursor="go" className="flex items-center gap-2 rounded-full bg-fg px-7 py-3.5 text-[15px] font-medium text-ink">
            <Play className="size-4 fill-current" /> start break
          </motion.button>
        </motion.div>
      ) : (
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
      )}

      {/* Paused mid-session: a break timer, so the pause doesn't quietly turn into an hour. */}
      {active && !running && !onBreak && (
        <div className="mt-4 text-center">
          <button onClick={() => startBreak(5)} className="font-mono text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg hover:decoration-fg">
            taking a break? set a 5 min timer
          </button>
        </div>
      )}

      {/* A pomodoro logs itself when it ends; a stopwatch only counts once it's stopped. Say so. */}
      {!pomodoro && !toast && !onBreak && !settingBreak && (
        <motion.p variants={fadeUp} className={`mt-5 text-center font-mono text-[12.5px] ${active ? "text-red" : "text-dim"}`}>
          {active ? `${formatClock(elapsed)} not counted yet · press stop & log to add it to today` : "stopwatch time counts once you press stop & log"}
        </motion.p>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 text-center font-mono text-[13px] text-mute">
            {toast.text}
            {toast.id && (
              <>
                {" "}
                <button onClick={() => edit(toast.id!)} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
                  edit
                </button>
              </>
            )}
            {result && result.id === toast.id && <p className="mt-1.5 text-fg">{result.text}</p>}
            {/* Questions first (asked above), then the break. */}
            {toast.rest != null && !onBreak && !(asking && asking.id === toast.id) && (
              <div className="mt-3">
                <p className="mb-2 text-dim">take a break? it rings when it&apos;s time to start again.</p>
                <BreakChips value={toast.rest} onPick={startBreak} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {result && result.id !== toast?.id && <p className="mt-4 text-center font-mono text-[13px] text-fg">{result.text}</p>}

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
