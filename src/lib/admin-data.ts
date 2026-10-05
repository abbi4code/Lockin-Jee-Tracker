import "server-only";
import type { User } from "@supabase/supabase-js";
import { ALL_CHAPTERS, type Exam, type SubjectId } from "@/data";
import { isAdminEmail } from "@/lib/admin";
import { formatMinutes, minutesByDay, revisionsDue, streak, subjectStats } from "@/lib/stats";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ChapterProgress, QuestionDay, Settings, StudySession } from "@/store/progress";
import { collegeReport } from "@/lib/college";
import { fromTestRow, seriesSummary, type TestResult } from "@/lib/tests";
import { normalizeStatus } from "@/lib/stages";

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
  /** Today's and this week's college from the college game (null until the ladder is built). */
  college: { today: { name: string; score: number } | null; week: { name: string; score: number } | null };
}

export async function loadStudents(): Promise<{ students: StudentSummary[]; error: string | null }> {
  const admin = createSupabaseAdmin();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [users, progress, states, sessions, testRows] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
    admin.from("chapter_progress").select("user_id, chapter_id, data"),
    admin.from("user_state").select("user_id, data"),
    admin.from("study_sessions").select("id, user_id, chapter_id, subject, mode, started_at, minutes").gte("started_at", since).order("started_at"),
    admin.from("test_results").select("*"),
  ]);
  const error = users.error?.message ?? progress.error?.message ?? states.error?.message ?? sessions.error?.message ?? testRows.error?.message ?? null;
  const testsByUser = new Map<string, Record<string, TestResult>>();
  for (const r of testRows.data ?? []) {
    const m = testsByUser.get(r.user_id) ?? {};
    const t = fromTestRow(r);
    m[t.id] = t;
    testsByUser.set(r.user_id, m);
  }

  const chaptersByUser = new Map<string, Record<string, ChapterProgress>>();
  for (const row of progress.data ?? []) {
    const m = chaptersByUser.get(row.user_id) ?? {};
    m[row.chapter_id] = { ...(row.data as ChapterProgress), status: normalizeStatus((row.data as ChapterProgress).status) };
    chaptersByUser.set(row.user_id, m);
  }
  const stateByUser = new Map((states.data ?? []).map((r) => [r.user_id, r.data as { settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay> }]));
  const sessionsByUser = new Map<string, StudySession[]>();
  for (const r of sessions.data ?? []) {
    const list = sessionsByUser.get(r.user_id) ?? [];
    list.push({ id: r.id, chapterId: r.chapter_id, subject: r.subject, mode: r.mode, startedAt: r.started_at, minutes: r.minutes });
    sessionsByUser.set(r.user_id, list);
  }

  // Admins (coaches) aren't students: leave them out of the student list.
  const students = (users.data?.users ?? []).filter((u: User) => !isAdminEmail(u.email)).map((u: User) => summarise(u, chaptersByUser.get(u.id) ?? {}, stateByUser.get(u.id), sessionsByUser.get(u.id) ?? [], testsByUser.get(u.id) ?? {}));
  students.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  return { students, error };
}

function summarise(
  u: User,
  chapters: Record<string, ChapterProgress>,
  state: { settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay> } | undefined,
  sessions: StudySession[],
  tests: Record<string, TestResult>,
): StudentSummary {
  const exam: Exam = state?.settings?.exam ?? "advanced";
  const activity = state?.activity ?? [];
  const lastEdit = Math.max(0, ...Object.values(chapters).map((p) => p.updatedAt));
  const lastSession = sessions.at(-1)?.startedAt;
  const candidates = [activity.at(-1), lastEdit ? new Date(lastEdit).toISOString() : undefined, lastSession].filter(Boolean) as string[];
  const days14 = minutesByDay(sessions, 14);
  const named = (id: string) => ALL_CHAPTERS.find((c) => c.id === id);
  const game = collegeReport(
    { sessions, tests, questions: state?.questions ?? {}, coaching: state?.settings?.coaching, targets: state?.settings?.targets },
    null,
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  );

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
    college: {
      today: game.college ? { name: `${game.college.short} · ${game.college.branch}`, score: Math.round(game.today.score) } : null,
      week: game.week.college ? { name: `${game.week.college.short} · ${game.week.college.branch}`, score: Math.round(game.week.score) } : null,
    },
  };
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
