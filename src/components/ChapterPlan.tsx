"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, CalendarPlus, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dayLabel, KIND_LABEL, quickDates, scheduledFor, type PlanKind } from "../lib/plan";
import { isStudied } from "../lib/stages";
import { emptyProgress, today, useProgress } from "../store/progress";
import { buzz, Check, Segmented } from "./Controls";
import { Section } from "./ui";

const chip = "rounded-full border border-line-2 px-3.5 py-1.5 font-mono text-[13px] text-mute transition hover:border-fg hover:text-fg";

/** A date input dressed as a pill: tapping opens the native date picker. */
export function DatePill({ onPick, label = "pick date", min }: { onPick: (date: string) => void; label?: string; min?: string }) {
  return (
    <label className={`${chip} relative flex cursor-pointer items-center gap-1.5`}>
      <CalendarPlus className="size-3.5" /> {label}
      <input
        type="date"
        min={min}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
          e.target.value = "";
        }}
        onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      />
    </label>
  );
}

/** Chapter page: schedule this chapter in one tap, and see/cancel what's already planned for it. */
export function ScheduleBlock({ chapterId }: { chapterId: string }) {
  const { plan, schedule, deletePlan, chapters } = useProgress();
  const studied = isStudied((chapters[chapterId] ?? emptyProgress()).status);
  const [kind, setKind] = useState<PlanKind>(studied ? "revision" : "study");
  const t = today();
  const upcoming = scheduledFor(plan, chapterId);
  const add = (date: string) => {
    buzz(10);
    schedule([{ chapterId, date, kind }]);
  };

  return (
    <Section label="schedule" right={upcoming[0] ? `next: ${dayLabel(upcoming[0].date, t)}` : "nothing planned"}>
      <Segmented<PlanKind>
        id="schedule-kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "revision", label: "revise" },
          { value: "study", label: "study" },
          { value: "test", label: "test" },
        ]}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {quickDates(t).map((q) => (
          <button key={q.label} onClick={() => add(q.date)} className={chip}>
            {q.label}
          </button>
        ))}
        <DatePill onPick={add} min={t} />
      </div>
      <AnimatePresence initial={false}>
        {upcoming.map((i) => (
          <motion.div key={i.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex items-center gap-3 pt-3 text-[14.5px]">
              <span className={`size-1.5 rounded-full ${i.date < t ? "bg-red" : "bg-fg"}`} />
              <span className={i.date < t ? "text-red" : ""}>{dayLabel(i.date, t)}</span>
              <span className="font-mono text-[12px] text-dim">{KIND_LABEL[i.kind]}</span>
              <button onClick={() => deletePlan(i.id)} aria-label="remove from plan" data-cursor="danger" className="ml-auto text-dim transition hover:text-red">
                <X className="size-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <Link href="/plan" className="group mt-4 inline-flex items-center gap-1 font-mono text-[12px] text-mute hover:text-fg">
        open planner <ArrowUpRight className="size-3 text-dim group-hover:text-fg" />
      </Link>
    </Section>
  );
}

/** Chapter page: weak spots to fix (a checklist) and free-form notes. */
export function NotesBlock({ chapterId }: { chapterId: string }) {
  const { chapters, addWeak, toggleWeak, removeWeak, setNotes } = useProgress();
  const p = chapters[chapterId] ?? emptyProgress();
  const weak = p.weak ?? [];
  const open = weak.filter((w) => !w.fixed);
  const fixed = weak.filter((w) => w.fixed);
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (!draft.trim()) return;
    buzz(8);
    addWeak(chapterId, draft);
    setDraft("");
  };
  const row = (w: (typeof weak)[number]) => (
    <motion.li key={w.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group flex items-start gap-3 border-b border-line/60 py-2.5 last:border-0">
      <div className="pt-0.5">
        <Check checked={w.fixed} label={w.text} onToggle={() => toggleWeak(chapterId, w.id)} />
      </div>
      <span className={`min-w-0 flex-1 text-[15px] leading-snug ${w.fixed ? "text-dim line-through decoration-dim" : ""}`}>{w.text}</span>
      <span className="pt-0.5 font-mono text-[11px] text-dim">{w.at.slice(5).replace("-", "/")}</span>
      <button onClick={() => removeWeak(chapterId, w.id)} aria-label="delete weak spot" data-cursor="danger" className="pt-0.5 text-dim transition hover:text-red lg:opacity-0 lg:group-hover:opacity-100">
        <X className="size-3.5" />
      </button>
    </motion.li>
  );

  return (
    <Section label="notes" right={open.length ? `${open.length} weak spot${open.length === 1 ? "" : "s"} to fix` : weak.length ? "all weak spots fixed" : undefined}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 border-b border-line-2 focus-within:border-fg"
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="add a weak spot, e.g. sign convention in mirror formula" className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none placeholder:text-dim" />
        <button type="submit" disabled={!draft.trim()} aria-label="add weak spot" className="text-mute transition hover:text-fg disabled:opacity-30">
          <Plus className="size-4" />
        </button>
      </form>
      <ul className="mt-1">
        <AnimatePresence initial={false}>
          {open.map(row)}
          {fixed.map(row)}
        </AnimatePresence>
      </ul>
      <textarea
        value={p.notes ?? ""}
        onChange={(e) => setNotes(chapterId, e.target.value.slice(0, 5000))}
        placeholder="notes: formulas to remember, mistakes you keep making, what sir said in class…"
        rows={4}
        className="mt-4 field-sizing-content min-h-24 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-dim focus:border-line-2"
      />
    </Section>
  );
}
