import { beforeEach, describe, expect, it } from "vitest";
import { useProgress } from "../store/progress";
import { emptyAnalysis } from "./analysis";
import { ACTIVE_TESTS, assignedDate, dateProblem, getQuizrrTest, mergeSchedule, releaseDay, replan, untakenInOrder, type QuizrrAttempt } from "./quizrr";

// The student picking his own Quizrr dates: one test at a time, or re-planning everything left.

const T = "2026-11-25";
const took = (testId: string): Record<string, QuizrrAttempt> => ({
  [testId]: {
    id: testId,
    testId,
    takenOn: "2026-10-20",
    score: 100,
    maxScore: 300,
    physics: null,
    chemistry: null,
    maths: null,
    percentile: null,
    rank: null,
    correct: null,
    wrong: null,
    unattempted: null,
    timeMin: null,
    deleted: false,
    updatedAt: 1,
  },
});
const iso = (ms: number) => new Date(ms).toISOString();

describe("one date", () => {
  it("must be a real day, not in the past, not before the test is out", () => {
    const qrt1 = getQuizrrTest("qrt-1")!;
    const qpt13 = getQuizrrTest("qpt-13")!;
    expect(dateProblem(qrt1, T, T)).toBeNull();
    expect(dateProblem(qrt1, "2026-12-30", T)).toBeNull();
    expect(dateProblem(qrt1, "2026-11-24", T)).toMatch(/today or a later day/);
    expect(dateProblem(qrt1, "", T)).toMatch(/pick a day/);
    expect(dateProblem(qrt1, "2026-13-45", T)).toMatch(/pick a day/);
    // QPT 13 opens on 22 Nov.
    expect(releaseDay(qpt13)).toBe("2026-11-22");
    expect(dateProblem(qpt13, "2026-11-20", "2026-11-15")).toMatch(/QPT 13 only opens on 22\/11/);
    expect(dateProblem(qpt13, "2026-11-22", "2026-11-15")).toBeNull();
  });
});

describe("re-planning", () => {
  it("keeps the current order: missed ones first, QRT before QPT on the same day, undated last", () => {
    const order = untakenInOrder({}, { "qpt-5": null, "qrt-12": "2026-10-14" }).map((t) => t.id);
    expect(order.slice(0, 3)).toEqual(["qrt-1", "qrt-12", "qrt-2"]);
    expect(order.at(-1)).toBe("qpt-5");
    expect(order).toHaveLength(ACTIVE_TESTS.length);
    expect(untakenInOrder(took("qrt-1"), {}).map((t) => t.id)).not.toContain("qrt-1");
  });

  it("puts every test left on its own day, every `gap` days from the start", () => {
    const plan = replan({ attempts: took("qrt-1"), dates: {}, start: T, gap: 2 });
    expect(plan).toHaveLength(ACTIVE_TESTS.length - 1);
    expect(plan[0]).toMatchObject({ to: T, from: "2026-10-16" });
    expect(plan[0].test.id).toBe("qrt-2");
    expect(plan[1].to).toBe("2026-11-27");
    expect(new Set(plan.map((p) => p.to)).size).toBe(plan.length);
    expect(plan.at(-1)!.to).toBe("2027-01-10");
    // Crosses month and year ends cleanly.
    expect(replan({ attempts: {}, dates: {}, start: "2026-12-30", gap: 1 }).slice(0, 4).map((p) => p.to)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("skips coaching days, but never a whole week", () => {
    // 25 Nov 2026 is a Wednesday: skip Wednesdays and Thursdays.
    const skip = (d: string) => [3, 4].includes(new Date(`${d}T12:00`).getDay());
    const plan = replan({ attempts: {}, dates: {}, start: T, gap: 1, skip });
    expect(plan.slice(0, 4).map((p) => p.to)).toEqual(["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"]);
    expect(plan.every((p) => !skip(p.to))).toBe(true);
    const always = replan({ attempts: {}, dates: {}, start: T, gap: 1, skip: () => true });
    expect(always).toHaveLength(ACTIVE_TESTS.length);
  });

  it("holds a test back until it's out, filling the days before with the others", () => {
    // Before QPT 11–13 are out: they move behind what can be taken now.
    const plan = replan({ attempts: {}, dates: {}, start: "2026-10-20", gap: 1 });
    for (const p of plan) expect(p.to >= (releaseDay(p.test) ?? "")).toBe(true);
    const qpt13 = plan.find((p) => p.test.id === "qpt-13")!;
    expect(qpt13.to >= "2026-11-22").toBe(true);
    // Only unreleased tests left: it jumps to the first release.
    const onlyLate = Object.fromEntries(ACTIVE_TESTS.filter((t) => !["qpt-11", "qpt-12", "qpt-13"].includes(t.id)).flatMap((t) => Object.entries(took(t.id))));
    expect(replan({ attempts: onlyLate, dates: {}, start: "2026-10-01", gap: 1 }).map((p) => p.to)).toEqual(["2026-10-25", "2026-11-08", "2026-11-22"]);
  });

  it("has nothing to do once every test is taken", () => {
    const all = Object.fromEntries(ACTIVE_TESTS.flatMap((t) => Object.entries(took(t.id))));
    expect(replan({ attempts: all, dates: {}, start: T, gap: 2 })).toEqual([]);
  });
});

describe("merging the server's dates with his picks", () => {
  const row = (test_id: string, date: string | null, at: number, set_by?: string) => ({ test_id, date, set_by, updated_at: iso(at) });

  it("keeps a pick newer than the server's row, and drops one the admin overrode", () => {
    const m = mergeSchedule([row("qrt-1", "2026-12-01", 100, "admin"), row("qrt-2", "2026-12-05", 300, "admin")], {
      "qrt-1": { date: "2026-11-30", at: 200 },
      "qrt-2": { date: "2026-11-29", at: 250 },
      "qrt-3": { date: null, at: 50 },
    });
    expect(m.dates).toEqual({ "qrt-1": "2026-11-30", "qrt-2": "2026-12-05", "qrt-3": null });
    expect(m.by).toEqual({ "qrt-1": "student", "qrt-2": "admin", "qrt-3": "student" });
    expect(Object.keys(m.edits).sort()).toEqual(["qrt-1", "qrt-3"]);
  });

  it("treats rows from before set_by existed as the admin's", () => {
    expect(mergeSchedule([row("qrt-1", T, 1)], {}).by).toEqual({ "qrt-1": "admin" });
    expect(mergeSchedule([row("qrt-1", T, 1, "student")], {}).by).toEqual({ "qrt-1": "student" });
  });
});

describe("store", () => {
  const s = () => useProgress.getState();
  beforeEach(() => {
    s().reset();
    useProgress.setState({ dirty: [] });
  });

  it("a pick changes the date at once, is marked his, and queued until the server confirms it", () => {
    s().pickQuizrrDates([
      { testId: "qrt-1", date: "2026-11-28" },
      { testId: "qpt-2", date: null },
    ]);
    expect(assignedDate(getQuizrrTest("qrt-1")!, s().quizrrDates)).toBe("2026-11-28");
    expect(assignedDate(getQuizrrTest("qpt-2")!, s().quizrrDates)).toBeNull();
    expect(s().quizrrDateBy["qrt-1"]).toBe("student");
    expect(s().dirty).toEqual(expect.arrayContaining(["qdate:qrt-1", "qdate:qpt-2"]));
    const at = s().quizrrDateEdits["qrt-1"].at;
    s().confirmQuizrrDates({ "qrt-1": at, "qpt-2": at });
    s().markClean(["qdate:qrt-1", "qdate:qpt-2"], { "qdate:qrt-1": at, "qdate:qpt-2": at });
    expect(s().quizrrDateEdits).toEqual({});
    expect(s().dirty).toEqual([]);
    // The date itself stays.
    expect(s().quizrrDates["qrt-1"]).toBe("2026-11-28");
  });

  it("a pick made while the upload was in flight stays queued", () => {
    s().pickQuizrrDates([{ testId: "qrt-1", date: "2026-11-28" }]);
    const first = s().quizrrDateEdits["qrt-1"].at;
    useProgress.setState({ quizrrDateEdits: { "qrt-1": { date: "2026-11-29", at: first + 5 } } });
    s().confirmQuizrrDates({ "qrt-1": first });
    s().markClean(["qdate:qrt-1"], { "qdate:qrt-1": first });
    expect(s().quizrrDateEdits["qrt-1"].date).toBe("2026-11-29");
    expect(s().dirty).toContain("qdate:qrt-1");
  });

  it("an analysis is saved on the result, counts today, and keeps the score", () => {
    s().saveQuizrr({ ...took("qrt-1")["qrt-1"], id: "a1" });
    const before = s().quizrr.a1.updatedAt;
    s().saveAnalysis("quizrr", "a1", { ...emptyAnalysis("2026-11-25"), silly: 3 });
    expect(s().quizrr.a1).toMatchObject({ score: 100, analysis: { silly: 3 } });
    expect(s().quizrr.a1.updatedAt).toBeGreaterThanOrEqual(before);
    expect(s().activity).toContain(new Date().toLocaleDateString("en-CA"));
    // Re-logging the score keeps the analysis.
    s().saveQuizrr({ ...took("qrt-1")["qrt-1"], id: "a1", score: 120 });
    expect(s().quizrr.a1.analysis?.silly).toBe(3);
    s().saveAnalysis("quizrr", "a1", null);
    expect(s().quizrr.a1.analysis).toBeNull();
    // Unknown ids change nothing.
    s().saveAnalysis("test", "nope", emptyAnalysis("2026-11-25"));
    expect(s().tests).toEqual({});
  });

  it("starting the study timer ends a break", () => {
    s().breakStart(5);
    expect(s().breakTimer?.minutes).toBe(5);
    s().timerStart();
    expect(s().breakTimer).toBeNull();
    s().timerStop();
  });
});
