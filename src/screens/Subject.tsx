"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Page } from "../components/Shell";
import { DotBar, DotText, fadeUp, Label, StatusDot, Tag } from "../components/ui";
import { chapterInScope, getSubject, SUBJECT_COLOR, tracksForChapter, type Chapter } from "../data";
import { isStudied, STAGES, stageLabel, type Status } from "../lib/stages";
import { chapterFraction, subjectStats } from "../lib/stats";
import { trackProgress } from "../lib/tests";
import { useProgress, type ChapterProgress } from "../store/progress";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  ...STAGES.map((s) => ({ id: s.id, label: s.short })),
  { id: "hot", label: "high-yield" },
  { id: "11", label: "11th" },
  { id: "12", label: "12th" },
];
type Filter = "all" | Status | "hot" | "11" | "12";

function matches(c: Chapter, p: ChapterProgress | undefined, f: Filter, q: string) {
  if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false;
  const status = p?.status ?? "undone";
  if (STAGES.some((s) => s.id === f)) return status === f;
  if (f === "hot") return !!c.weight?.highYield;
  if (f === "11" || f === "12") return String(c.cls) === f;
  return true;
}

function ChapterRow({ c }: { c: Chapter }) {
  const { chapters, settings, tests } = useProgress();
  const p = chapters[c.id];
  const status = p?.status ?? "undone";
  const series = tracksForChapter(c.id).map((t) => trackProgress(t, tests));
  const testsDone = series.reduce((n, x) => n + x.done, 0);
  const testsTotal = series.reduce((n, x) => n + x.total, 0);
  const weight = c.inMain ? (c.weight?.main != null ? `${c.weight.main.toFixed(1)}` : "–") : c.weight?.adv != null ? `${c.weight.adv.toFixed(1)}a` : "–";
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <Link href={`/c/${c.id}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-ink-2">
        <StatusDot status={status} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15.5px] ${status === "undone" ? "text-mute" : "text-fg"}`}>{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {status !== "undone" && <Tag tone={status === "weak" ? "red" : "fg"}>{stageLabel(status)}</Tag>}
            {c.weight?.highYield && <Tag tone="red">high-yield</Tag>}
            {(p?.weak ?? []).some((w) => !w.fixed) && <Tag>{(p?.weak ?? []).filter((w) => !w.fixed).length} weak</Tag>}
            {!c.inMain && <Tag>adv only</Tag>}
            {!c.inAdv && <Tag>main only</Tag>}
            <span className="font-mono text-[11px] text-dim">{c.cls}th</span>
            {testsTotal > 0 && (
              <span className="font-mono text-[11px] text-dim">
                · {testsDone}/{testsTotal} tests
              </span>
            )}
          </div>
        </div>
        <div className="hidden sm:block">
          <DotBar value={chapterFraction(c, p, settings.exam)} dots={12} size={4} />
        </div>
        <span className="w-9 text-right font-mono text-[12px] text-mute" title={c.inMain ? "JEE Main questions per shift" : "JEE Advanced questions per year"}>
          {weight}
        </span>
      </Link>
    </motion.div>
  );
}

export function SubjectScreen({ subjectId }: { subjectId: string }) {
  const subject = getSubject(subjectId)!;
  const { chapters, settings } = useProgress();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const st = subjectStats(subject.id, chapters, settings.exam);
  const inScope = subject.chapters.filter((c) => chapterInScope(c, settings.exam));
  const visible = (unit: string) => inScope.filter((c) => c.unit === unit && matches(c, chapters[c.id], filter, q));

  return (
    <Page>
      {/* Laptops: sticky sidebar (title, progress, search, filters) beside the chapter list. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
      <aside className="lg:sticky lg:top-10 lg:col-span-4 lg:self-start">
      <motion.header variants={fadeUp} className="pb-6">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: SUBJECT_COLOR[subject.id] }} />
          <Label>
            {inScope.length} chapters · {settings.exam === "main" ? "main" : "main + adv"}
          </Label>
        </div>
        <h1 className="mt-3 text-[34px] leading-none font-semibold tracking-tight lg:text-[44px]">{subject.name}</h1>
        <div className="mt-5 flex items-center gap-4">
          <DotText className="text-3xl leading-none">{`${Math.round(st.percent)}%`}</DotText>
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <DotBar value={st.percent / 100} dots="auto" size={4} />
          </div>
        </div>
        <div className="mt-3 font-mono text-[12px] text-mute">
          {st.done} studied · {st.doing} working · <span className={st.weak ? "text-red" : ""}>{st.weak} weak</span> · {st.todo} undone
        </div>
      </motion.header>

      <motion.div variants={fadeUp} className="sticky top-0 z-30 -mx-5 border-b border-line bg-ink/90 px-5 pt-3 pb-3 backdrop-blur-xl lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <label className="flex items-center gap-2 border-b border-line pb-2.5 focus-within:border-mute">
          <Search className="size-3.5 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search chapters" className="w-full bg-transparent text-[15px] outline-none placeholder:text-dim" />
        </label>
        <div className="no-scrollbar mt-2.5 flex gap-4 overflow-x-auto lg:mt-4 lg:flex-wrap lg:gap-x-5 lg:gap-y-2 lg:overflow-visible">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`relative shrink-0 pb-1 font-mono text-[12px] transition-colors ${filter === f.id ? "text-fg" : "text-dim hover:text-mute"}`}>
              {f.label}
              {filter === f.id && <motion.span layoutId="filter-line" className="absolute inset-x-0 -bottom-px h-px bg-fg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            </button>
          ))}
        </div>
      </motion.div>

        <p className="mt-8 hidden font-mono text-[11px] leading-relaxed text-dim lg:block">right column: jee main questions per shift · &quot;a&quot; = advanced questions per year</p>
      </aside>
      <div className="lg:col-span-8 lg:-mt-6">
      <LayoutGroup>
        {subject.units.map((u) => {
          const list = visible(u.id);
          if (!list.length) return null;
          return (
            <motion.section layout="position" key={u.id} className="pt-6">
              <div className="mb-1 flex items-baseline justify-between">
                <Label>{u.name}</Label>
                <span className="font-mono text-[11px] text-dim">
                  {list.filter((c) => isStudied(chapters[c.id]?.status ?? "undone")).length}/{list.length}
                </span>
              </div>
              <div className="xl:grid xl:grid-cols-2 xl:gap-x-10">
                <AnimatePresence mode="popLayout">
                  {list.map((c) => (
                    <ChapterRow key={c.id} c={c} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          );
        })}
        {subject.units.every((u) => !visible(u.id).length) && <p className="py-16 text-center font-mono text-[13px] text-dim">nothing here.</p>}
      </LayoutGroup>
      </div>
      </div>
      <p className="mt-8 font-mono text-[11px] text-dim lg:hidden">right column: jee main questions per shift · &quot;a&quot; = advanced questions per year</p>
    </Page>
  );
}
