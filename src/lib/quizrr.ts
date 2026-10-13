import raw from "../data/quizrr.json";
import { ALL_CHAPTERS, type SubjectId } from "../data";
import { isStudied, type Status } from "./stages";

// Quizrr: MathonGo's test platform (QRT revision tests, QPT part tests, QFT full tests). The tests themselves
// are static data (research/tests → src/data/quizrr.json). What the student scored syncs per row like
// MathonGo results (public.quizrr_attempts); the dates he should take them on are set by an admin
// (public.quizrr_schedule, read-only for students) and fall back to the agreed draft until then.

export type SeriesId = "qrt" | "qpt" | "qft11" | "qft";

export interface QuizrrSeries {
  id: SeriesId;
  name: string;
  title: string;
  /** False = listed as "coming soon": no dates, no scores yet. */
  active: boolean;
}

export type Syllabus =
  | { kind: "chapters"; subjects: { subject: SubjectId; items: { name: string; ids: string[] }[] }[] }
  | { kind: "class"; cls: 11 | 12 }
  | { kind: "full"; cls: 11 | null };

export interface QuizrrTest {
  id: string;
  series: SeriesId;
  no: number;
  quizrrId: string;
  questions: number;
  minutes: number;
  marks: number;
  /** Release (ISO, UTC). Null for "coming soon" series. */
  opensAt: string | null;
  accessEnds: string | null;
  syllabus: Syllabus;
  /** Draft date (YYYY-MM-DD) used until an admin sets one. */
  suggested: string | null;
}

/** One Quizrr test taken. Marks can be negative (JEE marking). */
export interface QuizrrAttempt {
  id: string;
  testId: string;
  takenOn: string | null; // YYYY-MM-DD
  score: number | null;
  maxScore: number | null;
  physics: number | null;
  chemistry: number | null;
  maths: number | null;
  /** Quizrr's own percentile/rank among its test-takers (shown, not used for the college score). */
  percentile: number | null;
  rank: number | null;
  correct: number | null;
  wrong: number | null;
  unattempted: number | null;
  timeMin: number | null;
  deleted: boolean;
  updatedAt: number;
}

const DATA = raw as unknown as { series: QuizrrSeries[]; tests: QuizrrTest[] };
export const QUIZRR_SERIES = DATA.series;
export const QUIZRR_TESTS = DATA.tests;
const BY_ID = new Map(QUIZRR_TESTS.map((t) => [t.id, t]));
export const getQuizrrTest = (id: string) => BY_ID.get(id);
export const seriesOf = (t: QuizrrTest) => QUIZRR_SERIES.find((s) => s.id === t.series)!;
/** Tests that get dates and scores now (QRT, QPT). */
export const ACTIVE_TESTS = QUIZRR_TESTS.filter((t) => seriesOf(t).active);
/** "QRT 1", "QPT 11". */
export const testName = (t: QuizrrTest) => `${seriesOf(t).name} ${t.no}`;
/** Each active series has its own list page, and each test its own page: /quizrr/qrt, /quizrr/qrt/1. */
export const ACTIVE_SERIES = QUIZRR_SERIES.filter((s) => s.active);
export const getActiveSeries = (id: string) => ACTIVE_SERIES.find((s) => s.id === id);
export const seriesHref = (id: SeriesId) => `/quizrr/${id}`;
export const testHref = (t: QuizrrTest) => `/quizrr/${t.series}/${t.no}`;
export const findTest = (series: string, no: string | number) => QUIZRR_TESTS.find((t) => t.series === series && t.no === Number(no) && seriesOf(t).active);

/** Admin's date wins (null = taken off the schedule); otherwise the draft. */
export const assignedDate = (t: QuizrrTest, dates: Record<string, string | null>) => (t.id in dates ? dates[t.id] : t.suggested);

export const liveAttempts = (attempts: Record<string, QuizrrAttempt>) => Object.values(attempts).filter((a) => !a.deleted);

/** The latest logged attempt of a test (one per test normally; a re-log replaces it). */
export function attemptFor(testId: string, attempts: Record<string, QuizrrAttempt>) {
  let best: QuizrrAttempt | undefined;
  for (const a of Object.values(attempts)) if (!a.deleted && a.testId === testId && (!best || a.updatedAt > best.updatedAt)) best = a;
  return best;
}

export const quizrrPct = (a: Pick<QuizrrAttempt, "score" | "maxScore">) => (a.score != null && a.maxScore ? (a.score / a.maxScore) * 100 : null);

export type TestState = "soon" | "done" | "today" | "overdue" | "planned" | "open";

/** Where a test stands for the student on `today`. Release time is separate (see `opensLater`). */
export function testState(t: QuizrrTest, attempt: QuizrrAttempt | undefined, date: string | null, today: string): TestState {
  if (!seriesOf(t).active) return "soon";
  if (attempt) return "done";
  if (!date) return "open";
  return date === today ? "today" : date < today ? "overdue" : "planned";
}

/** Not released yet at `now` (QPT 11–13 open on fixed Sundays, 9:00 am IST). */
export const opensLater = (t: QuizrrTest, now = Date.now()) => !!t.opensAt && Date.parse(t.opensAt) > now;

/** Release time in Indian time, whatever the device's zone: "sun 25 oct · 9:00 am". */
export function fmtRelease(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} · ${parts.hour}:${parts.minute} ${parts.dayPeriod}`.toLowerCase();
}

/** App chapters a test covers. Whole-class and full tests cover every JEE Main chapter of that class. */
export function testChapterIds(t: QuizrrTest): string[] {
  const s = t.syllabus;
  if (s.kind === "chapters") return [...new Set(s.subjects.flatMap((x) => x.items.flatMap((i) => i.ids)))];
  return ALL_CHAPTERS.filter((c) => c.inMain && (s.cls == null || c.cls === s.cls)).map((c) => c.id);
}

/** Chapters of the test he has studied ("test ready" or later) out of all it covers. */
export function readiness(t: QuizrrTest, chapters: Record<string, { status: Status }>) {
  const ids = testChapterIds(t);
  return { studied: ids.filter((id) => chapters[id] && isStudied(chapters[id].status)).length, total: ids.length };
}

/** Scheduled on or before `today` and not taken yet, oldest first: today's list, the badge, the planner. */
export function dueQuizrr(attempts: Record<string, QuizrrAttempt>, dates: Record<string, string | null>, today: string) {
  const taken = new Set(liveAttempts(attempts).map((a) => a.testId));
  return ACTIVE_TESTS.map((t) => ({ test: t, date: assignedDate(t, dates) }))
    .filter((x): x is { test: QuizrrTest; date: string } => !!x.date && x.date <= today && !taken.has(x.test.id))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A series' tests in the order he takes them: by date, unscheduled ones last (by number). */
export const scheduleOrder = (series: SeriesId, dates: Record<string, string | null>) =>
  QUIZRR_TESTS.filter((t) => t.series === series).sort((a, b) => (assignedDate(a, dates) ?? "9999").localeCompare(assignedDate(b, dates) ?? "9999") || a.no - b.no);

/** The next test he hasn't taken, with a date after `today` (the home strip and overviews). */
export function nextQuizrr(attempts: Record<string, QuizrrAttempt>, dates: Record<string, string | null>, today: string, series?: SeriesId) {
  return ACTIVE_TESTS.filter((t) => !series || t.series === series)
    .map((t) => ({ test: t, date: assignedDate(t, dates) }))
    .filter((x): x is { test: QuizrrTest; date: string } => !!x.date && x.date > today && !attemptFor(x.test.id, attempts))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Tests assigned to one day. */
export const quizrrOnDay = (dates: Record<string, string | null>, day: string) => ACTIVE_TESTS.filter((t) => assignedDate(t, dates) === day);

/** Per series: tests done, the last assigned date (the "finish by"), and the average score. */
export function seriesProgress(series: SeriesId, attempts: Record<string, QuizrrAttempt>, dates: Record<string, string | null>) {
  const tests = QUIZRR_TESTS.filter((t) => t.series === series);
  const done = tests.map((t) => attemptFor(t.id, attempts)).filter((a): a is QuizrrAttempt => !!a);
  const scored = done.map(quizrrPct).filter((p): p is number => p != null);
  const last = tests.map((t) => assignedDate(t, dates)).filter((d): d is string => !!d).sort().at(-1) ?? null;
  return { tests, done: done.length, total: tests.length, finishBy: last, avg: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null };
}

/** For the college score: each scored attempt's %, and questions attempted (correct + wrong) on its day. */
export function quizrrScores(attempts: Record<string, QuizrrAttempt>) {
  return liveAttempts(attempts)
    .filter((a) => a.takenOn)
    .map((a) => ({ date: a.takenOn!, pct: quizrrPct(a), questions: (a.correct ?? 0) + (a.wrong ?? 0) }));
}

export function toQuizrrRow(a: QuizrrAttempt, userId: string) {
  return {
    id: a.id,
    user_id: userId,
    test_id: a.testId,
    taken_on: a.takenOn,
    score: a.score,
    max_score: a.maxScore,
    physics: a.physics,
    chemistry: a.chemistry,
    maths: a.maths,
    percentile: a.percentile,
    rank: a.rank,
    correct: a.correct,
    wrong: a.wrong,
    unattempted: a.unattempted,
    time_min: a.timeMin,
    deleted: a.deleted,
    updated_at: new Date(a.updatedAt).toISOString(),
  };
}

/** PostgREST row → app shape (numeric columns arrive as strings). */
export function fromQuizrrRow(r: Record<string, unknown>): QuizrrAttempt {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: r.id as string,
    testId: r.test_id as string,
    takenOn: (r.taken_on as string | null) ?? null,
    score: num(r.score),
    maxScore: num(r.max_score),
    physics: num(r.physics),
    chemistry: num(r.chemistry),
    maths: num(r.maths),
    percentile: num(r.percentile),
    rank: num(r.rank),
    correct: num(r.correct),
    wrong: num(r.wrong),
    unattempted: num(r.unattempted),
    timeMin: num(r.time_min),
    deleted: !!r.deleted,
    updatedAt: new Date(r.updated_at as string).getTime(),
  };
}

/** Schedule rows → { testId: date | null }. */
export const fromScheduleRows = (rows: { test_id: string; date: string | null }[]) => Object.fromEntries(rows.map((r) => [r.test_id, r.date])) as Record<string, string | null>;
