import { ALL_CHAPTERS, chapterInScope, findExam, SUBJECTS, topicInScope, type Chapter, type Exam, type SubjectId } from "../data";
import { emptyProgress, today, type ChapterProgress } from "../store/progress";
import { isStudied } from "./stages";

type Chapters = Record<string, ChapterProgress>;
const DAY = 86_400_000;

export const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY);

export function scopedTopics(c: Chapter, exam: Exam) {
  return c.topics.filter((t) => topicInScope(t, exam)).map((t) => t.name);
}

export function chapterFraction(c: Chapter, p: ChapterProgress | undefined, exam: Exam) {
  if (!p) return 0;
  if (isStudied(p.status)) return 1;
  const topics = scopedTopics(c, exam);
  if (!topics.length) return 0;
  return topics.filter((t) => p.topics[t]).length / topics.length;
}

export function subjectStats(subject: SubjectId | "all", chapters: Chapters, exam: Exam) {
  const list = ALL_CHAPTERS.filter((c) => (subject === "all" || c.subject === subject) && chapterInScope(c, exam));
  let topicsTotal = 0;
  let topicsDone = 0;
  let done = 0;
  let doing = 0;
  let weak = 0;
  for (const c of list) {
    const p = chapters[c.id];
    const topics = scopedTopics(c, exam);
    topicsTotal += topics.length;
    const studied = !!p && isStudied(p.status);
    topicsDone += studied ? topics.length : topics.filter((t) => p?.topics[t]).length;
    if (studied) done++;
    else if (p?.status === "working") doing++;
    if (p?.status === "weak") weak++;
  }
  return {
    total: list.length,
    done,
    doing,
    weak,
    todo: list.length - done - doing,
    percent: topicsTotal ? (topicsDone / topicsTotal) * 100 : 0,
  };
}

/** Consecutive active days ending today (or yesterday, if today has no activity yet). */
export function streak(activity: string[]) {
  const set = new Set(activity);
  const d = new Date();
  const activeToday = set.has(today());
  if (!activeToday) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toLocaleDateString("en-CA"))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return { days: n, activeToday, atRisk: !activeToday && n > 0 };
}

/** Last `weeks` weeks of activity, oldest first, for the heat strip. */
export function activityGrid(activity: string[], days = 35) {
  const set = new Set(activity);
  const out: { date: string; active: boolean }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const date = d.toLocaleDateString("en-CA");
    out.push({ date, active: set.has(date) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const mainExam = () => findExam(/Main 2027 Session 1$/);
export const advExam = () => findExam(/Advanced 2027$/);

/** Chapters per week needed to finish before the target exam vs. what's actually happening. */
export function pace(chapters: Chapters, exam: Exam) {
  const target = exam === "main" ? mainExam() : advExam();
  const all = subjectStats("all", chapters, exam);
  const left = all.total - all.done;
  // Leave the last 3 weeks before the exam for revision and mocks.
  const deadline = target ? new Date(new Date(target.start).getTime() - 21 * DAY) : null;
  const weeksLeft = deadline ? Math.max(daysBetween(new Date(), deadline) / 7, 0.1) : null;
  const needed = weeksLeft ? left / weeksLeft : null;
  const twoWeeksAgo = new Date(Date.now() - 14 * DAY).toLocaleDateString("en-CA");
  const recent = Object.values(chapters).filter((p) => isStudied(p.status) && p.doneAt && p.doneAt >= twoWeeksAgo).length;
  const actual = recent / 2;
  return { left, weeksLeft, needed, actual, target, onTrack: needed !== null && actual >= needed };
}

const REVISION_GAPS = [3, 7, 21, 45]; // days after done / after each revision

export function revisionsDue(chapters: Chapters, exam: Exam) {
  const now = today();
  return ALL_CHAPTERS.filter((c) => chapterInScope(c, exam))
    .map((c) => {
      const p = chapters[c.id] ?? emptyProgress();
      if (!isStudied(p.status) || !p.doneAt) return null;
      const last = p.revisions.at(-1) ?? p.doneAt;
      const gap = REVISION_GAPS[Math.min(p.revisions.length, REVISION_GAPS.length - 1)];
      const due = new Date(new Date(last).getTime() + gap * DAY).toLocaleDateString("en-CA");
      return due <= now ? { chapter: c, due, revisions: p.revisions.length } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** Highest-weightage chapters that haven't been started: the "free marks" list. */
export function freeMarks(chapters: Chapters, exam: Exam, limit = 4) {
  return ALL_CHAPTERS.filter((c) => chapterInScope(c, exam) && (chapters[c.id]?.status ?? "undone") === "undone")
    .map((c) => ({ chapter: c, score: (exam === "main" ? c.weight?.main : (c.weight?.main ?? 0) + (c.weight?.adv ?? 0) / 4) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function subjectList() {
  return SUBJECTS;
}

/** What to study right now: the most recently touched in-progress chapter, else the best unstarted one. */
export function currentFocus(chapters: Chapters, exam: Exam) {
  const inProgress = ALL_CHAPTERS.filter((c) => chapterInScope(c, exam) && chapters[c.id]?.status === "working").sort(
    (a, b) => (chapters[b.id]?.updatedAt ?? 0) - (chapters[a.id]?.updatedAt ?? 0),
  );
  const chapter = inProgress[0] ?? freeMarks(chapters, exam, 1)[0]?.chapter;
  if (!chapter) return null;
  const p = chapters[chapter.id];
  const topics = scopedTopics(chapter, exam);
  return { chapter, started: !!inProgress[0], nextTopic: topics.find((t) => !p?.topics[t]) ?? null, topics };
}

/** Minutes studied per day for the last `days` days (oldest first), from focus sessions. */
export function minutesByDay(sessions: { startedAt: string; minutes: number }[], days = 7) {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const day = new Date(s.startedAt).toLocaleDateString("en-CA");
    totals.set(day, (totals.get(day) ?? 0) + s.minutes);
  }
  const out: { date: string; minutes: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const date = d.toLocaleDateString("en-CA");
    out.push({ date, minutes: totals.get(date) ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
