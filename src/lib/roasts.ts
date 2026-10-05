import type { Exam } from "../data";
import type { ChapterProgress } from "../store/progress";
import { freeMarks, pace, streak } from "./stats";

const GENERIC = [
  "JEE doesn't care about your vibes. lock in.",
  "opening the app counts as 1% of the work. the other 99% is the work.",
  "rank isn't manifested. it's grinded.",
  "your future IIT hostel room is waiting. don't leave it on read.",
  "one more chapter. the reels will still be there.",
  "PYQs are literally the cheat code. use them.",
  "consistency > motivation. motivation is a scam.",
  "be the topper you keep comparing yourself to.",
];

/** A short line for the home screen, reacting to what's actually going on. */
export function roastLines(chapters: Record<string, ChapterProgress>, activity: string[], exam: Exam): string[] {
  const lines: string[] = [];
  const s = streak(activity);
  if (s.atRisk) lines.push(`your ${s.days}-day streak is on life support 💀 tick one topic to save it`);
  else if (s.days >= 7) lines.push(`${s.days}-day streak. lowkey built different 🔥`);
  else if (s.activeToday) lines.push("you showed up today. that's already more than most 🫡");

  const p = pace(chapters, exam);
  if (p.needed !== null && p.left > 0) {
    if (p.actual === 0) lines.push(`${p.left} chapters left. current pace: 0. respectfully, that's not a pace 😭`);
    else if (!p.onTrack) lines.push(`you need ${p.needed.toFixed(1)} chapters/week. you're doing ${p.actual.toFixed(1)}. speed up, chief.`);
    else lines.push(`on pace (${p.actual.toFixed(1)}/week). keep cooking 👨‍🍳`);
  }

  const free = freeMarks(chapters, exam, 1)[0];
  if (free?.chapter.weight?.main) {
    lines.push(`${free.chapter.name} is lonely rn. it's worth ~${free.chapter.weight.main.toFixed(1)} Qs every shift 👀`);
  }

  return [...lines, ...GENERIC.sort(() => Math.random() - 0.5).slice(0, 3)];
}
