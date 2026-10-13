"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { SUBJECT_COLOR, SUBJECTS, type SubjectId } from "../data";
import { coachingMinutes } from "../lib/coaching";
import { collegeReport, cutoffText, DEFAULT_TARGETS, formatRank, LADDER, LADDER_TOTALS, rankHeight, STREAK_HOURS, TYPE_LABEL, type College, type Pillar, type WeekResult } from "../lib/college";
import { formatMinutes } from "../lib/stats";
import { today, useProgress } from "../store/progress";
import { buzz } from "./Controls";
import { DotBar, DotText, Label, Section } from "./ui";

/** The college report for the signed-in student, from the first day with any data. */
export function useCollegeReport() {
  const { sessions, questions, tests, quizrr, activity, settings } = useProgress();
  return useMemo(() => {
    const days = [
      activity[0],
      sessions[0] && new Date(sessions[0].startedAt).toLocaleDateString("en-CA"),
      Object.keys(questions).sort()[0],
      ...Object.values(tests).map((t) => t.takenOn),
      ...Object.values(quizrr).map((t) => t.takenOn),
    ].filter((d): d is string => !!d);
    const first = days.length ? days.sort()[0] : null;
    return collegeReport({ sessions, questions, tests, quizrr, coaching: settings.coaching }, today(), first);
  }, [sessions, questions, tests, quizrr, activity, settings.coaching]);
}

function Name({ college, size = "text-[28px] lg:text-[34px]" }: { college: College; size?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={college.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
        <div className={`${size} leading-tight font-semibold tracking-tight`}>{college.short}</div>
        <div className="mt-1 font-mono text-[12.5px] text-mute">
          {college.branch} · {TYPE_LABEL[college.type]} · {cutoffText(college)}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function PillarRow({ label, value, pillar, empty }: { label: string; value: string; pillar: Pillar | null; empty?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-28 shrink-0 font-mono text-[12px] whitespace-nowrap text-mute">{label}</span>
      <DotBar value={pillar ? rankHeight(pillar.rank) : 0} dots={12} size={4} />
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-fg">{pillar ? value : (empty ?? "–")}</span>
      <span className="hidden w-36 shrink-0 text-right font-mono text-[11px] whitespace-nowrap text-dim sm:inline">{pillar ? `like rank ${formatRank(pillar.rank)}` : ""}</span>
    </div>
  );
}

const WEEKDAY = ["m", "t", "w", "t", "f", "s", "s"];

/** This week's streak days (6h+), one dot per day; today is marked, future days are faint. */
function StreakDots({ w }: { w: WeekResult }) {
  const t = today();
  return (
    <div className="flex items-end gap-3">
      {WEEKDAY.map((label, i) => {
        const d = w.days[i];
        return (
          <div key={i} className="flex flex-col items-center gap-1.5" title={d ? `${d.date}: ${formatMinutes(d.minutes)}` : undefined}>
            <span
              className="size-2.5 rounded-full border"
              style={{
                background: d?.streak ? "var(--color-fg)" : "transparent",
                borderColor: d?.streak ? "var(--color-fg)" : d ? "var(--color-line-2)" : "var(--color-dot-off)",
              }}
            />
            <span className={`font-mono text-[10.5px] ${d?.date === t ? "text-fg" : "text-dim"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** This week's college: the predicted rank, what it's made of, streaks, and what the next college up takes. */
export function WeekCollege() {
  const r = useCollegeReport();
  const w = r.week;
  if (!LADDER.length || !w.college) return null;
  const last = r.lastWeek;
  const counted = w.days.length;

  return (
    <Section label="this week's college" right={w.empty ? "nothing logged yet" : `rank ~${formatRank(w.rank)}`}>
      {w.empty ? (
        <div>
          {last.college && !last.empty ? (
            <>
              <Label className="mb-1.5">last week ended at</Label>
              <Name college={last.college} />
              <p className="mt-2 font-mono text-[12px] text-dim">rank ~{formatRank(last.rank)} · a new week starts now. study, log questions, take a test.</p>
            </>
          ) : (
            <p className="text-[15px] text-mute">Log study time and questions this week to see which college your effort is heading for.</p>
          )}
        </div>
      ) : (
        <>
          <Name college={w.college} />
          <p className="mt-2 font-mono text-[12px] text-dim">
            {w.percentile.toFixed(1)} %ile · {counted < 7 ? `${counted === 1 ? "monday" : `${counted} days`} so far` : "full week"}
            {last.college && !last.empty ? ` · last week: ${last.college.short} ${last.college.branch} (~${formatRank(last.rank)})` : ""}
          </p>

          <div className="mt-4">
            <PillarRow label="hours / day" value={formatMinutes(Math.round(w.hours.value * 60))} pillar={w.hours} />
            <PillarRow label="questions / day" value={`${Math.round(w.questions.value)}`} pillar={w.questions} />
            <PillarRow label="tests · 4 wks" value={w.tests ? `${Math.round(w.tests.value)}% · ${w.tests.count} test${w.tests.count === 1 ? "" : "s"}` : ""} pillar={w.tests} empty="no test yet · hours & questions carry it" />
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <StreakDots w={w} />
            <div className="text-right font-mono text-[12px] text-mute">
              {w.streakDays} streak day{w.streakDays === 1 ? "" : "s"} ({STREAK_HOURS}h+)
              {w.weekStreak > 0 && <div className="text-fg">{w.weekStreak} strong week{w.weekStreak === 1 ? "" : "s"} in a row</div>}
            </div>
          </div>
          {w.bonus < 1 && (
            <p className="mt-3 font-mono text-[12px] text-mute">
              streak bonus: rank ~{formatRank(w.baseRank)} → <span className="text-fg">~{formatRank(w.rank)}</span>
            </p>
          )}

          {r.next ? (
            <p className="mt-4 text-[15px] leading-relaxed text-mute">
              next up: <span className="text-fg">{r.next.college.short} · {r.next.college.branch}</span> (~{formatRank(r.next.college.rank)})
              {r.next.minutes != null || r.next.questions != null ? " → " : ""}
              {r.next.minutes != null && <span className="text-fg">+{formatMinutes(r.next.minutes)} a day</span>}
              {r.next.minutes != null && r.next.questions != null && " or "}
              {r.next.questions != null && <span className="text-fg">+{r.next.questions} questions a day</span>}
              {r.next.minutes == null && r.next.questions == null && " → better test scores get you there"}
            </p>
          ) : (
            <p className="mt-4 text-[15px] text-fg">top of the ladder. nothing above this.</p>
          )}
        </>
      )}
      <p className="mt-4 font-mono text-[11px] leading-relaxed text-dim">
        compared with what JEE aspirants at each rank put in · real 2025 cutoffs · resets every monday, today counts once it lifts your average
      </p>
    </Section>
  );
}

function Goal({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-20 font-mono text-[12px] text-mute">{label}</span>
      <DotBar value={fraction} dots={12} size={4} />
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-fg">{value}</span>
    </div>
  );
}

/** Today against his own goals (set on /me), and the question counter. */
export function TodayLog() {
  const { questions, addQuestions, settings } = useProgress();
  const r = useCollegeReport();
  const t = today();
  const q = questions[t];
  const goals = settings.targets ?? DEFAULT_TARGETS;
  const coachingDay = coachingMinutes(settings.coaching, t) > 0;
  const goalMinutes = (coachingDay ? goals.hoursCoaching : goals.hoursOff) * 60;
  const step = (subject: SubjectId, n: number) => {
    buzz(n > 0 ? 8 : 5);
    addQuestions(subject, n);
  };
  return (
    <Section label="today" right="vs your goals">
      <Goal label="hours" value={`${formatMinutes(r.today.minutes)} / ${goalMinutes / 60}h`} fraction={r.today.minutes / goalMinutes} />
      <Goal label="questions" value={`${r.today.questions} / ${goals.questions}${r.today.testQuestions ? ` · ${r.today.testQuestions} from tests` : ""}`} fraction={r.today.questions / goals.questions} />
      <p className="mt-1 font-mono text-[11.5px] text-dim">{r.today.streak ? `streak day ✓ (${STREAK_HOURS}h+)` : `${formatMinutes(Math.max(0, STREAK_HOURS * 60 - r.today.minutes))} more for a streak day`}</p>

      <div className="mt-5">
        <Label className="mb-1">questions solved today</Label>
        {SUBJECTS.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-1.5">
            <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[s.id] }} />
            <span className="w-20 text-[15px]">{s.name}</span>
            <DotText className="w-10 text-[20px] leading-none">{q?.[s.id] ?? 0}</DotText>
            <div className="ml-auto flex gap-1.5">
              {[-1, 1, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => step(s.id, n)}
                  disabled={n < 0 && !q?.[s.id]}
                  aria-label={`${n > 0 ? "add" : "remove"} ${Math.abs(n)} ${s.name} question${Math.abs(n) > 1 ? "s" : ""}`}
                  className="min-w-9 rounded-full border border-line-2 px-2.5 py-1 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg disabled:opacity-40"
                >
                  {n > 0 ? `+${n}` : "−"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const weekLabel = (start: string) => {
  const d = new Date(`${start}T00:00`);
  const end = new Date(d.getTime() + 6 * 86_400_000);
  const f = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toLowerCase();
  return `${f(d)} – ${f(end)}`;
};

/** Finished weeks, newest first, and how many colleges of each kind he's reached. */
export function CollegeHistory() {
  const r = useCollegeReport();
  const weeks = r.history.filter((w) => !w.empty);
  if (!weeks.length) return null;
  return (
    <Section label="past weeks" right={`${r.unlocked.size} college${r.unlocked.size === 1 ? "" : "s"} reached`}>
      <div className="space-y-1">
        {weeks.slice(0, 6).map((w) => (
          <div key={w.start} className="flex items-center gap-3 py-1">
            <span className="w-28 shrink-0 font-mono text-[12px] text-dim">{weekLabel(w.start)}</span>
            <span className="min-w-0 flex-1 truncate text-[14.5px]">
              {w.college?.short} <span className="text-mute">· {w.college?.branch}</span>
            </span>
            <span className="font-mono text-[12px] text-mute">~{formatRank(w.rank)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12.5px]">
        {LADDER_TOTALS.map(({ type, total }) => {
          const got = LADDER.filter((c) => c.type === type && r.unlocked.has(c.id)).length;
          return (
            <span key={type} className={got ? "text-fg" : "text-dim"}>
              {TYPE_LABEL[type]} {got}/{total}
            </span>
          );
        })}
      </div>
    </Section>
  );
}
