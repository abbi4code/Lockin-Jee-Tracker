import "server-only";
import { cache } from "react";
import { ALL_CHAPTERS, getChapter, getTrack, type Exam, type SubjectId } from "@/data";
import { isAdminEmail } from "@/lib/admin";
import { coachingMinutes, studyByDay } from "@/lib/coaching";
import { DEFAULT_TARGETS, levelFor, scorer, weekScore, weekStart, LEVELS, type College } from "@/lib/college";
import { addDays, fromPlanRow, type PlanItem, type PlanRow } from "@/lib/plan";
import { normalizeStatus, isStudied } from "@/lib/stages";
import { revisionsDue, streak, subjectStats } from "@/lib/stats";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { fromTestRow, liveResults, pct, type TestResult } from "@/lib/tests";
import type { ChapterProgress, QuestionDay, Settings, StudySession } from "@/store/progress";

// Everything the admin panel shows about one student, loaded once per request (the layout and the tab page
// share it through React's cache) and only for that student.

export interface StudentDetail {
  id: string;
  email: string;
  name: string;
  joined: string;
  lastSignIn: string | null;
  lastActive: string | null;
  exam: Exam;
  settings: Settings | undefined;
  chapters: Record<string, ChapterProgress>;
  activity: string[];
  sessions: StudySession[];
  questions: Record<string, QuestionDay>;
  tests: Record<string, TestResult>;
  plan: PlanItem[];
  /** False until the planner migration has been applied. */
  planAvailable: boolean;
  today: string;
  /** The day the account was created (YYYY-MM-DD). */
  joinedDay: string;
}

const SUBJECTS: SubjectId[] = ["physics", "chemistry", "maths"];

export const loadStudent = cache(async (id: string): Promise<StudentDetail | null> => {
  const admin = createSupabaseAdmin();
  const { data: userData } = await admin.auth.admin.getUserById(id);
  const u = userData?.user;
  if (!u || isAdminEmail(u.email)) return null;
  const [progress, state, sessions, tests, plan] = await Promise.all([
    admin.from("chapter_progress").select("chapter_id, data").eq("user_id", id),
    admin.from("user_state").select("data").eq("user_id", id).maybeSingle(),
    admin.from("study_sessions").select("id, chapter_id, subject, mode, started_at, minutes").eq("user_id", id).order("started_at"),
    admin.from("test_results").select("*").eq("user_id", id),
    admin.from("plan_items").select("id, chapter_id, date, kind, done_at, deleted, updated_at").eq("user_id", id).eq("deleted", false),
  ]);
  const chapters: Record<string, ChapterProgress> = {};
  for (const r of progress.data ?? []) chapters[r.chapter_id] = { ...(r.data as ChapterProgress), status: normalizeStatus((r.data as ChapterProgress).status) };
  const st = state.data?.data as { settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay> } | undefined;
  const sessionList: StudySession[] = (sessions.data ?? []).map((r) => ({ id: r.id, chapterId: r.chapter_id, subject: r.subject, mode: r.mode, startedAt: r.started_at, minutes: r.minutes }));
  const testMap: Record<string, TestResult> = {};
  for (const r of tests.data ?? []) {
    const t = fromTestRow(r);
    testMap[t.id] = t;
  }
  const activity = st?.activity ?? [];
  const lastEdit = Math.max(0, ...Object.values(chapters).map((p) => p.updatedAt));
  const candidates = [activity.at(-1), lastEdit ? new Date(lastEdit).toISOString() : undefined, sessionList.at(-1)?.startedAt].filter(Boolean) as string[];
  return {
    id: u.id,
    email: u.email ?? "(no email)",
    name: st?.settings?.name || (u.user_metadata?.name as string | undefined) || u.email?.split("@")[0] || "student",
    joined: u.created_at,
    lastSignIn: u.last_sign_in_at ?? null,
    lastActive: candidates.sort().at(-1) ?? null,
    exam: st?.settings?.exam ?? "advanced",
    settings: st?.settings,
    chapters,
    activity,
    sessions: sessionList,
    questions: st?.questions ?? {},
    tests: testMap,
    plan: plan.error ? [] : ((plan.data ?? []) as PlanRow[]).map(fromPlanRow),
    planAvailable: !plan.error,
    today: new Date().toLocaleDateString("en-CA"),
    joinedDay: new Date(u.created_at).toLocaleDateString("en-CA"),
  };
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const range = (end: string, days: number) => Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
/** Days since joining, capped at `max`: averages and "x of n days" only count days the account existed. */
export const windowDays = (s: StudentDetail, max: number) => Math.max(1, Math.min(max, Math.round((Date.parse(s.today) - Date.parse(s.joinedDay)) / 86_400_000) + 1));

// ── Study time ──
export function studyInsights(s: StudentDetail) {
  const days30 = studyByDay(s.sessions, s.settings?.coaching, 30);
  const firstDay = s.sessions[0] ? new Date(s.sessions[0].startedAt).toLocaleDateString("en-CA") : s.today;
  const coachFrom = s.settings?.coaching?.plans[0]?.from ?? s.today;
  const coachingAll = sum(range(s.today, Math.max(1, Math.round((Date.parse(s.today) - Date.parse(coachFrom)) / 86_400_000) + 1)).map((d) => coachingMinutes(s.settings?.coaching, d)));
  const focusAll = sum(s.sessions.map((x) => x.minutes));
  const bySubject = SUBJECTS.map((id) => ({ id, minutes: sum(s.sessions.filter((x) => x.subject === id).map((x) => x.minutes)) }));
  const general = sum(s.sessions.filter((x) => !x.subject).map((x) => x.minutes));
  const perChapter = new Map<string, number>();
  for (const x of s.sessions) if (x.chapterId) perChapter.set(x.chapterId, (perChapter.get(x.chapterId) ?? 0) + x.minutes);
  const topChapters = [...perChapter].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, minutes]) => ({ id, name: getChapter(id)?.name ?? id, subject: getChapter(id)?.subject, minutes }));
  const week = days30.slice(-7);
  const best = [...days30].sort((a, b) => b.total - a.total)[0];
  const window = windowDays(s, 30);
  return {
    days30,
    today: days30.at(-1)!,
    week: sum(week.map((d) => d.total)),
    month: sum(days30.map((d) => d.total)),
    window,
    avg30: Math.round(sum(days30.map((d) => d.total)) / window),
    activeDays30: days30.slice(-window).filter((d) => d.total > 0).length,
    best,
    focusAll,
    coachingAll,
    since: firstDay,
    bySubject,
    general,
    topChapters,
    sessions: [...s.sessions].reverse().slice(0, 25),
  };
}

// ── Questions ──
export function questionInsights(s: StudentDetail) {
  const testQs = new Map<string, number>();
  for (const t of liveResults(s.tests)) if (t.takenOn) testQs.set(t.takenOn, (testQs.get(t.takenOn) ?? 0) + (t.correct ?? 0) + (t.wrong ?? 0));
  const day = (date: string) => {
    const q = s.questions[date];
    const logged = { physics: q?.physics ?? 0, chemistry: q?.chemistry ?? 0, maths: q?.maths ?? 0 };
    const fromTests = testQs.get(date) ?? 0;
    return { date, ...logged, fromTests, total: logged.physics + logged.chemistry + logged.maths + fromTests };
  };
  const days30 = range(s.today, 30).map(day);
  const allDates = [...new Set([...Object.keys(s.questions), ...testQs.keys()])];
  const all = allDates.map(day);
  const target = s.settings?.targets?.questions ?? DEFAULT_TARGETS.questions;
  const window = windowDays(s, 30);
  return {
    window,
    days30,
    today: days30.at(-1)!,
    week: sum(days30.slice(-7).map((d) => d.total)),
    month: sum(days30.map((d) => d.total)),
    allTime: sum(all.map((d) => d.total)),
    bySubject: SUBJECTS.map((id) => ({ id, count: sum(all.map((d) => d[id])) })),
    fromTests: sum(all.map((d) => d.fromTests)),
    best: [...all].sort((a, b) => b.total - a.total)[0] ?? null,
    target,
    daysOnTarget30: days30.slice(-window).filter((d) => d.total >= target).length,
  };
}

// ── Tests ──
export function testInsights(s: StudentDetail) {
  const results = liveResults(s.tests);
  const scored = results.filter((t) => pct(t) != null).sort((a, b) => (a.takenOn ?? "").localeCompare(b.takenOn ?? ""));
  const avg = (xs: TestResult[]) => (xs.length ? sum(xs.map((t) => pct(t)!)) / xs.length : null);
  const correct = sum(results.map((t) => t.correct ?? 0));
  const wrong = sum(results.map((t) => t.wrong ?? 0));
  const subjectOf = (t: TestResult) => getTrack(t.trackId)?.subject;
  return {
    given: results.length,
    scored,
    avg: avg(scored),
    last5: avg(scored.slice(-5)),
    accuracy: correct + wrong ? (correct / (correct + wrong)) * 100 : null,
    correct,
    wrong,
    imported: results.filter((t) => t.imported).length,
    subjectOf,
  };
}

// ── College game ──
export interface CollegeDay {
  date: string;
  score: number;
  level: number;
  college: College | null;
}

export function collegeInsights(s: StudentDetail, days = 30) {
  const score = scorer({ sessions: s.sessions, coaching: s.settings?.coaching, questions: s.questions, tests: s.tests, targets: s.settings?.targets });
  const history: CollegeDay[] = range(s.today, days).map((date) => {
    const sc = score(date).score;
    const lvl = levelFor(sc);
    return { date, score: sc, level: lvl?.n ?? 1, college: lvl?.college ?? null };
  });
  const monday = weekStart(s.today);
  const thisWeek = range(s.today, Math.round((Date.parse(s.today) - Date.parse(monday)) / 86_400_000) + 1).map(score);
  const lastWeek = Array.from({ length: 7 }, (_, i) => score(addDays(monday, i - 7)));
  // "Where he's heading": the level his average over the last 30 days (or since joining) reaches.
  const span = history.filter((d) => d.date >= s.joinedDay);
  const formScore = sum(span.map((d) => d.score)) / Math.max(span.length, 1);
  const best = [...history].sort((a, b) => b.score - a.score)[0];
  const unlocked = new Set(history.filter((d) => d.score > 0 && d.college).map((d) => d.college!.short));
  return {
    today: history.at(-1)!,
    todayDetail: score(s.today),
    history,
    week: { score: weekScore(thisWeek), level: levelFor(weekScore(thisWeek)) },
    lastWeek: { score: weekScore(lastWeek), level: levelFor(weekScore(lastWeek)) },
    form: { score: formScore, level: levelFor(formScore), days: span.length },
    daysScored: span.filter((d) => d.score > 0).length,
    best,
    unlocked,
    levels: LEVELS,
  };
}

// ── Chapters ──
export function chapterInsights(s: StudentDetail) {
  const studied = ALL_CHAPTERS.filter((c) => s.chapters[c.id] && isStudied(s.chapters[c.id].status));
  const working = ALL_CHAPTERS.filter((c) => s.chapters[c.id]?.status === "working");
  return {
    overall: subjectStats("all", s.chapters, s.exam),
    bySubject: SUBJECTS.map((id) => ({ id, ...subjectStats(id, s.chapters, s.exam) })),
    studied,
    working,
    revisionsDue: revisionsDue(s.chapters, s.exam, s.today),
    revisionsDone: sum(Object.values(s.chapters).map((p) => p.revisions.length)),
  };
}

// ── Overview: things that need a nudge ──
export function attention(s: StudentDetail) {
  const overduePlan = s.plan.filter((i) => !i.doneAt && i.date < s.today);
  const openWeak = ALL_CHAPTERS.flatMap((c) => (s.chapters[c.id]?.weak ?? []).filter((w) => !w.fixed).map((w) => ({ chapter: c, w })));
  const shaky = ALL_CHAPTERS.filter((c) => (s.chapters[c.id]?.confidence ?? 5) <= 1);
  const week = range(s.today, windowDays(s, 7));
  const inactive7 = week.filter((d) => !s.activity.includes(d)).length;
  return { overduePlan, openWeak, shaky, inactive7, weekDays: week.length, revisionsDue: revisionsDue(s.chapters, s.exam, s.today), streak: streak(s.activity) };
}
