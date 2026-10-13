import raw from "../data/colleges.json";
import type { QuestionDay, StudySession } from "../store/progress";
import { coachingMinutes, type Coaching } from "./coaching";
import { pct, type TestResult } from "./tests";
import { quizrrScores, type QuizrrAttempt } from "./quizrr";

// The college game, weekly. Each calendar week (Mon–Sun) becomes a predicted JEE Main rank, and the rank becomes
// the best college it would actually get, from a ladder of real 2025 closing ranks (IIT Bombay CSE down to colleges
// that take almost anyone). It's motivation, not a forecast: the rank comes from how he studies (hours, questions,
// test scores) compared with what students at each rank typically put in. Hitting your own goals doesn't move it;
// studying like a stronger candidate does.

export type CollegeType = "IIT" | "NIT" | "IIIT" | "BITS" | "GFTI" | "STATE" | "PRIVATE";

export interface College {
  id: string;
  short: string;
  type: CollegeType;
  branch: string;
  exam: "advanced" | "main" | "bitsat" | "other";
  /** The real cutoff in its own exam's terms (Advanced rank, Main rank, BITSAT score, another exam's rank). */
  closing: number;
  /** Cutoff on the shared JEE Main CRL scale. The ladder is sorted by this, best first. */
  rank: number;
  /** The Main-rank equivalent is an estimate (own-exam colleges, BITS). */
  estimate?: boolean;
}

/** Best first. Built from research/colleges-*.json by scripts/build-data.mjs. */
export const LADDER = raw as unknown as College[];

/** Personal daily goals (set on /me). They drive progress bars and the home headline, not the college. */
export interface Targets {
  hoursCoaching: number;
  hoursOff: number;
  questions: number;
}
export const DEFAULT_TARGETS: Targets = { hoursCoaching: 8, hoursOff: 10, questions: 60 };

// ── The model ────────────────────────────────────────────────────────────────

/** Unique candidates who sat JEE Main 2025 Paper 1 (NTA: 14,75,103). Ranks beyond MAX_RANK aren't modelled. */
export const CANDIDATES = 14_75_103;
const MIN_RANK = 100;
const MAX_RANK = 12_00_000;

/**
 * What students at each rank typically put in, per day over a whole week (rest days included, coaching included):
 * study hours, questions solved, and average % in tests (MathonGo chapter-wise and Quizrr; the % scale roughly
 * matches real JEE Main marks too: 40% of 300 is ~94 percentile, 50% ~98). No official data links study habits
 * to ranks, so these are calibrated judgments from topper interviews and coaching norms: the top hundred study
 * ~12 h and solve ~150 questions a day; a ~6 h, ~40-question routine lands near rank 1 lakh (about 93 percentile).
 * Between anchors, rank moves on a log scale.
 */
export const BENCHMARKS: { rank: number; hours: number; questions: number; tests: number }[] = [
  { rank: 100, hours: 12, questions: 150, tests: 90 },
  { rank: 1_000, hours: 11, questions: 120, tests: 80 },
  { rank: 5_000, hours: 10, questions: 100, tests: 70 },
  { rank: 15_000, hours: 9, questions: 80, tests: 60 },
  { rank: 40_000, hours: 7.5, questions: 60, tests: 50 },
  { rank: 1_00_000, hours: 6, questions: 40, tests: 40 },
  { rank: 2_50_000, hours: 4.5, questions: 25, tests: 30 },
  { rank: 5_00_000, hours: 3, questions: 12, tests: 20 },
  { rank: 8_00_000, hours: 1.5, questions: 5, tests: 10 },
  { rank: MAX_RANK, hours: 0, questions: 0, tests: 0 },
];

/** How much each part counts. With no test in the last 4 weeks, hours and questions carry it; with 1–2 tests, partly. */
const WEIGHTS = { hours: 0.4, questions: 0.3, tests: 0.3 };
const WEIGHTS_NO_TESTS = { hours: 0.55, questions: 0.45, tests: 0 };
/** Tests are occasional, so the test part looks back this far from the week's last counted day. */
const TEST_WINDOW_DAYS = 28;
/** Tests in that window for the test part to count fully (fewer count proportionally less). */
const TESTS_FOR_FULL_WEIGHT = 3;

/** Streak: a day with at least this much study (coaching included). */
export const STREAK_HOURS = 6;
/** Bonus, as a factor on the predicted rank (smaller is better). */
const BONUS = {
  /** Each streak day this week. 7 days: 0.96^7 ≈ 0.75. */
  perDay: 0.96,
  /** All 7 days of a finished week were streak days. */
  fullWeek: 0.95,
  /** Each earlier week in a row with 5+ streak days (up to 4 weeks). */
  perWeek: 0.95,
  maxWeeks: 4,
  weekNeeds: 5,
};

type Metric = "hours" | "questions" | "tests";

/** The rank a value is typical of, for one metric (log-linear between benchmark anchors). */
export function rankFor(metric: Metric, value: number) {
  const b = BENCHMARKS;
  if (value >= b[0][metric]) return b[0].rank;
  if (value <= 0) return MAX_RANK;
  for (let i = 1; i < b.length; i++) {
    const hi = b[i - 1];
    const lo = b[i];
    if (value >= lo[metric]) {
      const t = (value - lo[metric]) / (hi[metric] - lo[metric]);
      return Math.exp(Math.log(lo.rank) + t * (Math.log(hi.rank) - Math.log(lo.rank)));
    }
  }
  return MAX_RANK;
}

/** Inverse of rankFor: the value a rank needs. */
export function valueFor(metric: Metric, rank: number) {
  const b = BENCHMARKS;
  if (rank <= b[0].rank) return b[0][metric];
  for (let i = 1; i < b.length; i++) {
    const hi = b[i - 1];
    const lo = b[i];
    if (rank <= lo.rank) {
      const t = (Math.log(lo.rank) - Math.log(rank)) / (Math.log(lo.rank) - Math.log(hi.rank));
      return lo[metric] + t * (hi[metric] - lo[metric]);
    }
  }
  return 0;
}

export const percentileOf = (rank: number) => Math.max(0, Math.min(100, (1 - rank / CANDIDATES) * 100));

/** The best college a rank gets: the most competitive one whose closing rank is at or beyond it. */
export function collegeFor(rank: number): College | null {
  return LADDER.find((c) => c.rank >= rank) ?? LADDER.at(-1) ?? null;
}

/** Position on the ladder, 1 = top. */
export const ladderPosition = (c: College) => LADDER.findIndex((x) => x.id === c.id) + 1;

// ── Days and weeks ───────────────────────────────────────────────────────────

const DAY = 86_400_000;
export const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00`).getTime() + days * DAY).toLocaleDateString("en-CA");

/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  return shift(date, -((new Date(`${date}T00:00`).getDay() + 6) % 7));
}

export interface Inputs {
  sessions: StudySession[];
  coaching: Coaching | undefined;
  questions: Record<string, QuestionDay>;
  tests: Record<string, TestResult>;
  /** Quizrr scores: count like MathonGo tests (one test, one %; its questions count toward the day). */
  quizrr?: Record<string, QuizrrAttempt>;
}

export interface DayTotals {
  date: string;
  /** Focus sessions + coaching. */
  minutes: number;
  /** Logged with the counter, plus questions attempted in tests that day. */
  questions: number;
  testQuestions: number;
  streak: boolean;
}

export interface Pillar {
  /** Per day (hours, questions) or average % (tests). */
  value: number;
  /** The rank this is typical of. */
  rank: number;
  weight: number;
}

export interface WeekResult {
  start: string;
  /** Mon–Sun; days after `today` are absent. */
  days: DayTotals[];
  /** All seven days are in the past. */
  complete: boolean;
  hours: Pillar;
  questions: Pillar;
  /** Null with no scored test in the 4 weeks before. */
  tests: (Pillar & { count: number }) | null;
  /** Before the streak bonus. */
  baseRank: number;
  streakDays: number;
  /** Earlier weeks in a row with 5+ streak days (bonus counts up to 4). */
  weekStreak: number;
  /** Multiplier on the rank from streaks (1 = none). */
  bonus: number;
  rank: number;
  percentile: number;
  college: College | null;
  /** Nothing logged at all this week. */
  empty: boolean;
}

/** Indexes everything by date once, then reads any day or week cheaply. */
export function tracker(input: Inputs) {
  const focus = new Map<string, number>();
  for (const s of input.sessions) {
    const d = new Date(s.startedAt).toLocaleDateString("en-CA");
    focus.set(d, (focus.get(d) ?? 0) + s.minutes);
  }
  const scored: { date: string; pct: number }[] = [];
  const testQs = new Map<string, number>();
  for (const t of Object.values(input.tests)) {
    if (t.deleted || !t.takenOn) continue;
    testQs.set(t.takenOn, (testQs.get(t.takenOn) ?? 0) + (t.correct ?? 0) + (t.wrong ?? 0));
    const p = pct(t);
    if (p != null) scored.push({ date: t.takenOn, pct: p });
  }
  for (const q of quizrrScores(input.quizrr ?? {})) {
    testQs.set(q.date, (testQs.get(q.date) ?? 0) + q.questions);
    if (q.pct != null) scored.push({ date: q.date, pct: q.pct });
  }

  const day = (date: string): DayTotals => {
    const minutes = (focus.get(date) ?? 0) + coachingMinutes(input.coaching, date);
    const q = input.questions[date];
    const testQuestions = testQs.get(date) ?? 0;
    return { date, minutes, questions: (q ? q.physics + q.chemistry + q.maths : 0) + testQuestions, testQuestions, streak: minutes >= STREAK_HOURS * 60 };
  };

  /** Streak days in the full week starting `monday` (for the week-in-a-row bonus). */
  const streakDaysIn = (monday: string) => Array.from({ length: 7 }, (_, i) => day(shift(monday, i))).filter((d) => d.streak).length;

  /**
   * The week starting `monday`, as of `today`. While a week is running, a day that's still in progress only
   * counts once it lifts the average: a fresh Monday morning doesn't drag the week to zero.
   */
  const week = (monday: string, today: string): WeekResult => {
    const days = Array.from({ length: 7 }, (_, i) => shift(monday, i))
      .filter((d) => d <= today)
      .map(day);
    const complete = shift(monday, 6) < today;
    const past = complete ? days : days.filter((d) => d.date < today);
    const current = complete ? null : days.find((d) => d.date === today) ?? null;
    const avg = (pick: (d: DayTotals) => number) => {
      const base = past.length ? past.reduce((n, d) => n + pick(d), 0) / past.length : 0;
      if (!current) return base;
      const withToday = (past.reduce((n, d) => n + pick(d), 0) + pick(current)) / (past.length + 1);
      return past.length ? Math.max(base, withToday) : withToday;
    };
    const hoursPerDay = avg((d) => d.minutes) / 60;
    const questionsPerDay = avg((d) => d.questions);

    const lastDay = days.at(-1)?.date ?? monday;
    const from = shift(lastDay, -(TEST_WINDOW_DAYS - 1));
    const recent = scored.filter((t) => t.date >= from && t.date <= lastDay);
    const testAvg = recent.length ? recent.reduce((n, t) => n + t.pct, 0) / recent.length : null;
    // One test is weak evidence: the test part grows to its full weight at TESTS_FOR_FULL_WEIGHT tests.
    const trust = Math.min(1, recent.length / TESTS_FOR_FULL_WEIGHT);
    const w = {
      hours: WEIGHTS_NO_TESTS.hours + (WEIGHTS.hours - WEIGHTS_NO_TESTS.hours) * trust,
      questions: WEIGHTS_NO_TESTS.questions + (WEIGHTS.questions - WEIGHTS_NO_TESTS.questions) * trust,
      tests: WEIGHTS.tests * trust,
    };

    const hours: Pillar = { value: hoursPerDay, rank: rankFor("hours", hoursPerDay), weight: w.hours };
    const questions: Pillar = { value: questionsPerDay, rank: rankFor("questions", questionsPerDay), weight: w.questions };
    const tests = testAvg == null ? null : { value: testAvg, rank: rankFor("tests", testAvg), weight: w.tests, count: recent.length };
    // Weighted average on the log scale: each part "votes" for a rank.
    const logRank = [hours, questions, tests].reduce((n, p) => n + (p ? p.weight * Math.log(p.rank) : 0), 0);
    const baseRank = Math.exp(logRank);

    const streakDays = days.filter((d) => d.streak).length;
    let weekStreak = 0;
    for (let k = 1; k <= BONUS.maxWeeks; k++) {
      if (streakDaysIn(shift(monday, -7 * k)) >= BONUS.weekNeeds) weekStreak++;
      else break;
    }
    const bonus = BONUS.perDay ** streakDays * (complete && streakDays === 7 ? BONUS.fullWeek : 1) * BONUS.perWeek ** weekStreak;
    const rank = Math.max(MIN_RANK, Math.min(MAX_RANK, baseRank * bonus));
    const empty = days.every((d) => d.minutes === 0 && d.questions === 0) && testAvg == null;
    return { start: monday, days, complete, hours, questions, tests, baseRank, streakDays, weekStreak, bonus, rank, percentile: percentileOf(rank), college: collegeFor(rank), empty };
  };

  return { day, week };
}

/**
 * What it takes to reach the next college up this week: a higher daily average of hours, or of questions, with
 * everything else unchanged. Null at the top of the ladder.
 */
export function nextUp(w: WeekResult) {
  if (!w.college) return null;
  const i = LADDER.findIndex((c) => c.id === w.college!.id);
  // The next college with a strictly better cutoff.
  const next = LADDER.slice(0, Math.max(i, 0))
    .reverse()
    .find((c) => c.rank < w.college!.rank);
  if (!next) return null;
  // Rank needed before the bonus, then the part's rank that gets the weighted average there.
  const need = (next.rank * 0.999) / w.bonus;
  const solve = (p: Pillar, metric: "hours" | "questions") => {
    const others = Math.log(w.baseRank) - p.weight * Math.log(p.rank);
    const target = Math.exp((Math.log(need) - others) / p.weight);
    if (target < MIN_RANK) return null; // even the top benchmark wouldn't do it alone
    return Math.max(0, valueFor(metric, target) - p.value);
  };
  const hours = solve(w.hours, "hours");
  const questions = solve(w.questions, "questions");
  return {
    college: next,
    /** Extra minutes a day on the weekly average (rounded up to 5). */
    minutes: hours != null && hours * 60 <= 8 * 60 ? Math.max(5, Math.ceil((hours * 60) / 5) * 5) : null,
    questions: questions != null && questions <= 150 ? Math.max(1, Math.ceil(questions)) : null,
  };
}

/** Everything the home screen shows: this week so far, last week's final, recent weeks, and the collection. */
export function collegeReport(input: Inputs, today: string, firstDay: string | null, weeks = 8) {
  const t = tracker(input);
  const monday = weekStart(today);
  const thisWeek = t.week(monday, today);
  const lastWeek = t.week(shift(monday, -7), today);
  // Finished weeks since the first day with data (at most `weeks`), newest first.
  const history: WeekResult[] = [];
  for (let k = 1; k <= weeks; k++) {
    const start = shift(monday, -7 * k);
    if (firstDay && shift(start, 6) < firstDay) break;
    history.push(k === 1 ? lastWeek : t.week(start, today));
  }
  // Collection: every college a finished week reached (a year at most).
  const unlocked = new Set<string>();
  for (let k = 1; k <= 52; k++) {
    const start = shift(monday, -7 * k);
    if (!firstDay || shift(start, 6) < firstDay) break;
    const w = k <= history.length ? history[k - 1] : t.week(start, today);
    if (!w.empty && w.college) unlocked.add(w.college.id);
  }
  return { week: thisWeek, lastWeek, history, unlocked, next: nextUp(thisWeek), today: t.day(today) };
}

/** How many distinct colleges of each type the ladder has. */
export const LADDER_TOTALS = (["IIT", "NIT", "IIIT", "BITS", "GFTI", "STATE", "PRIVATE"] as const)
  .map((type) => ({ type, total: LADDER.filter((c) => c.type === type).length }))
  .filter((t) => t.total > 0);

/** "1,02,000" style, rounded to a sensible precision. */
export function formatRank(rank: number) {
  const r = rank < 1000 ? Math.round(rank / 10) * 10 : rank < 10_000 ? Math.round(rank / 100) * 100 : Math.round(rank / 1000) * 1000;
  return Math.max(r, 1).toLocaleString("en-IN");
}

/** Where a rank sits between the top of the model (1) and the bottom (0), on the log scale it uses. For bars. */
export const heightToRank = (h: number) => MAX_RANK * (MIN_RANK / MAX_RANK) ** Math.max(0, Math.min(1, h));
export const rankHeight = (rank: number) => Math.max(0, Math.min(1, Math.log(MAX_RANK / rank) / Math.log(MAX_RANK / MIN_RANK)));

export const TYPE_LABEL: Record<CollegeType, string> = { IIT: "IIT", NIT: "NIT", IIIT: "IIIT", BITS: "BITS", GFTI: "govt-funded", STATE: "state govt", PRIVATE: "private" };

/** "adv cutoff 66" / "main cutoff 1,449" / "own exam · ≈ main 63,500" (estimates say so). */
export function cutoffText(c: College) {
  if (c.exam === "advanced") return `adv cutoff ${c.closing.toLocaleString("en-IN")}`;
  if (c.exam === "main") return `main cutoff ${c.closing.toLocaleString("en-IN")}`;
  if (c.exam === "bitsat") return `bitsat ${c.closing} · ≈ main ${formatRank(c.rank)}`;
  return `own exam · ≈ main ${formatRank(c.rank)}`;
}
