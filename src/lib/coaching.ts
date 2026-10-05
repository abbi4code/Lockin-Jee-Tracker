// Coaching (VMC) hours count as study time. A plan says which weekdays and how many hours;
// changing the plan starts a new one from today, so past weeks keep the hours they had.

export interface CoachingPlan {
  /** First day this plan applies (YYYY-MM-DD). */
  from: string;
  /** Weekdays, 0 = Sunday … 6 = Saturday. */
  days: number[];
  hours: number;
}

export interface Coaching {
  plans: CoachingPlan[];
  /** Per-day exceptions: false = skipped a scheduled day, true = went on an unscheduled one. */
  overrides: Record<string, boolean>;
}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const HOUR_OPTIONS = [2, 3, 4, 5, 6];
export const DEFAULT_HOURS = 4;

const weekday = (date: string) => new Date(`${date}T00:00`).getDay();

/** The plan in force on a date (null before coaching was ever set up). */
export function planOn(c: Coaching | undefined, date: string) {
  return c?.plans.filter((p) => p.from <= date).at(-1) ?? null;
}

/** The latest plan, for editing on /me. */
export const currentPlan = (c: Coaching | undefined) => c?.plans.at(-1) ?? null;

export function isScheduled(c: Coaching | undefined, date: string) {
  return !!planOn(c, date)?.days.includes(weekday(date));
}

/** Coaching minutes on a date: the plan's hours if he went (scheduled and not skipped, or marked as went). */
export function coachingMinutes(c: Coaching | undefined, date: string) {
  const plan = planOn(c, date);
  if (!plan) return 0;
  const went = c!.overrides[date] ?? plan.days.includes(weekday(date));
  return went ? plan.hours * 60 : 0;
}

/** Returns coaching settings with a new plan starting today (replacing one already started today). */
export function withPlan(c: Coaching | undefined, patch: Partial<Omit<CoachingPlan, "from">>): Coaching {
  const day = today();
  const prev = currentPlan(c);
  const next: CoachingPlan = { from: day, days: prev?.days ?? [], hours: prev?.hours ?? DEFAULT_HOURS, ...patch };
  const plans = (c?.plans ?? []).filter((p) => p.from < day);
  return { plans: [...plans, next], overrides: c?.overrides ?? {} };
}

/** Flips whether he went to coaching on a date. An override that matches the schedule is dropped. */
export function toggleDay(c: Coaching, date: string): Coaching {
  const went = coachingMinutes(c, date) > 0;
  const overrides = { ...c.overrides };
  if (!went === isScheduled(c, date)) delete overrides[date];
  else overrides[date] = !went;
  return { ...c, overrides };
}

/** Study minutes per day for the last `days` days (oldest first): focus sessions plus coaching. */
export function studyByDay(sessions: { startedAt: string; minutes: number }[], coaching: Coaching | undefined, days = 7) {
  const focus = new Map<string, number>();
  for (const s of sessions) {
    const day = new Date(s.startedAt).toLocaleDateString("en-CA");
    focus.set(day, (focus.get(day) ?? 0) + s.minutes);
  }
  const out: { date: string; focus: number; coaching: number; total: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const date = d.toLocaleDateString("en-CA");
    const f = focus.get(date) ?? 0;
    const c = coachingMinutes(coaching, date);
    out.push({ date, focus: f, coaching: c, total: f + c });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
