import { describe, expect, it, vi } from "vitest";
import type { StudySession } from "../store/progress";

// The admin panel's question numbers: focus-session questions count with the counter's and tests', per day, per
// subject (by the session's chapter), and in a summary of how the aims went.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => ({}) }));
const { questionInsights } = await import("./admin-student");
type Detail = Parameters<typeof questionInsights>[0];

const TODAY = "2026-11-25";
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();
const session = (id: string, day: string, patch: Partial<StudySession>): StudySession => ({ id, chapterId: null, subject: null, mode: "pomodoro", startedAt: at(day, "10:00"), minutes: 25, updatedAt: 1, source: "timer", ...patch });

const student = (sessions: StudySession[]): Detail =>
  ({
    sessions,
    questions: { [TODAY]: { physics: 5, chemistry: 2, maths: 0, at: 1 } },
    tests: {},
    quizrr: {},
    settings: { name: "anu", exam: "advanced", targets: { hoursCoaching: 8, hoursOff: 10, questions: 60 } },
    today: TODAY,
    joinedDay: "2026-11-01",
  }) as unknown as Detail;

describe("questionInsights with focus sessions", () => {
  const x = questionInsights(
    student([
      session("a", TODAY, { subject: "physics", chapterId: "phy-motion-1d", aim: 10, solved: 8 }),
      session("b", TODAY, { subject: "maths", chapterId: "math-sets", aim: 10, solved: 12 }),
      session("c", TODAY, { aim: 15, solved: null }),
      session("d", "2026-11-20", { solved: 6 }),
    ]),
  );

  it("adds them to the day's total, kept apart in the chart", () => {
    expect(x.today).toMatchObject({ physics: 5, chemistry: 2, fromFocus: 20, total: 27 });
    expect(x.days30.find((d) => d.date === "2026-11-20")).toMatchObject({ fromFocus: 6, total: 6 });
    expect(x.fromFocus).toBe(26);
    expect(x.allTime).toBe(33);
  });

  it("counts them under the session's subject; general study under none", () => {
    expect(Object.fromEntries(x.bySubject.map((b) => [b.id, b.count]))).toEqual({ physics: 13, chemistry: 2, maths: 12 });
  });

  it("summarises how the aims went over the last 30 days", () => {
    expect(x.focus).toMatchObject({ solved: 26, hit: 1, short: 1, pending: 1, aimSolved: 20, aim: 20 });
  });
});
