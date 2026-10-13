import "server-only";
import type { User } from "@supabase/supabase-js";
import { ALL_CHAPTERS, type Exam, type SubjectId } from "@/data";
import { isAdminEmail } from "@/lib/admin";
import { formatMinutes, minutesByDay, revisionsDue, streak, subjectStats } from "@/lib/stats";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ChapterProgress, QuestionDay, Settings, StudySession } from "@/store/progress";
import { liveSessionRows, type SessionRow } from "@/lib/sessions";
import { collegeReport } from "@/lib/college";
import { studyByDay } from "@/lib/coaching";
import { liveResults } from "@/lib/tests";
import { fromTestRow, seriesSummary, type TestResult } from "@/lib/tests";
import { normalizeStatus } from "@/lib/stages";
import { fromQuizrrRow, liveAttempts, quizrrScores, type QuizrrAttempt } from "@/lib/quizrr";

/** Re-checks admin rights on the server (the proxy already redirects non-admins; this is defence in depth). */
export async function requireAdmin() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;
  return isAdminEmail(email) ? email! : null;
}

export interface StudentSummary {
  id: string;
  email: string;
  name: string;
  joined: string;
  lastSignIn: string | null;
  lastActive: string | null;
  exam: Exam;
  chapters: Record<string, ChapterProgress>;
  overall: ReturnType<typeof subjectStats>;
  bySubject: Record<SubjectId, ReturnType<typeof subjectStats>>;
  streak: ReturnType<typeof streak>;
  minutesToday: number;
  minutes7: number;
  minutes30: number;
  last14: { date: string; minutes: number }[];
  sessions: StudySession[];
  inProgress: { id: string; name: string; subject: SubjectId; updatedAt: number }[];
  weak: { id: string; name: string; subject: SubjectId; confidence: number }[];
  revisionsDue: number;
  tests: Record<string, TestResult>;
  series: ReturnType<typeof seriesSummary>;
  imported: boolean;
  /** This week's college so far and last week's final, from the college game (null with nothing logged). */
  college: { week: { name: string; rank: number } | null; lastWeek: { name: string; rank: number } | null };
  /** Last 7 days, coaching included. */
  study7: number;
  questions7: number;
  testsGiven: number;
}

export async function loadStudents(): Promise<{ students: StudentSummary[]; error: string | null }> {
  const admin = createSupabaseAdmin();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [users, progress, states, sessions, testRows, quizrrRows] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
    admin.from("chapter_progress").select("user_id, chapter_id, data"),
    admin.from("user_state").select("user_id, data"),
    admin.from("study_sessions").select("*").gte("started_at", since).order("started_at"),
    admin.from("test_results").select("*"),
    // Errors (e.g. the Quizrr migration not applied yet) just mean no Quizrr scores.
    admin.from("quizrr_attempts").select("*"),
  ]);
  const error = users.error?.message ?? progress.error?.message ?? states.error?.message ?? sessions.error?.message ?? testRows.error?.message ?? null;
  const testsByUser = new Map<string, Record<string, TestResult>>();
  for (const r of testRows.data ?? []) {
    const m = testsByUser.get(r.user_id) ?? {};
    const t = fromTestRow(r);
    m[t.id] = t;
    testsByUser.set(r.user_id, m);
  }
  const quizrrByUser = new Map<string, Record<string, QuizrrAttempt>>();
  for (const r of quizrrRows.error ? [] : (quizrrRows.data ?? [])) {
    const m = quizrrByUser.get(r.user_id) ?? {};
    const a = fromQuizrrRow(r);
    m[a.id] = a;
    quizrrByUser.set(r.user_id, m);
  }

  const chaptersByUser = new Map<string, Record<string, ChapterProgress>>();
  for (const row of progress.data ?? []) {
    const m = chaptersByUser.get(row.user_id) ?? {};
    m[row.chapter_id] = { ...(row.data as ChapterProgress), status: normalizeStatus((row.data as ChapterProgress).status) };
    chaptersByUser.set(row.user_id, m);
  }
  const stateByUser = new Map((states.data ?? []).map((r) => [r.user_id, r.data as { settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay> }]));
  const sessionsByUser = new Map<string, StudySession[]>();
  for (const r of (sessions.data ?? []) as SessionRow[]) {
    if (r.deleted) continue;
    const list = sessionsByUser.get(r.user_id!) ?? [];
    list.push(...liveSessionRows([r]));
    sessionsByUser.set(r.user_id!, list);
  }

  // Admins (coaches) aren't students: leave them out of the student list.
  const students = (users.data?.users ?? []).filter((u: User) => !isAdminEmail(u.email)).map((u: User) => summarise(u, chaptersByUser.get(u.id) ?? {}, stateByUser.get(u.id), sessionsByUser.get(u.id) ?? [], testsByUser.get(u.id) ?? {}, quizrrByUser.get(u.id) ?? {}));
  students.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  return { students, error };
}

function summarise(
  u: User,
  chapters: Record<string, ChapterProgress>,
  state: { settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay> } | undefined,
  sessions: StudySession[],
  tests: Record<string, TestResult>,
  quizrr: Record<string, QuizrrAttempt>,
): StudentSummary {
  const exam: Exam = state?.settings?.exam ?? "advanced";
  const activity = state?.activity ?? [];
  const lastEdit = Math.max(0, ...Object.values(chapters).map((p) => p.updatedAt));
  const lastSession = sessions.at(-1)?.startedAt;
  const candidates = [activity.at(-1), lastEdit ? new Date(lastEdit).toISOString() : undefined, lastSession].filter(Boolean) as string[];
  const days14 = minutesByDay(sessions, 14);
  const named = (id: string) => ALL_CHAPTERS.find((c) => c.id === id);
  const game = collegeReport(
    { sessions, tests, quizrr, questions: state?.questions ?? {}, coaching: state?.settings?.coaching },
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    null,
    1,
  );
  const weekName = (w: typeof game.week) => (w.college && !w.empty ? { name: `${w.college.short} · ${w.college.branch}`, rank: Math.round(w.rank) } : null);

  return {
    id: u.id,
    email: u.email ?? "(no email)",
    name: state?.settings?.name || (u.user_metadata?.name as string | undefined) || u.email?.split("@")[0] || "student",
    joined: u.created_at,
    lastSignIn: u.last_sign_in_at ?? null,
    lastActive: candidates.sort().at(-1) ?? null,
    exam,
    chapters,
    overall: subjectStats("all", chapters, exam),
    bySubject: {
      physics: subjectStats("physics", chapters, exam),
      chemistry: subjectStats("chemistry", chapters, exam),
      maths: subjectStats("maths", chapters, exam),
    },
    streak: streak(activity),
    minutesToday: days14.at(-1)?.minutes ?? 0,
    minutes7: days14.slice(-7).reduce((n, d) => n + d.minutes, 0),
    minutes30: sessions.reduce((n, s) => n + s.minutes, 0),
    last14: days14,
    sessions,
    inProgress: Object.entries(chapters)
      .filter(([, p]) => p.status === "working")
      .map(([id, p]) => ({ id, name: named(id)?.name ?? id, subject: named(id)?.subject ?? "physics", updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    weak: Object.entries(chapters)
      .filter(([, p]) => p.confidence != null && p.confidence <= 1)
      .map(([id, p]) => ({ id, name: named(id)?.name ?? id, subject: named(id)?.subject ?? "physics", confidence: p.confidence! })),
    revisionsDue: revisionsDue(chapters, exam).length,
    tests,
    series: seriesSummary(tests),
    imported: Object.values(tests).some((t) => t.imported),
    study7: studyByDay(sessions, state?.settings?.coaching, 7).reduce((n, d) => n + d.total, 0),
    questions7: questions7(state?.questions ?? {}, tests, quizrr),
    testsGiven: liveResults(tests).length + liveAttempts(quizrr).length,
    college: { week: weekName(game.week), lastWeek: weekName(game.lastWeek) },
  };
}

/** Questions logged plus attempted in tests over the last 7 days. */
function questions7(questions: Record<string, QuestionDay>, tests: Record<string, TestResult>, quizrr: Record<string, QuizrrAttempt>) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-CA");
    const q = questions[d];
    if (q) n += q.physics + q.chemistry + q.maths;
    for (const t of liveResults(tests)) if (t.takenOn === d) n += (t.correct ?? 0) + (t.wrong ?? 0);
    for (const q of quizrrScores(quizrr)) if (q.date === d) n += q.questions;
  }
  return n;
}

export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export { formatMinutes };
