import type { CollegeDay } from "@/lib/admin-student";
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

export function levelColumns(history: CollegeDay[], today: string, every = 5): Column[] {
  return history.map((d, i) => ({
    key: d.date,
    tick: d.date === today || (history.length - 1 - i) % every === 0 ? tickDay(d.date) : "",
    parts: [d.score > 0 ? d.level : 0],
    tip: d.score > 0 && d.college ? `${fmtDay(d.date)} · level ${d.level} · ${d.college.short} ${d.college.branch} · score ${Math.round(d.score)}` : `${fmtDay(d.date)} · nothing logged`,
    current: d.date === today,
  }));
}
