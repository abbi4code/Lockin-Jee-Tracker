import { formatRank, rankHeight, type WeekResult } from "@/lib/college";
import type { Column, Series } from "./Charts";
import { fmtDay, hours, tickDay } from "./StudentParts";

// Turns the student insights into chart columns. Ticks are labelled every `every` days (and always today).

export const STUDY_SERIES: Series[] = [
  { name: "self-study", color: "var(--color-fg)" },
  { name: "coaching", color: "var(--color-dim)" },
];

export function studyColumns(days: { date: string; focus: number; coaching: number; total: number }[], today: string, every = 5): Column[] {
  return days.map((d, i) => ({
    key: d.date,
    tick: d.date === today || (days.length - 1 - i) % every === 0 ? tickDay(d.date) : "",
    parts: [d.focus, d.coaching],
    tip: `${fmtDay(d.date)} · ${hours(d.total)}${d.coaching ? ` (${hours(d.focus)} self-study + ${hours(d.coaching)} coaching)` : ""}`,
    current: d.date === today,
  }));
}

export const QUESTION_SERIES: Series[] = [
  { name: "logged", color: "var(--color-fg)" },
  { name: "from tests", color: "var(--color-dim)" },
];

export function questionColumns(days: { date: string; physics: number; chemistry: number; maths: number; fromTests: number; total: number }[], today: string, every = 5): Column[] {
  return days.map((d, i) => ({
    key: d.date,
    tick: d.date === today || (days.length - 1 - i) % every === 0 ? tickDay(d.date) : "",
    parts: [d.physics + d.chemistry + d.maths, d.fromTests],
    tip: `${fmtDay(d.date)} · ${d.total} questions (phy ${d.physics}, chem ${d.chemistry}, maths ${d.maths}${d.fromTests ? `, tests ${d.fromTests}` : ""})`,
    current: d.date === today,
  }));
}

/** One column per finished week (oldest first): taller = better predicted rank (log scale). */
export function weekColumns(weeks: WeekResult[]): Column[] {
  return weeks.map((w) => ({
    key: w.start,
    tick: new Date(`${w.start}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toLowerCase(),
    parts: [w.empty ? 0 : Math.round(rankHeight(w.rank) * 100)],
    tip: w.empty || !w.college ? `week of ${fmtDay(w.start)} · nothing logged` : `week of ${fmtDay(w.start)} · ${w.college.short} ${w.college.branch} · rank ~${formatRank(w.rank)}`,
    current: false,
  }));
}
