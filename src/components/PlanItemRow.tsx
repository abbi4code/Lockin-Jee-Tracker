"use client";

import { motion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { getChapter, SUBJECT_COLOR } from "../data";
import { addDays, dayLabel, KIND_LABEL, type PlanItem } from "../lib/plan";
import { useProgress } from "../store/progress";
import { buzz, Check } from "./Controls";
import { Tag } from "./ui";

/** One planned chapter: tick it off, open it, push it to tomorrow, re-date or drop it. Draggable on desktop. */
export function PlanItemRow({ item, t, compact = false }: { item: PlanItem; t: string; compact?: boolean }) {
  const { togglePlanDone, movePlan, deletePlan, chapters } = useProgress();
  const c = getChapter(item.chapterId);
  if (!c) return null;
  const weak = (chapters[c.id]?.weak ?? []).filter((w) => !w.fixed).length;
  const late = !item.doneAt && item.date < t;
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
    {/* Native drag-and-drop (desktop) lives on a plain div: motion's onDragStart is its own gesture. */}
    <div draggable={!item.doneAt} onDragStart={(e) => e.dataTransfer.setData("text/plan-item", item.id)} className="group flex items-start gap-2.5 py-2">
      <div className="pt-0.5">
        <Check
          checked={!!item.doneAt}
          label={`${KIND_LABEL[item.kind]} ${c.name}`}
          onToggle={() => {
            buzz(item.doneAt ? 5 : 12);
            togglePlanDone(item.id);
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/c/${c.id}`} className={`block text-[14.5px] leading-snug ${item.doneAt ? "text-dim line-through decoration-dim" : "hover:underline"}`}>
          {c.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[c.subject] }} />
          <span className="font-mono text-[11px] text-dim">{KIND_LABEL[item.kind]}</span>
          {weak > 0 && !item.doneAt && <Tag tone="red">{weak} weak</Tag>}
          {late && !compact && <span className="font-mono text-[11px] text-red">{dayLabel(item.date, t)}</span>}
        </div>
      </div>
      {!item.doneAt && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-dim lg:opacity-0 lg:transition lg:group-hover:opacity-100">
          <button onClick={() => movePlan(item.id, late ? t : addDays(item.date, 1))} aria-label={late ? "move to today" : "move to next day"} title={late ? "move to today" : "next day"} className="hover:text-fg">
            <ArrowRight className="size-3.5" />
          </button>
          <button onClick={() => deletePlan(item.id)} aria-label="remove" data-cursor="danger" className="hover:text-red">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
    </motion.div>
  );
}

