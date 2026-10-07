import LINES from "../data/headlines.json";

// The home-screen headline: one line that reacts to how the day is going and to what just happened.
// Lines live in src/data/headlines.json, one pool per mood; {name} {hours} {questions} {streak} {college} {score}
// are filled in, and a line whose placeholder has no value right now is skipped.

export type Mood = keyof typeof LINES;

export interface HeadlineContext {
  /** Local hour, 0–23. */
  hour: number;
  minutes: number;
  targetMinutes: number;
  questions: number;
  targetQuestions: number;
  /** Today's college-game score, 0–100. */
  score: number;
  college: string | null;
  streak: { days: number; activeToday: boolean; atRisk: boolean };
  missedYesterday: boolean;
  coachingToday: boolean;
  name: string;
  hours: string;
}

/** Something that just happened; it picks the mood instead of the day's state. */
export type HeadlineEvent = { kind: "pomodoro" } | { kind: "questions" } | { kind: "test"; pct: number | null } | { kind: "levelUp" };

/** Which pool to draw from. Events win; otherwise the day's state, with a little variety mixed in. */
export function moodFor(ctx: HeadlineContext, event?: HeadlineEvent, roll = Math.random()): Mood {
  if (event?.kind === "pomodoro") return "pomodoro_done";
  if (event?.kind === "questions") return "questions_logged";
  if (event?.kind === "levelUp") return "level_up";
  if (event?.kind === "test") return event.pct == null ? "questions_logged" : event.pct >= 70 ? "test_good" : event.pct >= 40 ? "test_mid" : "test_bad";

  const progress = Math.min(ctx.minutes / ctx.targetMinutes, 1) * 0.5 + Math.min(ctx.questions / ctx.targetQuestions, 1) * 0.5;
  const nothing = ctx.minutes === 0 && ctx.questions === 0 && !ctx.streak.activeToday;

  if (ctx.hour >= 23 && !nothing) return "late_night";
  if (nothing) {
    if (ctx.streak.atRisk && ctx.hour >= 17) return "streak_risk";
    if (ctx.hour < 12) return ctx.coachingToday && roll < 0.4 ? "coaching_day" : "fresh_morning";
    return ctx.hour < 18 ? "nothing_afternoon" : "nothing_night";
  }
  if (ctx.score >= 85) return "beast_mode";
  if (progress >= 1 || ctx.score >= 70) return "target_hit";
  if (ctx.missedYesterday && roll < 0.6) return "comeback";
  if (ctx.streak.days >= 7 && roll < 0.3) return "streak_flex";
  if (ctx.coachingToday && progress < 0.8 && roll < 0.5) return "coaching_day";
  if (roll > 0.85) return "generic";
  return progress < 0.4 ? "warming_up" : "halfway";
}

const SEEN_KEY = "lockin-headlines-seen";
const readSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const remember = (line: string) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([line, ...readSeen().filter((l) => l !== line)].slice(0, 80)));
  } catch {
    // Private mode: repeats are just a bit more likely.
  }
};

/** A line for `mood` with the placeholders filled, avoiding the last ~80 shown. */
export function pickLine(mood: Mood, ctx: HeadlineContext, extra: { score?: number | null } = {}): string {
  // A zero count counts as "no value": "0 questions solved, ace incoming" reads wrong, so those lines are skipped.
  const values: Record<string, string | null> = {
    name: ctx.name || null,
    hours: ctx.minutes > 0 ? ctx.hours : null,
    questions: ctx.questions > 0 ? String(ctx.questions) : null,
    streak: ctx.streak.days > 0 ? String(ctx.streak.days) : null,
    college: ctx.college,
    score: extra.score != null ? String(Math.round(extra.score)) : null,
  };
  const usable = (LINES[mood] as string[]).filter((l) => [...l.matchAll(/\{(\w+)\}/g)].every(([, k]) => values[k] != null));
  const pool = usable.length ? usable : (LINES.generic as string[]).filter((l) => !l.includes("{"));
  const seen = new Set(readSeen());
  const fresh = pool.filter((l) => !seen.has(l));
  const line = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh : pool).length)];
  remember(line);
  return line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}
