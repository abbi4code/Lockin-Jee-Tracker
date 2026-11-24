// The break timer on the focus page: a countdown between study sessions that rings when it's over, then
// counts how long the break has run over. It lives on this device only (like the study timer) and survives
// a reload; starting the study timer ends it.

export interface BreakTimer {
  startedAt: number;
  /** When the break is over (ms). */
  endsAt: number;
  /** Length in minutes, extensions included. */
  minutes: number;
  /** The end has been handled (rung, or found too late to ring), so it never rings twice. */
  rung: boolean;
}

export const BREAK_LENGTHS = [5, 10, 15, 20] as const;
/** Rings only if the break ended this recently. Opening the app later just shows it as over. */
export const RING_WINDOW_MS = 2 * 60_000;
/** A break over by more than this is forgotten. */
export const STALE_MS = 60 * 60_000;
export const MAX_BREAK_MIN = 60;

export const newBreak = (minutes: number, now: number): BreakTimer => {
  const m = Math.min(Math.max(1, Math.round(minutes)), MAX_BREAK_MIN);
  return { startedAt: now, endsAt: now + m * 60_000, minutes: m, rung: false };
};

/** More time: added to what's left, or counted from now once the break is already over. */
export function extendBreak(b: BreakTimer, minutes: number, now: number): BreakTimer {
  const from = Math.max(b.endsAt, now);
  return { ...b, endsAt: from + minutes * 60_000, minutes: Math.round((from + minutes * 60_000 - b.startedAt) / 60_000), rung: false };
}

export type BreakPhase = "on" | "over" | "stale";
export const breakPhase = (b: BreakTimer, now: number): BreakPhase => (now < b.endsAt ? "on" : now - b.endsAt > STALE_MS ? "stale" : "over");

/** The end needs handling: ring if it's only just happened, otherwise mark it handled quietly. */
export const endDue = (b: BreakTimer, now: number) => !b.rung && now >= b.endsAt;
export const ringNow = (b: BreakTimer, now: number) => endDue(b, now) && now - b.endsAt <= RING_WINDOW_MS;

/** 5 min after a short session, 10 after 50+, 15 after 90+ or after every 4th pomodoro of the day. */
export function suggestedBreak(minutes: number, pomodorosToday: number) {
  if (pomodorosToday > 0 && pomodorosToday % 4 === 0) return 15;
  return minutes >= 90 ? 15 : minutes >= 50 ? 10 : 5;
}
