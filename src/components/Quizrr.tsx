"use client";

import { motion } from "motion/react";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { getChapter, SUBJECT_COLOR, type SubjectId } from "../data";
import { dayLabel } from "../lib/plan";
import {
  assignedDate,
  attemptFor,
  fmtRelease,
  opensLater,
  quizrrPct,
  readiness,
  testChapterIds,
  testHref,
  testName,
  testState,
  type QuizrrAttempt,
  type QuizrrTest,
} from "../lib/quizrr";
import { isStudied, stageLabel } from "../lib/stages";
import { scoreTone } from "../lib/tests";
import { today, useProgress } from "../store/progress";
import { buzz } from "./Controls";
import { DotBar, DotText, Label, StatusDot, Tag } from "./ui";

const SUBJECTS: { id: SubjectId; short: string }[] = [
  { id: "physics", short: "phy" },
  { id: "chemistry", short: "chem" },
  { id: "maths", short: "math" },
];

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const input = "w-full border-b border-line-2 bg-transparent py-1.5 font-mono text-[15px] outline-none transition-colors placeholder:text-dim focus:border-fg";
const hm = (min: number) => (min % 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min / 60}h`);
/** "45 q · 90 min · 180 marks" */
export const formatLine = (t: QuizrrTest) => `${t.questions} q · ${t.minutes < 120 ? `${t.minutes} min` : hm(t.minutes)} · ${t.marks} marks`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="font-mono text-[11px] tracking-wider text-mute uppercase">{label}</span>
      {children}
    </label>
  );
}

/** Inline form to log (or fix) a Quizrr score: total, per subject, Quizrr's percentile/rank, and the split. */
export function QuizrrEditor({ test, existing, onClose }: { test: QuizrrTest; existing?: QuizrrAttempt; onClose: () => void }) {
  const { saveQuizrr, deleteQuizrr } = useProgress();
  const str = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [f, setF] = useState({
    score: str(existing?.score),
    max: str(existing?.maxScore ?? test.marks),
    date: existing?.takenOn ?? today(),
    physics: str(existing?.physics),
    chemistry: str(existing?.chemistry),
    maths: str(existing?.maths),
    percentile: str(existing?.percentile),
    rank: str(existing?.rank),
    correct: str(existing?.correct),
    wrong: str(existing?.wrong),
    unattempted: str(existing?.unattempted),
    time: str(existing?.timeMin),
  });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const max = num(f.max);
  const parts = SUBJECTS.map((s) => num(f[s.id]));
  const allParts = parts.every((p) => p != null);
  // Total left empty but every subject filled in: the total is their sum.
  const score = num(f.score) ?? (allParts ? parts.reduce((a, b) => a! + b!, 0) : null);
  const percentile = num(f.percentile);
  const rank = num(f.rank);
  const bad = (v: number | null) => v != null && Number.isNaN(v);
  // JEE marking (+4 / −1): the lowest possible is −¼ of the max, per subject −¹⁄₁₂.
  const errors = [
    (bad(max) || (max != null && max <= 0)) && "max must be above 0.",
    score == null && "add the marks (or all three subjects).",
    (bad(score) || (score != null && max != null && (score > max || score < -max / 4))) && `marks must be between ${max != null ? -max / 4 : "–"} and ${max ?? "the max"}.`,
    parts.some((p) => bad(p) || (p != null && max != null && (p > max / 3 || p < -max / 12))) && `subject marks must be between ${max != null ? -max / 12 : "–"} and ${max != null ? max / 3 : "–"}.`,
    (bad(percentile) || (percentile != null && (percentile < 0 || percentile > 100))) && "percentile is 0–100.",
    (bad(rank) || (rank != null && (rank < 1 || !Number.isInteger(rank)))) && "rank is a whole number from 1.",
    !f.date && "pick the day you took it.",
  ].filter(Boolean) as string[];
  const mismatch = allParts && num(f.score) != null && parts.reduce((a, b) => a! + b!, 0) !== num(f.score);

  const save = () => {
    if (errors.length) return;
    buzz(12);
    saveQuizrr({
      id: existing?.id ?? crypto.randomUUID(),
      testId: test.id,
      takenOn: f.date,
      score,
      maxScore: max,
      physics: parts[0],
      chemistry: parts[1],
      maths: parts[2],
      percentile,
      rank,
      correct: num(f.correct),
      wrong: num(f.wrong),
      unattempted: num(f.unattempted),
      timeMin: num(f.time),
    });
    onClose();
  };

  const p = score != null && max ? Math.round((score / max) * 100) : null;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mt-4 rounded-lg border border-line-2 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <Label>{existing ? "fix score" : "log score"} · {testName(test).toLowerCase()}</Label>
          {p != null && !errors.length && (
            <span className="font-mono text-[13px]" style={{ color: scoreTone(p) }}>
              {p}%
            </span>
          )}
        </div>
        {/* Phones: the date gets a full row (a third of the width can't fit a date field). */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="marks">
            <input inputMode="decimal" value={f.score} onChange={set("score")} placeholder={allParts && score != null ? String(score) : "e.g. 132"} className={input} autoFocus />
          </Field>
          <Field label="out of">
            <input inputMode="decimal" value={f.max} onChange={set("max")} className={input} />
          </Field>
          <div className="col-span-2 sm:col-span-1">
            <Field label="date">
              <input type="date" value={f.date} max={today()} onChange={set("date")} className={input} />
            </Field>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3">
          {SUBJECTS.map((s) => (
            <Field key={s.id} label={s.short}>
              <input inputMode="decimal" value={f[s.id]} onChange={set(s.id)} placeholder={max ? `/${max / 3}` : "–"} className={input} />
            </Field>
          ))}
          <Field label="percentile">
            <input inputMode="decimal" value={f.percentile} onChange={set("percentile")} placeholder="–" className={input} />
          </Field>
          <Field label="rank">
            <input inputMode="numeric" value={f.rank} onChange={set("rank")} placeholder="–" className={input} />
          </Field>
          <Field label="time (min)">
            <input inputMode="numeric" value={f.time} onChange={set("time")} placeholder={String(test.minutes)} className={input} />
          </Field>
          <Field label="correct">
            <input inputMode="numeric" value={f.correct} onChange={set("correct")} placeholder="–" className={input} />
          </Field>
          <Field label="wrong">
            <input inputMode="numeric" value={f.wrong} onChange={set("wrong")} placeholder="–" className={input} />
          </Field>
          <Field label="skipped">
            <input inputMode="numeric" value={f.unattempted} onChange={set("unattempted")} placeholder="–" className={input} />
          </Field>
        </div>
        {errors.length > 0 && (f.score || f.physics || f.chemistry || f.maths) ? <p className="mt-3 font-mono text-[12px] text-red">{errors[0]}</p> : null}
        {mismatch && !errors.length && <p className="mt-3 font-mono text-[12px] text-mute">heads up: phy + chem + math don&apos;t add up to the total.</p>}
        <div className="mt-4 flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={save} disabled={errors.length > 0} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
            save
          </motion.button>
          <button onClick={onClose} className="rounded-full px-3 py-2 text-[14px] text-mute hover:text-fg">
            cancel
          </button>
          {existing && (
            <button
              onClick={() => {
                buzz(20);
                deleteQuizrr(existing.id);
                onClose();
              }}
              data-cursor="danger"
              className="ml-auto rounded-full px-3 py-2 font-mono text-[12px] text-mute hover:text-red"
            >
              remove
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** The syllabus, one subject per block; each Quizrr chapter links to the app's chapter with its stage dot. */
export function SyllabusList({ test }: { test: QuizrrTest }) {
  const chapters = useProgress((s) => s.chapters);
  const s = test.syllabus;
  if (s.kind !== "chapters") {
    const ids = testChapterIds(test);
    return (
      <p className="text-[15px] text-mute">
        {s.kind === "class" ? `complete class ${s.cls} syllabus` : "full syllabus"} · {ids.length} chapters. see how ready you are on the subject pages.
      </p>
    );
  }
  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
      {s.subjects.map(({ subject, items }) => (
        <div key={subject} className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[subject] }} aria-hidden />
            <Label>{subject}</Label>
          </div>
          {items.map((it) => (
            <div key={it.name} className="border-t border-line/60 py-2.5 first:border-t-0">
              <div className="text-[15px] leading-snug">{it.name}</div>
              {it.ids.length ? (
                it.ids.map((id) => {
                  const c = getChapter(id)!;
                  const status = chapters[id]?.status ?? "undone";
                  return (
                    <Link key={id} href={`/c/${id}`} className="mt-1 flex items-baseline gap-2 font-mono text-[12px] text-mute transition hover:text-fg">
                      <span className="translate-y-[1px]">
                        <StatusDot status={status} />
                      </span>
                      <span className="min-w-0">
                        {c.name} <span className="text-dim">· {isStudied(status) ? "studied" : stageLabel(status).toLowerCase()}</span>
                      </span>
                    </Link>
                  );
                })
              ) : (
                <div className="mt-1 font-mono text-[12px] text-dim">no chapter in the app</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One line: subject dot + chapter names per subject, for the series list. */
function SyllabusSummary({ test }: { test: QuizrrTest }) {
  const s = test.syllabus;
  if (s.kind !== "chapters") return <span className="text-mute">complete class {s.kind === "class" ? s.cls : ""} syllabus</span>;
  return (
    <span className="text-mute">
      {s.subjects.map(({ subject, items }) => (
        <span key={subject} className="mr-3 inline">
          <span className="mr-1.5 inline-block size-1.5 translate-y-[-2px] rounded-full" style={{ background: SUBJECT_COLOR[subject] }} aria-hidden />
          {items.map((i) => i.name).join(", ")}
        </span>
      ))}
    </span>
  );
}

/** "4/6 studied" with one dot per chapter (whole-class tests: a proportional bar). */
export function Readiness({ test }: { test: QuizrrTest }) {
  const chapters = useProgress((s) => s.chapters);
  const r = readiness(test, chapters);
  if (!r.total) return null;
  return (
    <div className="flex items-center gap-2.5">
      <DotBar value={r.studied / r.total} dots={Math.min(r.total, 24)} size={4} />
      <span className="font-mono text-[12px] text-dim">
        {r.studied}/{r.total} chapters studied
      </span>
    </div>
  );
}

/** Marks with the % and the subject split. */
export function ScoreBlock({ a, big = false }: { a: QuizrrAttempt; big?: boolean }) {
  const p = quizrrPct(a);
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <DotText className={`${big ? "text-[56px]" : "text-[24px]"} leading-none`}>{String(a.score ?? "–")}</DotText>
        <span className="font-mono text-[12px] text-dim">/{a.maxScore}</span>
      </div>
      <div className="mt-1.5 font-mono text-[12.5px]">
        {p != null && <span style={{ color: scoreTone(p) }}>{Math.round(p)}%</span>}
        {a.percentile != null && <span className="text-mute"> · {a.percentile} %ile</span>}
        {a.rank != null && <span className="text-mute"> · rank {a.rank}</span>}
      </div>
      {(a.physics != null || a.chemistry != null || a.maths != null) && (
        <div className="mt-0.5 font-mono text-[12px] text-dim">{SUBJECTS.map((s) => `${s.short} ${a[s.id] ?? "–"}`).join(" · ")}</div>
      )}
    </div>
  );
}

/** When a test sits for him: "today", "missed", "opens …", or its day. */
export function useTestStatus(test: QuizrrTest) {
  const { quizrr, quizrrDates } = useProgress();
  const t = today();
  const attempt = attemptFor(test.id, quizrr);
  const date = assignedDate(test, quizrrDates);
  return { t, attempt, date, state: testState(test, attempt, date, t), later: opensLater(test) };
}

/** One test in a series list: day, name, one-line syllabus, and its result or state. The whole row opens the test. */
export function QuizrrListRow({ test }: { test: QuizrrTest }) {
  const { t, attempt, date, state, later } = useTestStatus(test);
  const p = attempt ? quizrrPct(attempt) : null;
  const urgent = state === "today" || state === "overdue";
  return (
    <Link href={testHref(test)} className="group -mx-2 grid grid-cols-[84px_minmax(0,1fr)_auto] items-start gap-x-4 rounded-lg px-2 py-4 transition hover:bg-ink-2 sm:grid-cols-[104px_minmax(0,1fr)_auto]">
      <span className={`pt-1 font-mono text-[12.5px] ${urgent ? "text-red" : state === "done" ? "text-dim" : "text-mute"}`}>{date ? dayLabel(date, t).replace(",", "") : "no date"}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className={`text-[18px] font-semibold tracking-tight ${state === "done" ? "text-mute" : ""}`}>
            {test.series.toUpperCase()} <DotText>{test.no}</DotText>
          </span>
          {state === "today" && <Tag tone="red">today</Tag>}
          {state === "overdue" && <Tag tone="red">missed</Tag>}
        </span>
        {/* Phones: two lines so chemistry and maths aren't cut off; laptops fit it on one. */}
        <span className="mt-1 line-clamp-2 text-[14.5px] sm:block sm:truncate">
          <SyllabusSummary test={test} />
        </span>
      </span>
      <span className="flex items-center gap-2 pt-1 font-mono text-[12.5px]">
        {attempt ? (
          <span style={{ color: scoreTone(p) }}>
            {attempt.score}/{attempt.maxScore}
          </span>
        ) : later ? (
          <span className="hidden text-dim sm:inline">opens {fmtRelease(test.opensAt!).split(" · ")[0]}</span>
        ) : (
          <span className={urgent ? "text-fg" : "text-dim"}>{urgent ? "log score" : ""}</span>
        )}
        <ChevronRight className="size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg" />
      </span>
    </Link>
  );
}

/** A Quizrr test in a day list (home, planner): not tickable, it's done once a score is logged on /quizrr. */
export function QuizrrDayRow({ test, t, compact = false }: { test: QuizrrTest; t: string; compact?: boolean }) {
  const { quizrr, quizrrDates } = useProgress();
  const attempt = attemptFor(test.id, quizrr);
  const date = assignedDate(test, quizrrDates);
  const late = !attempt && !!date && date < t;
  const p = attempt ? quizrrPct(attempt) : null;
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
      <Link href={testHref(test)} className="group flex items-start gap-2.5 py-2">
        {/* Same footprint as a checkbox: a filled square once the score is in. */}
        <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[4px] border font-mono text-[10px] ${attempt ? "border-fg bg-fg text-ink" : late ? "border-red text-red" : "border-line-2 text-dim"}`} aria-hidden>
          {attempt ? "✓" : "q"}
        </span>
        <div className="min-w-0 flex-1">
          <span className={`block text-[14.5px] leading-snug ${attempt ? "text-dim line-through decoration-dim" : "group-hover:underline"}`}>quizrr · {testName(test)}</span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-dim">
            <span>test · {test.minutes < 120 ? `${test.minutes} min` : hm(test.minutes)}</span>
            {late && !compact && <span className="text-red">{dayLabel(date!, t)}</span>}
            {p != null && <span style={{ color: scoreTone(p) }}>{Math.round(p)}%</span>}
          </div>
        </div>
        {!attempt && !compact && (
          <span className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[12px] text-mute group-hover:text-fg">
            log score <ArrowRight className="size-3.5" />
          </span>
        )}
      </Link>
    </motion.div>
  );
}
