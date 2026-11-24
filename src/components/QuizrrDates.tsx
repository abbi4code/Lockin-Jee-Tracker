"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isScheduled } from "../lib/coaching";
import { dayLabel, quickDates } from "../lib/plan";
import {
  assignedDate,
  attemptFor,
  dateProblem,
  dueQuizrr,
  fmtRelease,
  opensLater,
  quizrrOnDay,
  releaseDay,
  replan,
  testName,
  testState,
  untakenInOrder,
  type QuizrrTest,
} from "../lib/quizrr";
import { today, useProgress } from "../store/progress";
import { buzz, Check, Segmented } from "./Controls";
import { Section } from "./ui";

// Picking Quizrr dates: one test from its page, or everything left in one go from /quizrr.

const dateInput = "border-b border-line-2 bg-transparent py-1.5 font-mono text-[16px] outline-none transition-colors focus:border-fg";

/** Who a date came from, in his words. */
function useSetBy(testId: string) {
  const by = useProgress((s) => s.quizrrDateBy[testId]);
  const has = useProgress((s) => testId in s.quizrrDates);
  return !has ? "suggested" : by === "student" ? "picked by you" : "set by your bro";
}

/** Inline: quick days, any day, or no date. Refuses past days and days before the test is out. */
function DatePicker({ test, onClose }: { test: QuizrrTest; onClose: () => void }) {
  const { quizrr, quizrrDates, pickQuizrrDates } = useProgress();
  const t = today();
  const current = assignedDate(test, quizrrDates);
  const release = releaseDay(test);
  const min = release && release > t ? release : t;
  const [date, setDate] = useState(current && current >= min ? current : min);
  const problem = dateProblem(test, date, t);
  const quick = quickDates(t).filter((q) => !dateProblem(test, q.date, t));
  // Another test he hasn't taken on the same day: allowed, but worth saying.
  const clash = problem ? [] : quizrrOnDay(quizrrDates, date).filter((x) => x.id !== test.id && !attemptFor(x.id, quizrr));

  const save = (d: string | null) => {
    buzz(12);
    pickQuizrrDates([{ testId: test.id, date: d }]);
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mt-4 max-w-xl rounded-lg border border-line-2 p-4">
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              onClick={() => setDate(q.date)}
              className={`rounded-full border px-3 py-1.5 font-mono text-[12.5px] transition ${date === q.date ? "border-fg text-fg" : "border-line-2 text-mute hover:text-fg"}`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[11px] tracking-wider text-mute uppercase">or a day</span>
          <input type="date" value={date} min={min} onChange={(e) => setDate(e.target.value)} className={dateInput} aria-label={`date for ${testName(test)}`} />
        </label>
        <p className={`mt-3 font-mono text-[12px] ${problem ? "text-red" : "text-mute"}`}>
          {problem ?? `${testName(test).toLowerCase()} on ${dayLabel(date, t)}${release && release > t ? ` · opens ${fmtRelease(test.opensAt!)}` : ""}`}
        </p>
        {clash.length > 0 && <p className="mt-1 font-mono text-[12px] text-dim">{clash.map(testName).join(" and ")} {clash.length === 1 ? "is" : "are"} on that day too. two full tests in a day is a lot.</p>}
        <div className="mt-4 flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => save(date)} disabled={!!problem || date === current} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
            save date
          </motion.button>
          <button onClick={onClose} className="rounded-full px-3 py-2 text-[14px] text-mute hover:text-fg">
            cancel
          </button>
          {current && (
            <button onClick={() => save(null)} className="ml-auto rounded-full px-3 py-2 font-mono text-[12px] text-mute hover:text-fg">
              no date
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** The test's day under its name, with "change" to pick another. A test that's done keeps its old day, no picker. */
export function TestDate({ test }: { test: QuizrrTest }) {
  const { quizrr, quizrrDates } = useProgress();
  const t = today();
  const attempt = attemptFor(test.id, quizrr);
  const date = assignedDate(test, quizrrDates);
  const state = testState(test, attempt, date, t);
  const later = opensLater(test);
  const setBy = useSetBy(test.id);
  const [picking, setPicking] = useState(false);
  const urgent = state === "today" || state === "overdue";
  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className={`font-mono text-[13px] ${urgent ? "text-red" : "text-mute"}`}>
          {date ? (state === "done" ? `set for ${dayLabel(date, t)}` : state === "overdue" ? `was due ${dayLabel(date, t)}` : `take it ${dayLabel(date, t)}`) : "no date yet"}
          {later && ` · opens ${fmtRelease(test.opensAt!)} ist`}
          {state !== "done" && date && <span className="text-dim"> · {setBy}</span>}
        </p>
        {state !== "done" && (
          <button
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            className="flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-1 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg"
          >
            <CalendarDays className="size-3.5" /> {date ? (state === "overdue" ? "pick a new day" : "change") : "pick a day"}
          </button>
        )}
      </div>
      <AnimatePresence>{picking && <DatePicker test={test} onClose={() => setPicking(false)} />}</AnimatePresence>
    </div>
  );
}

/** Lists of the day show a couple of missed tests; this line stands for the rest and leads to re-planning them. */
export function MoreMissed({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link href="/quizrr#replan" className="group flex items-center gap-2.5 py-2 font-mono text-[12.5px] text-mute hover:text-fg">
      <span className="grid size-[18px] shrink-0 place-items-center rounded-[4px] border border-dashed border-red/60 text-[10px] text-red" aria-hidden>
        +
      </span>
      <span className="min-w-0 flex-1">
        {count} more missed {count === 1 ? "test" : "tests"} · give them new days
      </span>
      <ArrowRight className="size-3.5 shrink-0" />
    </Link>
  );
}

const GAPS = [
  { value: "1", label: "every day" },
  { value: "2", label: "every 2 days" },
  { value: "3", label: "every 3 days" },
];

/** Re-plan everything left: from a day, one test every n days, in the current order, optionally around coaching. */
export function Replan() {
  const { quizrr, quizrrDates, settings, pickQuizrrDates } = useProgress();
  const t = today();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(t);
  const [gap, setGap] = useState("2");
  const coaching = settings.coaching;
  const hasCoaching = !!coaching?.plans.at(-1)?.days.length;
  const [skipCoaching, setSkipCoaching] = useState(true);
  const [all, setAll] = useState(false);
  const [undo, setUndo] = useState<{ count: number; last: string; prev: { testId: string; date: string | null }[] } | null>(null);
  const startOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && start >= t;
  const plan = useMemo(
    () => (startOk ? replan({ attempts: quizrr, dates: quizrrDates, start, gap: Number(gap), skip: hasCoaching && skipCoaching ? (d) => isScheduled(coaching, d) : undefined }) : []),
    [quizrr, quizrrDates, start, startOk, gap, hasCoaching, skipCoaching, coaching],
  );
  const left = untakenInOrder(quizrr, quizrrDates).length;
  const missed = dueQuizrr(quizrr, quizrrDates, t).filter((d) => d.date < t).length;
  const changed = plan.filter((p) => p.from !== p.to).length;

  // Linked from the Today strip as /quizrr#replan: open it there.
  useEffect(() => {
    if (window.location.hash === "#replan") setOpen(true);
  }, []);

  const apply = () => {
    if (!plan.length) return;
    buzz(16);
    pickQuizrrDates(plan.map((p) => ({ testId: p.test.id, date: p.to })));
    setUndo({ count: plan.length, last: plan.at(-1)!.to, prev: plan.map((p) => ({ testId: p.test.id, date: p.from })) });
    setOpen(false);
    setAll(false);
  };

  if (!left && !undo) return null;
  const shown = all ? plan : plan.slice(0, 6);

  return (
    <div id="replan" className="scroll-mt-6">
      <Section label="your schedule" right={left ? `${left} left to take` : undefined}>
        <AnimatePresence initial={false} mode="wait">
          {undo && !open ? (
            <motion.div key="undo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="font-mono text-[13px] text-fg">
                re-planned {undo.count} tests · last one {dayLabel(undo.last, t)}
              </p>
              <button
                onClick={() => {
                  buzz(10);
                  pickQuizrrDates(undo.prev);
                  setUndo(null);
                }}
                className="font-mono text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg"
              >
                undo
              </button>
              <button onClick={() => setUndo(null)} className="font-mono text-[12.5px] text-dim hover:text-fg">
                ok
              </button>
            </motion.div>
          ) : !open ? (
            <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <p className={`text-[14.5px] leading-snug ${missed ? "text-fg" : "text-mute"}`}>
                {missed ? (
                  <>
                    <span className="text-red">{missed === 1 ? "1 test is" : `${missed} tests are`} past their day.</span> <span className="text-mute">give everything left a fresh date in one go.</span>
                  </>
                ) : (
                  "move one test from its own page, or re-plan everything left in one go."
                )}
              </p>
              <button
                onClick={() => {
                  setStart(t);
                  setOpen(true);
                }}
                data-cursor="go"
                className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-medium ${missed ? "bg-fg text-ink" : "border border-line-2 text-mute hover:border-fg hover:text-fg"}`}
              >
                re-plan {left} tests
              </button>
            </motion.div>
          ) : (
            <motion.div key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div>
                  <span className="font-mono text-[11px] tracking-wider text-mute uppercase">start</span>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {quickDates(t)
                      .slice(0, 2)
                      .map((q) => (
                        <button
                          key={q.label}
                          onClick={() => setStart(q.date)}
                          className={`rounded-full border px-3 py-1.5 font-mono text-[12.5px] transition ${start === q.date ? "border-fg text-fg" : "border-line-2 text-mute hover:text-fg"}`}
                        >
                          {q.label}
                        </button>
                      ))}
                    <input type="date" value={start} min={t} onChange={(e) => setStart(e.target.value)} className={`${dateInput} ml-1`} aria-label="first test on" />
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[11px] tracking-wider text-mute uppercase">one test</span>
                  <div className="mt-2">
                    <Segmented id="replan-gap" value={gap} onChange={setGap} options={GAPS} />
                  </div>
                </div>
              </div>
              {hasCoaching && (
                <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[14.5px]">
                  <Check checked={skipCoaching} onToggle={() => setSkipCoaching((v) => !v)} label="skip coaching days" />
                  <span onClick={() => setSkipCoaching((v) => !v)}>skip coaching days</span>
                </label>
              )}
              {!startOk && <p className="mt-4 font-mono text-[12px] text-red">start today or later.</p>}
              {plan.length > 0 && (
                <>
                  <p className="mt-5 font-mono text-[12.5px] text-mute">
                    <span className="text-fg">{plan.length} tests</span> · {dayLabel(plan[0].to, t)} → {dayLabel(plan.at(-1)!.to, t)} · {changed} moved · in the order you had them
                  </p>
                  <ol className="mt-3 divide-y divide-line/60">
                    {shown.map((p) => (
                      <li key={p.test.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5 font-mono text-[12.5px]">
                        <span className="text-fg">{testName(p.test)}</span>
                        <span className="truncate text-dim">{p.from ? `was ${dayLabel(p.from, t)}` : "no date"}</span>
                        <span className={p.from === p.to ? "text-mute" : "text-fg"}>{dayLabel(p.to, t)}</span>
                      </li>
                    ))}
                  </ol>
                  {plan.length > shown.length && (
                    <button onClick={() => setAll(true)} className="mt-2 font-mono text-[12px] text-mute hover:text-fg">
                      show all {plan.length}
                    </button>
                  )}
                </>
              )}
              <div className="mt-5 flex items-center gap-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={apply} disabled={!plan.length} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
                  use these dates
                </motion.button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setAll(false);
                  }}
                  className="rounded-full px-3 py-2 text-[14px] text-mute hover:text-fg"
                >
                  cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Section>
    </div>
  );
}
