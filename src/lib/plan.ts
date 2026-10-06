import { getChapter } from "../data";
import { coachingMinutes, type Coaching } from "./coaching";

// The planner: chapters scheduled on days (revisions mostly). Items sync per row like test results
// (public.plan_items), soft-deleted so removals reach every device.

export type PlanKind = "revision" | "study" | "test";

export interface PlanItem {
  id: string;
  chapterId: string;
  date: string; // YYYY-MM-DD
  kind: PlanKind;
  doneAt: string | null; // ISO
  deleted: boolean;
  updatedAt: number;
}

export const KIND_LABEL: Record<PlanKind, string> = { revision: "revise", study: "study", test: "test" };

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00`).getTime() + n * DAY).toLocaleDateString("en-CA");
const weekday = (date: string) => new Date(`${date}T00:00`).getDay();

/** One-tap dates for scheduling, relative to `today`. "weekend" is the coming Saturday (today if it's the weekend). */
export function quickDates(today: string) {
  const wd = weekday(today);
  const saturday = wd === 6 || wd === 0 ? today : addDays(today, 6 - wd);
  const nextMonday = addDays(today, ((8 - wd) % 7) || 7);
  return [
    { label: "today", date: today },
    { label: "tomorrow", date: addDays(today, 1) },
    { label: "in 3 days", date: addDays(today, 3) },
    { label: "weekend", date: saturday },
    { label: "next week", date: nextMonday },
  ];
}

/** "today", "tomorrow", "yesterday", else "mon 12 oct". */
export function dayLabel(date: string, today: string) {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date === addDays(today, -1)) return "yesterday";
  return new Date(`${date}T00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).toLowerCase();
}

export const live = (items: Record<string, PlanItem>) => Object.values(items).filter((i) => !i.deleted);

/** Not done and scheduled before today. */
export const overdue = (items: Record<string, PlanItem>, today: string) =>
  live(items)
    .filter((i) => !i.doneAt && i.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));

export const onDay = (items: Record<string, PlanItem>, date: string) => live(items).filter((i) => i.date === date);

/** Today's undone items plus everything overdue: what the badge and the reminders count. */
export const pending = (items: Record<string, PlanItem>, today: string) => live(items).filter((i) => !i.doneAt && i.date <= today);

/** Upcoming scheduled dates for one chapter (not done). */
export const scheduledFor = (items: Record<string, PlanItem>, chapterId: string) =>
  live(items)
    .filter((i) => i.chapterId === chapterId && !i.doneAt)
    .sort((a, b) => a.date.localeCompare(b.date));

/**
 * "Plan my week": spreads chapters across the next 7 days (starting today), most urgent first, at most `perDay`
 * a day and one fewer on coaching days. Days that already have items count toward the cap; chapters already
 * scheduled this week are skipped. Returns the new { chapterId, date } pairs.
 */
export function autoPlan(chapterIds: string[], items: Record<string, PlanItem>, today: string, coaching: Coaching | undefined, perDay = 2) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const weekEnd = days[6];
  const already = new Set(live(items).filter((i) => !i.doneAt && i.date >= today && i.date <= weekEnd).map((i) => i.chapterId));
  const load = new Map(days.map((d) => [d, onDay(items, d).filter((i) => !i.doneAt).length]));
  const cap = (d: string) => Math.max(1, perDay - (coachingMinutes(coaching, d) > 0 ? 1 : 0));
  const out: { chapterId: string; date: string }[] = [];
  for (const id of chapterIds) {
    if (already.has(id) || !getChapter(id)) continue;
    const day = days.find((d) => load.get(d)! < cap(d));
    if (!day) break;
    load.set(day, load.get(day)! + 1);
    already.add(id);
    out.push({ chapterId: id, date: day });
  }
  return out;
}

// ── Sync rows (public.plan_items) ──
export interface PlanRow {
  id: string;
  user_id?: string;
  chapter_id: string;
  date: string;
  kind: PlanKind;
  done_at: string | null;
  deleted: boolean;
  updated_at: string;
}

export const fromPlanRow = (r: PlanRow): PlanItem => ({
  id: r.id,
  chapterId: r.chapter_id,
  date: r.date,
  kind: r.kind,
  doneAt: r.done_at,
  deleted: r.deleted,
  updatedAt: new Date(r.updated_at).getTime(),
});

export const toPlanRow = (i: PlanItem, userId: string): PlanRow => ({
  id: i.id,
  user_id: userId,
  chapter_id: i.chapterId,
  date: i.date,
  kind: i.kind,
  done_at: i.doneAt,
  deleted: i.deleted,
  updated_at: new Date(i.updatedAt).toISOString(),
});
