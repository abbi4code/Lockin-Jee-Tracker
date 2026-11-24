import { describe, expect, it } from "vitest";
import { analysisError, biggestReason, emptyAnalysis, lostOf, mistakeTotals, needsAnalysis, parseAnalysis, pendingAnalyses, sortedOf, type Analysis } from "./analysis";
import { fromQuizrrRow, toQuizrrRow, type QuizrrAttempt } from "./quizrr";
import { fromTestRow, toTestRow, type TestResult } from "./tests";

const T = "2026-11-25";
const a = (patch: Partial<Analysis> = {}): Analysis => ({ ...emptyAnalysis(T), ...patch });

const attempt = (id: string, testId: string, takenOn: string | null, extra: Partial<QuizrrAttempt> = {}): QuizrrAttempt => ({
  id,
  testId,
  takenOn,
  score: 120,
  maxScore: 300,
  physics: null,
  chemistry: null,
  maths: null,
  percentile: null,
  rank: null,
  correct: 40,
  wrong: 20,
  unattempted: 15,
  timeMin: null,
  deleted: false,
  updatedAt: 1,
  ...extra,
});
const result = (id: string, takenOn: string | null, extra: Partial<TestResult> = {}): TestResult => ({
  id,
  trackId: "mg-phys-laws-of-motion",
  kind: "chapterwise",
  testNo: 3,
  takenOn,
  score: 40,
  maxScore: 100,
  correct: 10,
  wrong: 6,
  unattempted: 4,
  timeMin: null,
  imported: false,
  deleted: false,
  updatedAt: 1,
  ...extra,
});

describe("counting", () => {
  it("lost = wrong + skipped, null when neither was logged", () => {
    expect(lostOf({ wrong: 6, unattempted: 4 })).toBe(10);
    expect(lostOf({ wrong: 6, unattempted: null })).toBe(6);
    expect(lostOf({ wrong: null, unattempted: null })).toBeNull();
    expect(sortedOf(a({ silly: 2, concept: 3, unstudied: 1, time: 4 }))).toBe(10);
  });

  it("refuses more sorted than lost, negative or fractional counts, and a huge note", () => {
    expect(analysisError(a({ silly: 6, concept: 5 }), 10)).toMatch(/11 sorted.*lost 10/);
    expect(analysisError(a({ silly: 6, concept: 4 }), 10)).toBeNull();
    expect(analysisError(a({ silly: 60 }), null)).toBeNull();
    expect(analysisError(a({ silly: -1 }), null)).toMatch(/whole numbers/);
    expect(analysisError(a({ time: 1.5 }), null)).toMatch(/whole numbers/);
    expect(analysisError(a({ note: "x".repeat(501) }), null)).toMatch(/under 500/);
  });

  it("names the reason that cost the most, none when nothing was sorted", () => {
    expect(biggestReason(a({ silly: 2, concept: 5 }))?.id).toBe("concept");
    expect(biggestReason(a())).toBeNull();
  });
});

describe("what still needs an analysis", () => {
  it("is a scored, hand-logged test from the last 14 days without one", () => {
    expect(needsAnalysis(result("r", "2026-11-24"), T)).toBe(true);
    expect(needsAnalysis(result("r", "2026-11-12"), T)).toBe(true);
    expect(needsAnalysis(result("r", "2026-11-11"), T)).toBe(false);
    expect(needsAnalysis(result("r", "2026-11-26"), T)).toBe(false);
    expect(needsAnalysis(result("r", null), T)).toBe(false);
    expect(needsAnalysis(result("r", T, { score: null }), T)).toBe(false);
    expect(needsAnalysis(result("r", T, { imported: true }), T)).toBe(false);
    expect(needsAnalysis(result("r", T, { deleted: true }), T)).toBe(false);
    expect(needsAnalysis(result("r", T, { analysis: a() }), T)).toBe(false);
  });

  it("lists Quizrr and MathonGo tests together, oldest first, with links that open the analysis", () => {
    const list = pendingAnalyses({ r1: result("r1", "2026-11-23") }, { q1: attempt("q1", "qrt-3", "2026-11-20"), q2: attempt("q2", "qpt-1", T, { analysis: a() }) }, T);
    expect(list.map((x) => x.key)).toEqual(["quizrr:q1", "test:r1"]);
    expect(list[0]).toMatchObject({ name: "quizrr · QRT 3", href: "/quizrr/qrt/3#analysis", lost: 35 });
    expect(list[1].href).toMatch(/^\/c\/[a-z0-9-]+#test-r1$/);
    expect(list[1].name).toMatch(/test 3$/);
  });

  it("skips results for tests or chapters the app doesn't know", () => {
    expect(pendingAnalyses({ r: result("r", T, { trackId: "nope" }) }, { q: attempt("q", "qrt-99", T) }, T)).toEqual([]);
  });
});

describe("totals", () => {
  it("adds up every analysed test and ignores the rest", () => {
    const m = mistakeTotals([{ analysis: a({ silly: 3, time: 1 }) }, { analysis: a({ silly: 2, concept: 4 }) }, { analysis: null }, { analysis: a({ silly: 9 }), deleted: true }]);
    expect(m).toEqual({ tests: 2, totals: { silly: 5, concept: 4, unstudied: 0, time: 1 }, sum: 10 });
  });
});

describe("storage", () => {
  it("round-trips through both tables' rows", () => {
    const an = a({ silly: 2, note: "check units" });
    expect(fromTestRow(toTestRow(result("r", T, { analysis: an }), "u")).analysis).toEqual(an);
    expect(fromQuizrrRow(toQuizrrRow(attempt("q", "qrt-1", T, { analysis: an }), "u")).analysis).toEqual(an);
    expect(toTestRow(result("r", T), "u").analysis).toBeNull();
    // Rows from before the column existed.
    const { analysis: _, ...old } = toQuizrrRow(attempt("q", "qrt-1", T), "u");
    expect(fromQuizrrRow(old).analysis).toBeNull();
  });

  it("cleans up whatever is in the jsonb", () => {
    expect(parseAnalysis(null)).toBeNull();
    expect(parseAnalysis("yes")).toBeNull();
    expect(parseAnalysis({ silly: 2 })).toBeNull();
    expect(parseAnalysis({ on: "26/11" })).toBeNull();
    expect(parseAnalysis({ on: T, silly: -2, concept: 2.5, unstudied: "3", time: 1e9, note: 7 })).toEqual({ on: T, silly: 0, concept: 0, unstudied: 0, time: 500, note: "" });
  });
});
