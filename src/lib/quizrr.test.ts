import { describe, expect, it } from "vitest";
import { getChapter } from "../data";
import { useProgress } from "../store/progress";
import { tracker } from "./college";
import {
  ACTIVE_TESTS,
  assignedDate,
  attemptFor,
  dueQuizrr,
  findTest,
  fmtRelease,
  nextQuizrr,
  scheduleOrder,
  testHref,
  getQuizrrTest,
  QUIZRR_TESTS,
  quizrrOnDay,
  readiness,
  seriesProgress,
  testChapterIds,
  testState,
  type QuizrrAttempt,
} from "./quizrr";

const attempt = (testId: string, takenOn: string, score: number, max = 180, extra: Partial<QuizrrAttempt> = {}): QuizrrAttempt => ({
  id: `${testId}-${takenOn}`,
  testId,
  takenOn,
  score,
  maxScore: max,
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
  ...extra,
});
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("quizrr data", () => {
  it("has QRT 1–12 and QPT 1–13 active, the full tests coming soon", () => {
    expect(ACTIVE_TESTS.map((t) => t.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `qrt-${i + 1}`), ...Array.from({ length: 13 }, (_, i) => `qpt-${i + 1}`)]);
    expect(QUIZRR_TESTS.filter((t) => t.series === "qft11")).toHaveLength(8);
    expect(QUIZRR_TESTS.filter((t) => t.series === "qft")).toHaveLength(30);
    expect(QUIZRR_TESTS.filter((t) => t.series.startsWith("qft")).every((t) => t.opensAt == null && t.suggested == null)).toBe(true);
  });

  it("links only to real chapters, and every QRT/QPT chapter name was parsed", () => {
    for (const t of ACTIVE_TESTS) {
      expect(testChapterIds(t).length).toBeGreaterThan(0);
      for (const id of testChapterIds(t)) expect(getChapter(id), `${t.id} → ${id}`).toBeDefined();
    }
    const qrt1 = getQuizrrTest("qrt-1")!;
    expect(qrt1.syllabus.kind === "chapters" && qrt1.syllabus.subjects.map((s) => s.subject)).toEqual(["physics", "chemistry", "maths"]);
    // Same name, different chapters per test (explicit overrides).
    const pBlock = (id: string) => (getQuizrrTest(id)!.syllabus as { subjects: { items: { name: string; ids: string[] }[] }[] }).subjects.flatMap((s) => s.items).find((i) => i.name === "p Block Elements")!.ids;
    expect(pBlock("qrt-12")).toEqual(["chem-p-block-13-14"]);
    expect(pBlock("qpt-11")).toEqual(["chem-p-block-15-18"]);
    // Whole-class tests cover that class's Main chapters.
    expect(getQuizrrTest("qpt-12")!.syllabus).toEqual({ kind: "class", cls: 12 });
    expect(testChapterIds(getQuizrrTest("qpt-13")!).every((id) => getChapter(id)!.cls === 11)).toBe(true);
  });

  it("shows release times in Indian time: 03:30 UTC is 9:00 am", () => {
    expect(fmtRelease(getQuizrrTest("qpt-11")!.opensAt!)).toBe("sun 25 oct · 9:00 am");
    expect(fmtRelease(getQuizrrTest("qpt-13")!.opensAt!)).toBe("sun 22 nov · 9:00 am");
  });
});

describe("suggested schedule", () => {
  const date = (id: string) => getQuizrrTest(id)!.suggested!;

  it("starts on 14 Oct with QRT 1, finishes QRT by 10 Nov and QPT 1–12 by 20 Nov", () => {
    expect(date("qrt-1")).toBe("2026-10-14");
    for (const t of ACTIVE_TESTS.filter((t) => t.series === "qrt")) expect(date(t.id) <= "2026-11-10").toBe(true);
    for (const t of ACTIVE_TESTS.filter((t) => t.series === "qpt" && t.no <= 12)) expect(date(t.id) <= "2026-11-20").toBe(true);
    // QRT goes in order.
    const qrt = Array.from({ length: 12 }, (_, i) => date(`qrt-${i + 1}`));
    expect([...qrt].sort()).toEqual(qrt);
  });

  it("never puts a test before it opens, and only one test a day", () => {
    for (const t of ACTIVE_TESTS) if (t.opensAt) expect(date(t.id) >= istDay(t.opensAt), t.id).toBe(true);
    const days = ACTIVE_TESTS.map((t) => date(t.id));
    expect(new Set(days).size).toBe(days.length);
  });

  it("puts a QPT after the QRTs that revise its class 11 chapters", () => {
    const qrtDay = new Map<string, string>();
    for (const t of ACTIVE_TESTS.filter((t) => t.series === "qrt")) for (const id of testChapterIds(t)) qrtDay.set(id, date(t.id));
    for (const t of ACTIVE_TESTS.filter((t) => t.series === "qpt" && t.syllabus.kind === "chapters"))
      for (const id of testChapterIds(t)) if (qrtDay.has(id)) expect(date(t.id) > qrtDay.get(id)!, `${t.id} before the QRT for ${id}`).toBe(true);
    // The complete-class-11 part test comes after every QRT.
    expect(date("qpt-13") > date("qrt-12")).toBe(true);
  });
});

describe("pages", () => {
  it("each active test has its own url, and only active tests resolve", () => {
    expect(testHref(getQuizrrTest("qpt-11")!)).toBe("/quizrr/qpt/11");
    expect(findTest("qrt", "1")?.id).toBe("qrt-1");
    expect(findTest("qft", "1")).toBeUndefined();
    expect(findTest("qrt", "13")).toBeUndefined();
  });

  it("a series lists in the order he takes it; next is the first future test not taken", () => {
    expect(scheduleOrder("qpt", {}).slice(0, 3).map((t) => t.id)).toEqual(["qpt-2", "qpt-3", "qpt-4"]);
    expect(nextQuizrr({}, {}, "2026-10-13")?.test.id).toBe("qrt-1");
    expect(nextQuizrr({}, {}, "2026-10-14")?.test.id).toBe("qrt-2");
    expect(nextQuizrr({}, {}, "2026-10-13", "qpt")?.test.id).toBe("qpt-2");
  });
});

describe("dates and states", () => {
  const qrt1 = getQuizrrTest("qrt-1")!;

  it("the admin's date wins, null takes a test off the schedule, otherwise the draft", () => {
    expect(assignedDate(qrt1, {})).toBe("2026-10-14");
    expect(assignedDate(qrt1, { "qrt-1": "2026-10-15" })).toBe("2026-10-15");
    expect(assignedDate(qrt1, { "qrt-1": null })).toBeNull();
  });

  it("today / overdue / planned / done / open", () => {
    expect(testState(qrt1, undefined, "2026-10-13", "2026-10-13")).toBe("today");
    expect(testState(qrt1, undefined, "2026-10-13", "2026-10-14")).toBe("overdue");
    expect(testState(qrt1, undefined, "2026-10-13", "2026-10-12")).toBe("planned");
    expect(testState(qrt1, undefined, null, "2026-10-12")).toBe("open");
    expect(testState(qrt1, attempt("qrt-1", "2026-10-13", 90), "2026-10-13", "2026-10-14")).toBe("done");
    expect(testState(getQuizrrTest("qft-1")!, undefined, null, "2026-10-12")).toBe("soon");
  });

  it("due lists what's scheduled up to today and not taken, oldest first", () => {
    const taken = { a: attempt("qrt-1", "2026-10-13", 100) };
    expect(dueQuizrr({}, {}, "2026-10-13")).toEqual([]);
    expect(dueQuizrr({}, {}, "2026-10-16").map((d) => d.test.id)).toEqual(["qrt-1", "qrt-2"]);
    expect(dueQuizrr(taken, {}, "2026-10-16").map((d) => d.test.id)).toEqual(["qrt-2"]);
    expect(quizrrOnDay({}, "2026-10-19").map((t) => t.id)).toEqual(["qpt-2"]);
    // A deleted score doesn't count as taken.
    expect(attemptFor("qrt-1", { a: { ...taken.a, deleted: true } })).toBeUndefined();
  });

  it("series progress and readiness", () => {
    const p = seriesProgress("qrt", { a: attempt("qrt-1", "2026-10-13", 90), b: attempt("qrt-2", "2026-10-15", 45) }, {});
    expect(p).toMatchObject({ done: 2, total: 12, finishBy: "2026-11-10" });
    expect(p.avg).toBeCloseTo(37.5);
    // QRT 1 maps 4 app chapters (Mathematics in Physics has none).
    expect(readiness(qrt1, { "phy-units-measurements": { status: "ready" }, "math-logarithms": { status: "working" } })).toEqual({ studied: 1, total: 4 });
  });
});

describe("college score", () => {
  it("counts a Quizrr score like a MathonGo test, and its questions toward the day", () => {
    const base = { sessions: [], coaching: undefined, questions: {}, tests: {} };
    const quizrr = { a: attempt("qrt-1", "2026-10-07", 90, 180, { correct: 30, wrong: 10 }) };
    const w = tracker({ ...base, quizrr }).week("2026-10-05", "2026-10-15");
    expect(w.tests).toMatchObject({ value: 50, count: 1 });
    expect(tracker({ ...base, quizrr }).day("2026-10-07").questions).toBe(40);
    expect(tracker(base).week("2026-10-05", "2026-10-15").tests).toBeNull();
  });
});

describe("store", () => {
  it("saving a score queues it for sync and logs the day; sync clears it", () => {
    useProgress.getState().reset();
    useProgress.getState().saveQuizrr({ ...attempt("qrt-1", "2026-10-13", 90), id: "x" });
    const s = useProgress.getState();
    expect(s.dirty).toContain("quizrr:x");
    expect(s.activity).toContain("2026-10-13");
    s.markClean(["quizrr:x"], { "quizrr:x": s.quizrr.x.updatedAt });
    expect(useProgress.getState().dirty).not.toContain("quizrr:x");
    useProgress.getState().deleteQuizrr("x");
    expect(useProgress.getState().quizrr.x.deleted).toBe(true);
    expect(useProgress.getState().dirty).toContain("quizrr:x");
  });
});
