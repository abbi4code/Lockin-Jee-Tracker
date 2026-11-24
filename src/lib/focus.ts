import type { StudySession } from "../store/progress";
import { dayOf, endOf } from "./sessions";

// Questions in focus sessions: how many the student meant to solve (the aim, set before starting) and how many he
// did (asked when the session ends). Solved questions count toward the day's total (lib/college.ts), so the home
// counter is only for questions done outside focus sessions. Pure, so it's tested on its own.

/** Most questions one session can aim for, and say it solved. */
export const MAX_AIM = 200;
export const MAX_SOLVED = 500;
/** Quick picks for the aim before starting. 0 = none. */
export const AIM_PRESETS = [0, 5, 10, 15, 20, 30];
/** A session that ended longer ago than this isn't asked about any more (the log still is). */
export const ASK_WITHIN_MS = 12 * 60 * 60_000;

export const clampAim = (n: number) => Math.min(MAX_AIM, Math.max(0, Math.round(n || 0)));
export const clampSolved = (n: number) => Math.min(MAX_SOLVED, Math.max(0, Math.round(n || 0)));

/**
 * none: no aim and nothing said · pending: aimed, not answered yet · hit / short: answered against the aim ·
 * solved: questions said for a session without an aim.
 */
export type QuestionStatus = "none" | "pending" | "hit" | "short" | "solved";

export function questionStatus(s: Pick<StudySession, "aim" | "solved">): QuestionStatus {
  const aim = s.aim ?? 0;
  if (s.solved == null) return aim > 0 ? "pending" : "none";
  if (aim <= 0) return "solved";
  return s.solved >= aim ? "hit" : "short";
}

/** Minutes per question, or null when nothing was solved. */
export const pace = (minutes: number, solved: number | null | undefined) => (solved && solved > 0 ? minutes / solved : null);

/** "2.5 min a question" / "40 sec a question". */
export function formatPace(minPerQuestion: number) {
  if (minPerQuestion < 1) return `${Math.max(5, Math.round((minPerQuestion * 60) / 5) * 5)} sec a question`;
  const v = minPerQuestion < 10 ? Math.round(minPerQuestion * 10) / 10 : Math.round(minPerQuestion);
  return `${v} min a question`;
}

/** "8/10", "12/10", "8", "?/10" for a log row; null when the session has nothing to show. */
export function questionLabel(s: Pick<StudySession, "aim" | "solved">) {
  const aim = s.aim ?? 0;
  if (s.solved == null) return aim > 0 ? `?/${aim}` : null;
  return aim > 0 ? `${s.solved}/${aim}` : `${s.solved}`;
}

/** Questions solved in focus sessions on `day` (by when each session started, like its minutes). */
export const focusQuestionsOn = (sessions: StudySession[], day: string) => sessions.reduce((n, s) => n + (dayOf(s.startedAt) === day ? (s.solved ?? 0) : 0), 0);

/** Questions solved in focus sessions per day. */
export function focusQuestionsByDay(sessions: StudySession[]) {
  const byDay = new Map<string, number>();
  for (const s of sessions) if (s.solved) byDay.set(dayOf(s.startedAt), (byDay.get(dayOf(s.startedAt)) ?? 0) + s.solved);
  return byDay;
}

/**
 * How a set of focus sessions went with questions: solved in all, how the sessions with an aim went (hit, short, not
 * answered yet), solved against aim over the answered ones, and the pace across sessions that solved any.
 */
function summarize(list: StudySession[]) {
  const statuses = list.map((s) => ({ s, status: questionStatus(s) }));
  const answered = statuses.filter((x) => x.status === "hit" || x.status === "short").map((x) => x.s);
  const solvedMinutes = list.filter((s) => (s.solved ?? 0) > 0).reduce((n, s) => n + s.minutes, 0);
  const solved = list.reduce((n, s) => n + (s.solved ?? 0), 0);
  return {
    solved,
    /** Over the sessions that had an aim and were answered. */
    aimSolved: answered.reduce((n, s) => n + (s.solved ?? 0), 0),
    aim: answered.reduce((n, s) => n + (s.aim ?? 0), 0),
    hit: statuses.filter((x) => x.status === "hit").length,
    short: statuses.filter((x) => x.status === "short").length,
    pending: statuses.filter((x) => x.status === "pending").length,
    /** Minutes per question over the sessions that solved any. */
    pace: solved > 0 ? solvedMinutes / solved : null,
  };
}

/** One day of focus sessions, for the log's summary. */
export const focusDay = (sessions: StudySession[], day: string) => summarize(sessions.filter((s) => dayOf(s.startedAt) === day));

/** Several days of focus sessions (the admin panel's last 30). */
export function focusQuestionStats(sessions: StudySession[], days: string[]) {
  const inRange = new Set(days);
  return summarize(sessions.filter((s) => inRange.has(dayOf(s.startedAt))));
}

/**
 * The session to ask "how many did you solve?" about: the latest timed session with an aim that isn't answered,
 * ended within ASK_WITHIN_MS, and not put off ("later") on this device.
 */
export function sessionToAsk(sessions: StudySession[], now = Date.now(), putOff: ReadonlySet<string> = new Set()) {
  let best: StudySession | null = null;
  for (const s of sessions) {
    if (s.source === "manual" || questionStatus(s) !== "pending" || putOff.has(s.id)) continue;
    const ended = endOf(s).getTime();
    if (now - ended > ASK_WITHIN_MS || ended > now + 60_000) continue;
    if (!best || ended > endOf(best).getTime()) best = s;
  }
  return best;
}

/**
 * The line after answering: "aim hit · 10 of 10 · 2.5 min a question", "2 short · 8 of 10 · …", "6 solved · …",
 * or "no questions solved" for 0 without an aim.
 */
export function resultLine(s: Pick<StudySession, "aim" | "minutes">, solved: number) {
  const aim = s.aim ?? 0;
  const p = pace(s.minutes, solved);
  const speed = p ? ` · ${formatPace(p)}` : "";
  if (aim > 0) return solved >= aim ? `aim hit · ${solved} of ${aim}${speed}` : `${aim - solved} short · ${solved} of ${aim}${speed}`;
  return solved > 0 ? `${solved} solved${speed}` : "no questions solved";
}
