import { addDays } from "./plan";

// One-off announcements on the home page (the rules scroll). The first view is stored per account (settings.seen,
// synced), so the countdown is the same on every device; whether this device has shown it fully is local.

export type ScrollMode =
  /** Never seen anywhere: open it, and start the countdown. */
  | "first"
  /** Seen on another device, not this one: open it once here. */
  | "reopen"
  /** Seen here: rolled up, tap to read again. */
  | "rolled"
  /** The countdown is over. */
  | "gone";

export function scrollMode(firstSeen: string | undefined, today: string, openedHere: boolean, days: number): ScrollMode {
  if (!firstSeen) return "first";
  if (today >= addDays(firstSeen, days)) return "gone";
  return openedHere ? "rolled" : "reopen";
}

/** The last day it shows (YYYY-MM-DD). */
export const lastDay = (firstSeen: string, days: number) => addDays(firstSeen, days - 1);
