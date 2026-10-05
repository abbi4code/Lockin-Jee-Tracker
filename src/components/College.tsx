"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { SUBJECT_COLOR, SUBJECTS, type SubjectId } from "../data";
import { collegeReport, LEVEL_TOTALS, LEVELS, type College } from "../lib/college";
import { formatMinutes } from "../lib/stats";
import { today, useProgress } from "../store/progress";
import { buzz } from "./Controls";
import { DotBar, DotText, Label, Section } from "./ui";

/** First day with any data: the collection is counted from here. */
function useReport() {
  const { sessions, questions, tests, activity, settings } = useProgress();
  return useMemo(() => {
    const days = [
      activity[0],
      sessions[0] && new Date(sessions[0].startedAt).toLocaleDateString("en-CA"),
      Object.keys(questions).sort()[0],
      ...Object.values(tests).map((t) => t.takenOn),
    ].filter((d): d is string => !!d);
    const first = days.length ? days.sort()[0] : null;
    return collegeReport({ sessions, questions, tests, coaching: settings.coaching, targets: settings.targets }, first, today());
  }, [sessions, questions, tests, activity, settings.coaching, settings.targets]);
}

function Name({ college, size = "text-[28px] lg:text-[34px]" }: { college: College; size?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={college.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
        <div className={`${size} leading-tight font-semibold tracking-tight`}>{college.short}</div>
        <div className="mt-1 font-mono text-[12.5px] text-mute">
          {college.branch} · {college.type === "BITS" ? `bitsat ${college.closing}` : `${college.exam === "advanced" ? "adv" : "main"} cutoff ${college.closing.toLocaleString("en-IN")}`}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Pillar({ label, value, fraction, note }: { label: string; value: string; fraction: number; note?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-20 font-mono text-[12px] text-mute">{label}</span>
      <DotBar value={fraction} dots={12} size={4} />
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-fg">{value}</span>
      {note && <span className="hidden font-mono text-[11px] text-dim sm:inline">{note}</span>}
    </div>
  );
}

function QuestionCounter() {
  const { questions, addQuestions } = useProgress();
  const q = questions[today()];
  const step = (subject: SubjectId, n: number) => {
    buzz(n > 0 ? 8 : 5);
    addQuestions(subject, n);
  };
  return (
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
  );
}

/** Today's college: the score, what it's made of, the next college up, and the question counter. */
export function TodayCollege() {
  const r = useReport();
  if (!LEVELS.length || !r.college || !r.level) return null;
  const d = r.today;
  const moved = !r.yesterday || r.yesterday.n === r.level.n ? "same" : r.level.n > r.yesterday.n ? "up" : "down";

  return (
    <Section label="today's college" right={`level ${r.level.n}/${LEVELS.length} · score ${Math.round(d.score)}`}>
      <Name college={r.college} />
      {r.yesterday && (
        <p className="mt-2 font-mono text-[12px] text-dim">
          {moved === "same" ? "same as yesterday" : `${moved === "up" ? "↑" : "↓"} from ${r.yesterday.college.short} yesterday`}
        </p>
      )}

      <div className="mt-4 flex min-w-0 overflow-hidden">
        <DotBar value={d.score / 100} dots="auto" size={5} color={d.score >= 60 ? "var(--color-fg)" : "var(--color-red)"} />
      </div>

      <div className="mt-4">
        <Pillar label="hours" value={`${formatMinutes(d.minutes)} / ${d.targetMinutes / 60}h`} fraction={d.minutes / d.targetMinutes} />
        <Pillar label="questions" value={`${d.questions} / ${d.targetQuestions}`} fraction={d.questions / d.targetQuestions} note={d.testQuestions ? `${d.testQuestions} from tests` : undefined} />
        <Pillar label="tests · 7d" value={d.testAvg != null ? `${Math.round(d.testAvg)}%` : "no test this week"} fraction={(d.testAvg ?? 0) / 100} />
      </div>

      {r.next ? (
        <p className="mt-4 text-[15px] leading-relaxed text-mute">
          level {r.next.level.n} at {r.next.level.min}: <span className="text-fg">{r.next.college.short} · {r.next.college.branch}</span>
          {r.next.minutes != null || r.next.questions != null ? " → " : ""}
          {r.next.minutes != null && <span className="text-fg">+{formatMinutes(r.next.minutes)} study</span>}
          {r.next.minutes != null && r.next.questions != null && " or "}
          {r.next.questions != null && <span className="text-fg">+{r.next.questions} questions</span>}
          {r.next.minutes == null && r.next.questions == null && " → a strong test score gets you there"}
        </p>
      ) : (
        <p className="mt-4 text-[15px] text-fg">top of the ladder. nothing above this.</p>
      )}

      <QuestionCounter />
    </Section>
  );
}

const WEEKDAY = ["m", "t", "w", "t", "f", "s", "s"];

/** This week's college (best 6 days + consistency bonus), last week's, and the collection. */
export function WeekCollege() {
  const r = useReport();
  if (!LEVELS.length || !r.week.college || !r.week.level) return null;
  const strong = r.week.days.filter((d) => d.score >= 60).length;
  const levels = 6;

  return (
    <Section label="this week" right={`level ${r.week.level.n} · score ${Math.round(r.week.score)} · ${strong} strong day${strong === 1 ? "" : "s"}`}>
      <Name college={r.week.college} size="text-[22px] lg:text-[26px]" />
      {r.lastWeek.college && r.lastWeek.score > 0 && <p className="mt-2 font-mono text-[12px] text-dim">last week: {r.lastWeek.college.short} · {r.lastWeek.college.branch}</p>}

      {/* Each day's score as a dot column; days at 60+ (the bonus days) are lit in full colour. */}
      <div className="mt-5 flex items-end gap-4">
        {WEEKDAY.map((label, i) => {
          const d = r.week.days[i];
          const on = d ? Math.round((d.score / 100) * levels) : 0;
          return (
            <div key={i} className="flex flex-col items-center gap-[3px]" title={d ? `${d.date}: ${Math.round(d.score)}` : undefined}>
              {Array.from({ length: levels }, (_, k) => levels - 1 - k).map((lvl) => (
                <span key={lvl} className="size-[6px] rounded-full" style={{ background: lvl < on ? (d!.score >= 60 ? "var(--color-fg)" : "var(--color-dim)") : "var(--color-dot-off)" }} />
              ))}
              <span className={`mt-1 font-mono text-[10.5px] ${d?.date === today() ? "text-fg" : "text-dim"}`}>{label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-[11.5px] text-dim">best 6 days count · +1 for every day at 60+</p>

      <div className="mt-5">
        <Label className="mb-2">unlocked</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[13px]">
          {LEVEL_TOTALS.filter((t) => t.total).map(({ type, total }) => {
            const got = new Set(LEVELS.filter((l) => l.college.type === type && r.unlocked.has(l.college.short)).map((l) => l.college.short)).size;
            return (
              <span key={type} className={got ? "text-fg" : "text-dim"}>
                {type === "BITS" ? "BITS" : `${type}s`} {got}/{total}
              </span>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
