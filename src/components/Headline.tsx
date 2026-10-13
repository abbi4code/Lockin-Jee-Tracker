"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { coachingMinutes } from "../lib/coaching";
import { DEFAULT_TARGETS, LADDER, ladderPosition, tracker, weekStart } from "../lib/college";
import { moodFor, pickLine, type HeadlineContext, type HeadlineEvent, type Mood } from "../lib/headlines";
import { addDays } from "../lib/plan";
import { formatMinutes, streak } from "../lib/stats";
import { pct } from "../lib/tests";
import { quizrrPct } from "../lib/quizrr";
import { today, useProgress } from "../store/progress";

// What the headline last reacted to. Module scope, so it survives navigating away and back within the app:
// a pomodoro finished on /focus or a test logged on a chapter page changes the line when he returns home.
let shown: { line: string; mood: Mood; day: string; roll: number; sessions: number; q: number; tests: number; level: number; eventAt: number | null } | null = null;
/** A line reacting to an event stays up this long (unless another event happens), so it isn't swapped out right away. */
const EVENT_HOLD_MS = 15 * 60_000;

/** The one line under "lockin." on the home screen. Changes on events (focus session, every 10 questions, a test, a level up) and when the day's state changes. */
export function Headline() {
  const { sessions, questions, tests, quizrr, settings, activity } = useProgress();
  const t = today();

  const { ctx, counts, latestTestPct } = useMemo(() => {
    const track = tracker({ sessions, coaching: settings.coaching, questions, tests, quizrr });
    const day = track.day(t);
    // The mood reads today against his own goals; the college line is this week's college.
    const goals = settings.targets ?? DEFAULT_TARGETS;
    const targetMinutes = (coachingMinutes(settings.coaching, t) > 0 ? goals.hoursCoaching : goals.hoursOff) * 60;
    const score = Math.min(100, 50 * Math.min(day.minutes / targetMinutes, 1.2) + 50 * Math.min(day.questions / goals.questions, 1.2));
    const college = track.week(weekStart(t), t).college;
    // Higher = better, so "level up" means a better college this week.
    const level = college ? LADDER.length - ladderPosition(college) + 1 : 0;
    const st = streak(activity);
    // MathonGo and Quizrr tests both trigger the test good/mid/bad lines.
    const todaysTests = [...Object.values(tests), ...Object.values(quizrr)]
      .filter((x) => !x.deleted && x.takenOn === t)
      .map((x) => ({ updatedAt: x.updatedAt, pct: "testId" in x ? quizrrPct(x) : pct(x) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const ctx: HeadlineContext = {
      hour: new Date().getHours(),
      minutes: day.minutes,
      targetMinutes,
      questions: day.questions,
      targetQuestions: goals.questions,
      score,
      college: college?.short ?? null,
      streak: st,
      // A comeback needs an earlier active day: a brand-new account didn't "miss" yesterday.
      missedYesterday: !activity.includes(addDays(t, -1)) && activity.some((d) => d < addDays(t, -1)),
      coachingToday: coachingMinutes(settings.coaching, t) > 0,
      name: settings.name.trim().split(/\s+/)[0] ?? "",
      hours: formatMinutes(day.minutes),
    };
    return {
      ctx,
      // Only timed sessions are a "focus session done" moment; time added by hand isn't.
      counts: { sessions: sessions.filter((x) => x.source !== "manual" && new Date(x.startedAt).toLocaleDateString("en-CA") === t).length, q: day.questions, tests: todaysTests.length, level },
      latestTestPct: todaysTests[0]?.pct ?? null,
    };
  }, [sessions, questions, tests, quizrr, settings.coaching, settings.targets, settings.name, activity, t]);

  const [line, setLine] = useState(() => shown?.line ?? "");

  useEffect(() => {
    const prev = shown && shown.day === t ? shown : null;
    let event: HeadlineEvent | undefined;
    if (prev) {
      if (counts.tests > prev.tests) event = { kind: "test", pct: latestTestPct };
      else if (counts.sessions > prev.sessions) event = { kind: "pomodoro" };
      else if (counts.level > prev.level) event = { kind: "levelUp" };
      else if (Math.floor(counts.q / 10) > Math.floor(prev.q / 10)) event = { kind: "questions" };
    }
    const roll = prev?.roll ?? Math.random();
    const mood = moodFor(ctx, event, roll);
    // Same day, nothing new happened, and either the same situation or a recent event's line: keep it.
    const holding = prev?.eventAt != null && Date.now() - prev.eventAt < EVENT_HOLD_MS;
    if (prev && !event && (mood === prev.mood || holding)) {
      shown = { ...prev, ...counts };
      setLine(prev.line);
      return;
    }
    const next = pickLine(mood, ctx, { score: event?.kind === "test" ? event.pct : null });
    shown = { line: next, mood, day: t, roll, ...counts, eventAt: event ? Date.now() : null };
    setLine(next);
  }, [ctx, counts, latestTestPct, t]);

  // Lines that don't already say his name get it in front, as the old headline did.
  const named = ctx.name && !line.toLowerCase().includes(ctx.name.toLowerCase());
  return (
    <p className="mt-6 min-h-[1.65em] text-[16px] leading-relaxed text-mute lg:mt-8 lg:text-[18px]" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={line} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="inline-block">
          {named && <span className="text-fg">{ctx.name}, </span>}
          {line}
        </motion.span>
      </AnimatePresence>
    </p>
  );
}
