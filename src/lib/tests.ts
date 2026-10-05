import { TRACKS, type Track } from "../data";

/** One MathonGo test taken (or imported from the old Excel, where scores weren't recorded). */
export interface TestResult {
  id: string;
  trackId: string;
  kind: "chapterwise" | "pyq";
  testNo: number;
  takenOn: string | null; // YYYY-MM-DD
  score: number | null;
  maxScore: number | null;
  correct: number | null;
  wrong: number | null;
  unattempted: number | null;
  timeMin: number | null;
  imported: boolean;
  deleted: boolean;
  updatedAt: number;
}

export const pct = (r: Pick<TestResult, "score" | "maxScore">) => (r.score != null && r.maxScore ? (r.score / r.maxScore) * 100 : null);

export function liveResults(tests: Record<string, TestResult>) {
  return Object.values(tests).filter((t) => !t.deleted);
}

/** Progress on one MathonGo chapter: tests done out of the series total, and the average score. */
export function trackProgress(track: Track, tests: Record<string, TestResult>) {
  const results = liveResults(tests)
    .filter((t) => t.trackId === track.id)
    .sort((a, b) => a.testNo - b.testNo);
  const chapterwise = results.filter((t) => t.kind === "chapterwise");
  const pyq = results.filter((t) => t.kind === "pyq");
  const scored = results.map(pct).filter((x): x is number => x != null);
  return {
    track,
    chapterwise,
    pyq,
    done: new Set(chapterwise.map((t) => t.testNo)).size,
    total: track.tests,
    left: Math.max(track.tests - new Set(chapterwise.map((t) => t.testNo)).size, 0),
    avg: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
    last: [...results].filter((t) => pct(t) != null).sort((a, b) => (b.takenOn ?? "").localeCompare(a.takenOn ?? ""))[0] ?? null,
  };
}

export function seriesSummary(tests: Record<string, TestResult>, subject?: string) {
  const list = TRACKS.filter((t) => !subject || t.subject === subject).map((t) => trackProgress(t, tests));
  const scored = liveResults(tests)
    .filter((t) => !subject || TRACKS.find((x) => x.id === t.trackId)?.subject === subject)
    .map(pct)
    .filter((x): x is number => x != null);
  return {
    done: list.reduce((n, p) => n + p.done, 0),
    total: list.reduce((n, p) => n + p.total, 0),
    avg: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
    lowest: list.filter((p) => p.avg != null).sort((a, b) => a.avg! - b.avg!),
    tracks: list,
  };
}

/** Score colour: red below 40%, muted 40–70%, full ink above 70%. */
export const scoreTone = (p: number | null) => (p == null ? "var(--color-mute)" : p < 40 ? "var(--color-red)" : p < 70 ? "var(--color-mute)" : "var(--color-fg)");

export function toTestRow(t: TestResult, userId: string) {
  return {
    id: t.id,
    user_id: userId,
    track_id: t.trackId,
    kind: t.kind,
    test_no: t.testNo,
    taken_on: t.takenOn,
    score: t.score,
    max_score: t.maxScore,
    correct: t.correct,
    wrong: t.wrong,
    unattempted: t.unattempted,
    time_min: t.timeMin,
    imported: t.imported,
    deleted: t.deleted,
    updated_at: new Date(t.updatedAt).toISOString(),
  };
}

/** PostgREST row → app shape (numeric columns arrive as strings). */
export function fromTestRow(r: Record<string, unknown>): TestResult {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: r.id as string,
    trackId: r.track_id as string,
    kind: r.kind as TestResult["kind"],
    testNo: Number(r.test_no),
    takenOn: (r.taken_on as string | null) ?? null,
    score: num(r.score),
    maxScore: num(r.max_score),
    correct: num(r.correct),
    wrong: num(r.wrong),
    unattempted: num(r.unattempted),
    timeMin: num(r.time_min),
    imported: !!r.imported,
    deleted: !!r.deleted,
    updatedAt: new Date(r.updated_at as string).getTime(),
  };
}
