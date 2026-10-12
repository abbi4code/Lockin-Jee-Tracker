import { describe, expect, it } from "vitest";
import type { StudySession } from "../store/progress";
import { BENCHMARKS, collegeFor, collegeReport, LADDER, nextUp, rankFor, STREAK_HOURS, tracker, valueFor, weekStart, type Inputs } from "./college";
import type { TestResult } from "./tests";

const MONDAY = "2026-10-05";
const day = (i: number) => new Date(new Date(`${MONDAY}T00:00`).getTime() + i * 86_400_000).toLocaleDateString("en-CA");
let n = 0;
const session = (date: string, minutes: number): StudySession => ({ id: `s${n++}`, chapterId: null, subject: null, mode: "stopwatch", startedAt: new Date(`${date}T10:00:00`).toISOString(), minutes });
const test = (date: string, percent: number): TestResult => ({ id: `t${n++}`, trackId: "x", kind: "chapterwise", testNo: 1, takenOn: date, score: percent, maxScore: 100, correct: null, wrong: null, unattempted: null, timeMin: null, imported: false, deleted: false, updatedAt: 1 });

/** A week of identical days. */
function steady(hours: number, questions: number, testPct?: number, startOffset = 0): Inputs {
  const dates = Array.from({ length: 7 }, (_, i) => day(i + startOffset));
  return {
    sessions: dates.map((d) => session(d, hours * 60)),
    coaching: undefined,
    questions: Object.fromEntries(dates.map((d) => [d, { physics: questions, chemistry: 0, maths: 0, at: 1 }])),
    tests: testPct == null ? {} : { a: test(dates[2], testPct) },
  };
}
const finished = (input: Inputs, start = MONDAY) => tracker(input).week(start, day(10));

describe("benchmarks", () => {
  it("hit every anchor exactly and are monotonic", () => {
    for (const b of BENCHMARKS.slice(0, -1)) {
      expect(rankFor("hours", b.hours)).toBeCloseTo(b.rank, 0);
      expect(valueFor("questions", b.rank)).toBeCloseTo(b.questions, 5);
    }
    let prev = Infinity;
    for (let h = 0.5; h <= 12; h += 0.5) {
      const r = rankFor("hours", h);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("the ladder is sorted best first and collegeFor picks the best college the rank still clears", () => {
    for (let i = 1; i < LADDER.length; i++) expect(LADDER[i].rank).toBeGreaterThanOrEqual(LADDER[i - 1].rank);
    const c = collegeFor(20_000)!;
    expect(c.rank).toBeGreaterThanOrEqual(20_000);
    expect(LADDER.filter((x) => x.rank >= 20_000 && x.rank < c.rank)).toEqual([]);
  });
});

describe("realistic results", () => {
  it("4–5 hours and ~30 questions a day is nowhere near a top NIT or an IIT", () => {
    const w = finished(steady(4.5, 30));
    expect(w.rank).toBeGreaterThan(1_50_000);
    expect(["IIT"]).not.toContain(w.college!.type);
    // Not one of the top-10 NIT CSE seats the old model handed out.
    expect(w.college!.rank).toBeGreaterThan(48_000);
  });

  it("a topper's week (11 h, 120 questions, 80% tests) reaches the IIT range", () => {
    const w = finished(steady(11, 120, 80));
    expect(w.rank).toBeLessThan(2_000);
    expect(w.college!.type).toBe("IIT");
  });

  it("~6 h / 40 questions / 40% sits around rank 1 lakh", () => {
    const w = finished(steady(6, 40, 40));
    // Six streak days and a full week bonus pull it below 1 lakh; the base is exactly the anchor.
    expect(w.baseRank).toBeGreaterThan(95_000);
    expect(w.baseRank).toBeLessThan(1_05_000);
  });

  it("more effort never gives a worse college", () => {
    let prev = Infinity;
    for (const h of [1, 3, 5, 7, 9, 11]) {
      const r = finished(steady(h, h * 10, 30 + h * 4)).rank;
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
});

describe("streak bonus", () => {
  it("rewards days at 6h+; a full week adds more", () => {
    const below = finished(steady(STREAK_HOURS - 0.5, 50));
    const at = finished(steady(STREAK_HOURS, 50));
    expect(below.streakDays).toBe(0);
    expect(below.bonus).toBe(1);
    expect(at.streakDays).toBe(7);
    expect(at.bonus).toBeCloseTo(0.96 ** 7 * 0.95, 6);
  });

  it("stacks for consecutive strong weeks, up to 4", () => {
    const dates = Array.from({ length: 42 }, (_, i) => day(i - 35)); // 5 earlier weeks + this one
    const input: Inputs = { sessions: dates.map((d) => session(d, 7 * 60)), coaching: undefined, questions: {}, tests: {} };
    const w = tracker(input).week(MONDAY, day(10));
    expect(w.weekStreak).toBe(4);
    expect(w.bonus).toBeCloseTo(0.96 ** 7 * 0.95 * 0.95 ** 4, 6);
  });
});

describe("calendar week", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });

  it("a fresh day only counts once it lifts the average", () => {
    const input: Inputs = { sessions: [session(day(0), 8 * 60), session(day(1), 8 * 60)], coaching: undefined, questions: {}, tests: {} };
    const wed = tracker(input).week(MONDAY, day(2)); // Wednesday, nothing yet today
    expect(wed.hours.value).toBeCloseTo(8, 5);
    input.sessions.push(session(day(2), 11 * 60));
    expect(tracker(input).week(MONDAY, day(2)).hours.value).toBeCloseTo(9, 5);
  });

  it("an empty Monday is an empty week, not a crash", () => {
    const w = tracker({ sessions: [], coaching: undefined, questions: {}, tests: {} }).week(MONDAY, MONDAY);
    expect(w.empty).toBe(true);
    expect(w.college).not.toBeNull();
  });

  it("finished weeks use all 7 days, rest days included", () => {
    const input: Inputs = { sessions: [0, 1, 2, 3, 4, 5].map((i) => session(day(i), 7 * 60)), coaching: undefined, questions: {}, tests: {} };
    expect(finished(input).hours.value).toBeCloseTo(6, 5); // 42 h over 7 days
  });

  it("coaching hours count as study", () => {
    const input: Inputs = { sessions: [], coaching: { plans: [{ from: "2026-01-01", days: [1, 2, 3, 4, 5, 6, 0], hours: 4 }], overrides: {} }, questions: {}, tests: {} };
    expect(finished(input).hours.value).toBeCloseTo(4, 5);
  });
});

describe("next college up and the report", () => {
  it("says how much more a day it takes", () => {
    const w = finished(steady(5, 30));
    const next = nextUp(w)!;
    expect(next.college.rank).toBeLessThan(w.college!.rank);
    expect(next.minutes).toBeGreaterThan(0);
    // Adding that much really does reach it.
    const better = finished(steady(5 + next.minutes! / 60, 30));
    expect(better.rank).toBeLessThanOrEqual(next.college.rank);
  });

  it("reports this week, last week and the collection", () => {
    const input = steady(7, 60, 55, -7);
    const r = collegeReport(input, day(2), day(-7));
    expect(r.lastWeek.complete).toBe(true);
    expect(r.history[0].start).toBe(day(-7));
    expect(r.unlocked.has(r.lastWeek.college!.id)).toBe(true);
    expect(r.week.complete).toBe(false);
  });
});

describe("tests count by how many there are", () => {
  it("one test weighs a third of three", () => {
    const one = finished(steady(5, 30, 70));
    expect(one.tests!.weight).toBeCloseTo(0.1, 5);
    const input = steady(5, 30, 70);
    input.tests.b = test(day(3), 70);
    input.tests.c = test(day(4), 70);
    expect(finished(input).tests!.weight).toBeCloseTo(0.3, 5);
    // Weights always add up to 1.
    expect(one.hours.weight + one.questions.weight + one.tests!.weight).toBeCloseTo(1, 6);
  });
});
