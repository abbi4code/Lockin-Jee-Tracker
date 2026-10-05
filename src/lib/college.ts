import raw from "../data/colleges.json";
import type { QuestionDay, StudySession } from "../store/progress";
import { coachingMinutes, type Coaching } from "./coaching";
import { pct, type TestResult } from "./tests";

// The college game: each day's effort becomes a 0–100 score, and the score reaches one of 26 levels, each a real
// college + branch (IIITs → NITs → IITs). It's motivation, not a prediction: the colleges and their order come
// from real JoSAA/BITSAT 2025 cutoffs, the score thresholds are ours.

export type CollegeType = "IIT" | "NIT" | "IIIT" | "BITS";

export interface College {
  id: string;
  short: string;
  type: CollegeType;
  branch: string;
  exam: "advanced" | "main" | "bitsat";
  /** The real cutoff in its own exam's terms (Advanced rank, Main rank or BITSAT score). */
  closing: number;
  /** Cutoff on the shared JEE Main CRL scale. The ladder is sorted by this, best first. */
  rank: number;
}

/** Best first. Built from research/colleges-*.json by scripts/build-data.mjs. */
export const LADDER = raw as unknown as College[];

export interface Targets {
  /** Study hours to aim for on coaching days (coaching included) and on other days. */
  hoursCoaching: number;
  hoursOff: number;
  questions: number;
}
export const DEFAULT_TARGETS: Targets = { hoursCoaching: 8, hoursOff: 10, questions: 60 };

/** Going past a target counts up to 120%: extra effort helps, but a 16-hour day earns nothing more than a 12-hour one. */
const CAP = 1.2;
const WEIGHTS = { hours: 40, questions: 35, tests: 25 };
/** With no test in the last 7 days, hours and questions share the full 100. */
const WEIGHTS_NO_TESTS = { hours: 53, questions: 47, tests: 0 };

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00`).getTime() + days * DAY).toLocaleDateString("en-CA");

export interface Inputs {
  sessions: StudySession[];
  coaching: Coaching | undefined;
  questions: Record<string, QuestionDay>;
  tests: Record<string, TestResult>;
  targets: Targets | undefined;
}

export interface DayScore {
  date: string;
  score: number;
  minutes: number;
  targetMinutes: number;
  questions: number;
  /** Of which, from tests logged that day. */
  testQuestions: number;
  targetQuestions: number;
  /** Average test % over the 7 days ending on this date, null if no tests. */
  testAvg: number | null;
  weights: typeof WEIGHTS;
}

/** Indexes everything by date once, then scores any day cheaply. */
export function scorer(input: Inputs) {
  const targets = input.targets ?? DEFAULT_TARGETS;
  const focus = new Map<string, number>();
  for (const s of input.sessions) {
    const d = new Date(s.startedAt).toLocaleDateString("en-CA");
    focus.set(d, (focus.get(d) ?? 0) + s.minutes);
  }
  const testsByDay = new Map<string, TestResult[]>();
  for (const t of Object.values(input.tests)) {
    if (t.deleted || !t.takenOn) continue;
    testsByDay.set(t.takenOn, [...(testsByDay.get(t.takenOn) ?? []), t]);
  }

  return (date: string): DayScore => {
    const coach = coachingMinutes(input.coaching, date);
    const minutes = (focus.get(date) ?? 0) + coach;
    const targetMinutes = (coach > 0 ? targets.hoursCoaching : targets.hoursOff) * 60;
    const q = input.questions[date];
    const testQuestions = (testsByDay.get(date) ?? []).reduce((n, t) => n + (t.correct ?? 0) + (t.wrong ?? 0), 0);
    const questions = (q ? q.physics + q.chemistry + q.maths : 0) + testQuestions;
    const recent: number[] = [];
    for (let i = 0; i < 7; i++) for (const t of testsByDay.get(shift(date, -i)) ?? []) if (pct(t) != null) recent.push(pct(t)!);
    const testAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const weights = testAvg == null ? WEIGHTS_NO_TESTS : WEIGHTS;
    const score =
      weights.hours * Math.min(minutes / targetMinutes, CAP) + weights.questions * Math.min(questions / targets.questions, CAP) + weights.tests * ((testAvg ?? 0) / 100);
    return { date, score: Math.min(100, score), minutes, targetMinutes, questions, testQuestions, targetQuestions: targets.questions, testAvg, weights };
  };
}

// Levels: the game's 26 steps, in three tiers. Steps are wide at the bottom and narrow at the top, so the
// IITs only open up at high scores and each IIT step is a small push (about 2 points: ~25 min or ~4 questions).
// Within a tier, colleges are ordered by their real 2025 cutoff (CSE, or IIIT Allahabad's IT).
const LEVEL_PLAN: [id: string, min: number][] = [
  // IIITs: the floor; every day gets at least the first one.
  ["iiitm-gwalior-cse", 0],
  ["iiitd-cse", 9],
  ["iiitb-btech-cse", 18],
  ["iiita-it", 26],
  ["iiith-cse", 33],
  // Top 10 NITs by CSE cutoff, plus BITS Pilani where its cutoff sits.
  ["nitdelhi-cse", 39],
  ["nitkkr-cse", 44],
  ["vnit-cse", 49],
  ["mnit-cse", 53],
  ["nitc-cse", 57],
  ["mnnit-cse", 61],
  ["nitrkl-cse", 65],
  ["bits-pilani-cse", 68],
  ["nitw-cse", 71],
  ["nitk-cse", 74],
  ["nitt-cse", 77],
  // Top 10 IITs by CSE cutoff: 2 points apart, from 80 up.
  ["iiti-cse", 80],
  ["iitbhu-cse", 82],
  ["iitg-cse", 84],
  ["iith-cse", 86],
  ["iitr-cse", 88],
  ["iitkgp-cse", 90],
  ["iitk-cse", 92],
  ["iitm-cse", 94],
  ["iitd-cse", 96],
  ["iitb-cse", 98],
];

export interface Level {
  /** 1-based. */
  n: number;
  /** Score needed. */
  min: number;
  college: College;
}

export const LEVELS: Level[] = LEVEL_PLAN.flatMap(([id, min]) => {
  const college = LADDER.find((c) => c.id === id);
  return college ? [{ min, college }] : [];
}).map((l, i) => ({ ...l, n: i + 1 }));

/** The level a score reaches. */
export function levelFor(score: number): Level | null {
  return LEVELS.filter((l) => score >= l.min).at(-1) ?? LEVELS[0] ?? null;
}

/** The college a score gets (the same score always gets the same college). */
export function allot(score: number): College | null {
  return levelFor(score)?.college ?? null;
}

/** The next level up, and how much more study time or questions alone would reach it today. */
export function nextUp(day: DayScore) {
  const current = levelFor(day.score);
  const next = current ? LEVELS.find((l) => l.n === current.n + 1) : null;
  if (!next) return null;
  const gap = Math.max(next.min - day.score, 0.1);
  // Points per extra minute / question, while that part is still under its cap.
  const perMinute = day.minutes < day.targetMinutes * CAP ? day.weights.hours / day.targetMinutes : 0;
  const perQuestion = day.questions < day.targetQuestions * CAP ? day.weights.questions / day.targetQuestions : 0;
  const minutes = perMinute ? Math.ceil(gap / perMinute / 5) * 5 : null;
  const questions = perQuestion ? Math.ceil(gap / perQuestion) : null;
  return {
    level: next,
    college: next.college,
    minutes: minutes != null && day.minutes + minutes <= day.targetMinutes * CAP ? minutes : null,
    questions: questions != null && day.questions + questions <= day.targetQuestions * CAP ? questions : null,
  };
}

/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  const d = new Date(`${date}T00:00`);
  return shift(date, -((d.getDay() + 6) % 7));
}

/** Week score: average of the best 6 days (one rest day is free), +1 for every day at 60 or above. */
export function weekScore(days: DayScore[]) {
  if (!days.length) return 0;
  const best = days.map((d) => d.score).sort((a, b) => b - a).slice(0, 6);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  const bonus = days.filter((d) => d.score >= 60).length;
  return Math.min(100, avg + bonus);
}

/** Everything the home screen shows, from the first day with any data up to today. */
export function collegeReport(input: Inputs, firstDay: string | null, today: string) {
  const score = scorer(input);
  const todayScore = score(today);
  const todayCollege = allot(todayScore.score);
  const yesterday = shift(today, -1);
  const yesterdayLevel = levelFor(score(yesterday).score);

  const monday = weekStart(today);
  const thisWeek: DayScore[] = [];
  for (let d = monday; d <= today; d = shift(d, 1)) thisWeek.push(score(d));
  const lastWeek = Array.from({ length: 7 }, (_, i) => score(shift(monday, i - 7)));
  const weekValue = weekScore(thisWeek);
  const lastWeekValue = weekScore(lastWeek);

  // Collection: every college reached on any day so far (capped to a year of history).
  const unlocked = new Set<string>();
  const start = firstDay && firstDay > shift(today, -365) ? firstDay : shift(today, -365);
  for (let d = start; d <= today; d = shift(d, 1)) {
    const s = score(d).score;
    const c = s > 0 ? allot(s) : null;
    if (c) unlocked.add(c.short);
  }

  return {
    today: todayScore,
    college: todayCollege,
    yesterday: yesterdayLevel,
    level: levelFor(todayScore.score),
    next: nextUp(todayScore),
    week: { score: weekValue, college: allot(weekValue), level: levelFor(weekValue), days: thisWeek },
    lastWeek: { score: lastWeekValue, college: allot(lastWeekValue) },
    unlocked,
  };
}

/** How many distinct colleges of each type there are to unlock across the levels. */
export const LEVEL_TOTALS = (["IIT", "NIT", "IIIT", "BITS"] as const).map((type) => ({ type, total: new Set(LEVELS.filter((l) => l.college.type === type).map((l) => l.college.short)).size }));
