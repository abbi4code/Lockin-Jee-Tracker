import { getTrack } from "../data";
import { addDays } from "./plan";
import { getQuizrrTest, testHref, testName, type QuizrrAttempt } from "./quizrr";
import type { TestResult } from "./tests";

// Test analysis: after a test, going through every question lost and asking why. A yes/no box is easy to tick
// without doing it, so marking a test analysed means sorting the lost questions (wrong + skipped) into four
// reasons, plus one line on what to do differently. Stored on the result itself (analysis jsonb on
// test_results and quizrr_attempts); null = not analysed yet.

export const REASONS = [
  { id: "silly", label: "silly", hint: "knew it, slipped: calculation, sign, misread" },
  { id: "concept", label: "concept", hint: "studied it, but the idea wasn't clear" },
  { id: "unstudied", label: "not studied", hint: "haven't done that chapter yet" },
  { id: "time", label: "time", hint: "ran out, rushed, or left it to save time" },
] as const;

export type Reason = (typeof REASONS)[number]["id"];

export interface Analysis {
  /** Day it was done (YYYY-MM-DD). */
  on: string;
  silly: number;
  concept: number;
  unstudied: number;
  time: number;
  /** What to do differently next time. */
  note: string;
}

/** A test is nagged about for this many days after it was taken; older ones are left alone. */
export const ANALYSIS_DAYS = 14;
const MAX_COUNT = 500;
const MAX_NOTE = 500;

type Scored = { score: number | null; takenOn: string | null; analysis?: Analysis | null; wrong: number | null; unattempted: number | null };

export const emptyAnalysis = (on: string): Analysis => ({ on, silly: 0, concept: 0, unstudied: 0, time: 0, note: "" });

/** Questions lost (wrong + skipped), or null when neither was logged. */
export const lostOf = (r: Pick<Scored, "wrong" | "unattempted">) => (r.wrong == null && r.unattempted == null ? null : (r.wrong ?? 0) + (r.unattempted ?? 0));

/** Questions sorted into a reason. */
export const sortedOf = (a: Analysis) => REASONS.reduce((n, r) => n + a[r.id], 0);

/** Why this analysis can't be saved, or null. `lost` = wrong + skipped when known. */
export function analysisError(a: Analysis, lost: number | null) {
  if (REASONS.some((r) => !Number.isInteger(a[r.id]) || a[r.id] < 0)) return "counts are whole numbers from 0.";
  const n = sortedOf(a);
  if (lost != null && n > lost) return `that's ${n} sorted, but you lost ${lost} (wrong + skipped).`;
  if (a.note.length > MAX_NOTE) return `keep the note under ${MAX_NOTE} characters.`;
  return null;
}

/** The reason that cost the most questions, if any did. */
export function biggestReason(a: Pick<Analysis, Reason>) {
  const top = [...REASONS].sort((x, y) => a[y.id] - a[x.id])[0];
  return a[top.id] > 0 ? top : null;
}

/** Scored, logged by hand, taken in the last ANALYSIS_DAYS days and not analysed. */
export function needsAnalysis(r: Pick<Scored, "score" | "takenOn" | "analysis"> & { imported?: boolean; deleted?: boolean }, today: string) {
  return !r.deleted && !r.imported && r.score != null && !r.analysis && !!r.takenOn && r.takenOn <= today && r.takenOn > addDays(today, -ANALYSIS_DAYS);
}

export interface PendingAnalysis {
  key: string;
  name: string;
  href: string;
  takenOn: string;
  lost: number | null;
}

/** Tests waiting for their analysis, oldest first: Today lists these. */
export function pendingAnalyses(tests: Record<string, TestResult>, quizrr: Record<string, QuizrrAttempt>, today: string): PendingAnalysis[] {
  const out: PendingAnalysis[] = [];
  for (const a of Object.values(quizrr)) {
    const test = getQuizrrTest(a.testId);
    if (!test || !needsAnalysis(a, today)) continue;
    out.push({ key: `quizrr:${a.id}`, name: `quizrr · ${testName(test)}`, href: `${testHref(test)}#analysis`, takenOn: a.takenOn!, lost: lostOf(a) });
  }
  for (const t of Object.values(tests)) {
    const track = getTrack(t.trackId);
    if (!track || !needsAnalysis(t, today)) continue;
    out.push({
      key: `test:${t.id}`,
      name: `${track.name} · ${t.kind === "pyq" ? "pyq" : "test"} ${t.testNo}`,
      href: `/c/${track.chapterIds[0]}#test-${t.id}`,
      takenOn: t.takenOn!,
      lost: lostOf(t),
    });
  }
  return out.sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.name.localeCompare(b.name));
}

/** Questions lost per reason over every analysed test: where the marks go. */
export function mistakeTotals(results: { analysis?: Analysis | null; deleted?: boolean }[]) {
  const done = results.filter((r) => !r.deleted && r.analysis);
  const totals = Object.fromEntries(REASONS.map((r) => [r.id, done.reduce((n, x) => n + x.analysis![r.id], 0)])) as Record<Reason, number>;
  return { tests: done.length, totals, sum: REASONS.reduce((n, r) => n + totals[r.id], 0) };
}

/** Database value → Analysis (it comes from jsonb, so check every field). */
export function parseAnalysis(x: unknown): Analysis | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.on)) return null;
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_COUNT) : 0);
  return {
    on: o.on,
    silly: count(o.silly),
    concept: count(o.concept),
    unstudied: count(o.unstudied),
    time: count(o.time),
    note: typeof o.note === "string" ? o.note.slice(0, MAX_NOTE) : "",
  };
}
