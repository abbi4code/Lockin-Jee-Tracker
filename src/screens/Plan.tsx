"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { DatePill } from "../components/ChapterPlan";
import { buzz } from "../components/Controls";
import { PlanItemRow as Item } from "../components/PlanItemRow";
import { Page } from "../components/Shell";
import { fadeUp, Label, Section } from "../components/ui";
import { ALL_CHAPTERS, chapterInScope, SUBJECT_COLOR } from "../data";
import { coachingMinutes } from "../lib/coaching";
import { addDays, autoPlan, live, overdue } from "../lib/plan";
import { isStudied } from "../lib/stages";
import { revisionsDue } from "../lib/stats";
import { today, useProgress } from "../store/progress";

const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00`).getDay() + 6) % 7));

/** Search any chapter in scope; due revisions are suggested before typing. */
function ChapterSearch({ onPick, onClose }: { onPick: (chapterId: string) => void; onClose: () => void }) {
  const { chapters, settings } = useProgress();
  const [q, setQ] = useState("");
  const due = revisionsDue(chapters, settings.exam).map((d) => d.chapter);
  const list = q.trim()
    ? ALL_CHAPTERS.filter((c) => chapterInScope(c, settings.exam) && c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 7)
    : (due.length ? due : ALL_CHAPTERS.filter((c) => chapters[c.id] && isStudied(chapters[c.id].status))).slice(0, 5);
  return (
    <div className="mt-2 rounded-lg border border-line-2 bg-ink-2 p-2">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-2">
        <Search className="size-3.5 text-dim" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="find a chapter" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim" />
        <button onClick={onClose} aria-label="close" className="text-dim hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      {!q.trim() && list.length > 0 && <Label className="px-1 pt-2 pb-1 text-[10px]">{due.length ? "due for revision" : "studied"}</Label>}
      {list.map((c) => (
        <button key={c.id} onClick={() => onPick(c.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[14px] transition hover:bg-ink-3">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: SUBJECT_COLOR[c.subject] }} />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {q.trim() && !list.length && <p className="px-1 py-2 font-mono text-[12px] text-dim">no chapter matches.</p>}
    </div>
  );
}

export function PlanScreen() {
  const store = useProgress();
  const { plan, chapters, settings, schedule, movePlan, deletePlan } = store;
  const t = today();
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ ids: string[]; text: string } | null>(null);

  const monday = addDays(mondayOf(t), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const items = live(plan);
  const late = overdue(plan, t);
  const weekLabel = `${new Date(`${days[0]}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(`${days[6]}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`.toLowerCase();

  // "Plan my week": revisions due in the next 7 days first (soonest first), then studied chapters with open
  // weak spots or low confidence.
  const candidates = useMemo(() => {
    const due = revisionsDue(chapters, settings.exam, addDays(t, 6)).map((d) => d.chapter.id);
    const shaky = ALL_CHAPTERS.filter((c) => {
      const p = chapters[c.id];
      return p && isStudied(p.status) && ((p.weak ?? []).some((w) => !w.fixed) || (p.confidence != null && p.confidence <= 1));
    }).map((c) => c.id);
    return [...new Set([...due, ...shaky])];
  }, [chapters, settings.exam, t]);

  const planWeek = () => {
    const entries = autoPlan(candidates, plan, t, settings.coaching);
    if (!entries.length) {
      setPlanned({ ids: [], text: candidates.length ? "this week is already full (2 a day, 1 on coaching days)." : "nothing due this week. mark chapters as studied to get revisions." });
      return;
    }
    const before = new Set(Object.keys(useProgress.getState().plan));
    schedule(entries.map((e) => ({ ...e, kind: "revision" as const })));
    const ids = Object.keys(useProgress.getState().plan).filter((id) => !before.has(id));
    buzz(15);
    setOffset(0);
    setPlanned({ ids, text: `planned ${ids.length} revision${ids.length === 1 ? "" : "s"} across the next 7 days.` });
  };

  const onDrop = (e: DragEvent, day: string) => {
    e.preventDefault();
    setDropDay(null);
    const id = e.dataTransfer.getData("text/plan-item");
    if (id) movePlan(id, day);
  };

  return (
    <Page>
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <span className="dot text-lg">planner</span>
          <p className="mt-2 max-w-md text-[15px] text-mute">Schedule revisions on days. Tick them off here or on the home screen; reminders come at the times set on the Me page.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="previous week" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute hover:text-fg">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setOffset(0)} className={`min-w-32 rounded-full border px-3 py-1.5 font-mono text-[12.5px] ${offset === 0 ? "border-fg text-fg" : "border-line-2 text-mute hover:text-fg"}`}>
            {offset === 0 ? "this week" : weekLabel}
          </button>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="next week" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute hover:text-fg">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </motion.header>

      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 border-t border-line py-4">
        <button onClick={planWeek} data-cursor="go" className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink">
          <Sparkles className="size-3.5" /> plan my week
        </button>
        <span className="font-mono text-[12px] text-dim">
          {candidates.length} chapter{candidates.length === 1 ? "" : "s"} due or shaky · max 2 a day, 1 on coaching days
        </span>
        <AnimatePresence>
          {planned && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3 font-mono text-[12.5px] text-fg">
              {planned.text}
              {planned.ids.length > 0 && (
                <button
                  onClick={() => {
                    planned.ids.forEach(deletePlan);
                    setPlanned(null);
                  }}
                  className="text-mute underline underline-offset-4 hover:text-fg"
                >
                  undo
                </button>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {late.length > 0 && (
        <Section label="overdue" right={`${late.length} missed`}>
          <div className="grid gap-x-10 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {late.map((i) => (
                <Item key={i.id} item={i} t={t} />
              ))}
            </AnimatePresence>
          </div>
        </Section>
      )}

      <motion.section variants={fadeUp} className="grid border-t border-line lg:grid-cols-7">
        {days.map((d) => {
          const dayItems = items.filter((i) => i.date === d).sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt));
          const isToday = d === t;
          const coaching = coachingMinutes(settings.coaching, d) > 0;
          return (
            <div
              key={d}
              onDragOver={(e) => {
                e.preventDefault();
                setDropDay(d);
              }}
              onDragLeave={() => setDropDay((x) => (x === d ? null : x))}
              onDrop={(e) => onDrop(e, d)}
              className={`border-b border-line px-0 py-4 lg:min-h-72 lg:border-r lg:border-b-0 lg:px-3 lg:last:border-r-0 ${dropDay === d ? "bg-ink-2" : ""}`}
            >
              <div className="flex items-center gap-2">
                {isToday && <span className="size-1.5 rounded-full bg-red" />}
                <span className={`font-mono text-[12px] tracking-wide uppercase ${isToday ? "text-fg" : d < t ? "text-dim" : "text-mute"}`}>
                  {new Date(`${d}T00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}
                </span>
                {coaching && <span className="font-mono text-[10.5px] text-dim">coaching</span>}
                <button onClick={() => setAdding(adding === d ? null : d)} aria-label="add a chapter" className="ml-auto grid size-6 place-items-center rounded-full text-dim transition hover:bg-ink-2 hover:text-fg">
                  <Plus className="size-3.5" />
                </button>
              </div>
              {adding === d && (
                <ChapterSearch
                  onClose={() => setAdding(null)}
                  onPick={(id) => {
                    buzz(10);
                    schedule([{ chapterId: id, date: d, kind: chapters[id] && isStudied(chapters[id].status) ? "revision" : "study" }]);
                    setAdding(null);
                  }}
                />
              )}
              <AnimatePresence initial={false}>
                {dayItems.map((i) => (
                  <Item key={i.id} item={i} t={t} compact />
                ))}
              </AnimatePresence>
              {!dayItems.length && adding !== d && <p className="pt-2 font-mono text-[11.5px] text-dim">{d < t ? "–" : "free"}</p>}
            </div>
          );
        })}
      </motion.section>

      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 border-t border-line py-4">
        <span className="font-mono text-[12px] text-dim">jump to a date:</span>
        <DatePill
          label="pick week"
          onPick={(date) => setOffset(Math.round((new Date(`${mondayOf(date)}T00:00`).getTime() - new Date(`${mondayOf(t)}T00:00`).getTime()) / (7 * 86_400_000)))}
        />
        <span className="hidden font-mono text-[12px] text-dim lg:inline">· drag an item onto another day to move it</span>
      </motion.div>
    </Page>
  );
}
