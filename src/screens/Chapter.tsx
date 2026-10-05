"use client";

import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buzz, Check, Segmented } from "../components/Controls";
import { Page } from "../components/Shell";
import { Disclosure, DotBar, fadeUp, Label, Section, Tag } from "../components/ui";
import { getChapter, getSubject, SUBJECT_COLOR, topicInScope } from "../data";
import { celebrate } from "../lib/celebrate";
import { chapterFraction, scopedTopics } from "../lib/stats";
import { emptyProgress, useProgress, type Status, type StepId } from "../store/progress";
import { TestSeriesPanel } from "../components/TestSeries";
import { isStudied, STAGES } from "../lib/stages";

const STEPS: { id: StepId; label: string }[] = [
  { id: "lecture", label: "lecture" },
  { id: "notes", label: "notes" },
  { id: "module", label: "vmc module" },
  { id: "pyq", label: "pyqs" },
  { id: "ncert", label: "ncert" },
];
const CONFIDENCE = ["cooked", "shaky", "okay", "solid", "goated"];

function YearDots({ byYear }: { byYear: Record<string, number | null> }) {
  const years = Object.keys(byYear).sort();
  const max = Math.max(...years.map((y) => byYear[y] ?? 0), 0.5);
  const levels = 6;
  return (
    <div className="flex items-end gap-3">
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        const on = Math.round((v / max) * levels);
        return (
          <div key={y} className="flex flex-col items-center gap-[3px]" title={`${y}: ${byYear[y] ?? "–"} per shift`}>
            {Array.from({ length: levels }, (_, i) => levels - 1 - i).map((lvl) => (
              <span key={lvl} className="size-[5px] rounded-full" style={{ background: lvl < on ? (Number(y) >= 2024 ? "var(--color-fg)" : "var(--color-dim)") : "var(--color-dot-off)" }} />
            ))}
            <span className="mt-1 font-mono text-[10px] text-dim">{y.slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ChapterScreen({ chapterId }: { chapterId: string }) {
  const chapter = getChapter(chapterId)!;
  const store = useProgress();
  const router = useRouter();
  const subject = getSubject(chapter.subject)!;
  const exam = store.settings.exam;
  const p = store.chapters[chapter.id] ?? emptyProgress();
  const topics = chapter.topics.filter((t) => topicInScope(t, exam));
  const hidden = chapter.topics.length - topics.length;
  const names = scopedTopics(chapter, exam);
  const checked = names.filter((n) => p.topics[n]).length;
  const steps = STEPS.filter((s) => s.id !== "ncert" || chapter.ncertCritical || chapter.res?.ncertUseful);
  const w = chapter.weight;

  const setStatus = (s: Status) => {
    if (isStudied(s) && !isStudied(p.status)) celebrate(chapter.subject);
    store.setStatus(chapter.id, s, names);
  };
  const toggleTopic = (name: string) => {
    const before = p.status;
    const after = store.toggleTopic(chapter.id, name, names);
    if (isStudied(after) && !isStudied(before)) celebrate(chapter.subject);
  };
  const focus = () => {
    if (!store.timer.sessionStart) store.timerStart({ chapterId: chapter.id });
    else store.timerSet({ chapterId: chapter.id });
    router.push("/focus");
  };

  const stats = [
    w?.main != null && chapter.inMain ? `${w.main.toFixed(1)} q/shift main` : null,
    w?.adv != null ? `${w.adv.toFixed(1)} q/yr adv` : null,
    w?.roi != null ? `roi ${w.roi}/5` : null,
    chapter.difficulty != null ? `difficulty ${chapter.difficulty}/5` : null,
  ].filter(Boolean);

  return (
    <Page>
      <motion.div variants={fadeUp} className="pb-6">
        <Link href={`/s/${subject.id}`} className="inline-flex items-center gap-1.5 font-mono text-[12px] text-mute transition hover:text-fg">
          <ArrowLeft className="size-3.5" /> {subject.name.toLowerCase()}
        </Link>
      </motion.div>

      <motion.header variants={fadeUp} className="pb-7">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 size-2 rounded-full" style={{ background: SUBJECT_COLOR[chapter.subject] }} />
          {w?.highYield && <Tag tone="red">high-yield</Tag>}
          <Tag>class {chapter.cls}</Tag>
          {chapter.branch && <Tag>{chapter.branch}</Tag>}
          {!chapter.inMain && <Tag>advanced only</Tag>}
          {!chapter.inAdv && <Tag>main only</Tag>}
        </div>
        <h1 className="mt-4 text-[30px] leading-[1.08] font-semibold tracking-tight sm:text-[38px] lg:text-[48px]">{chapter.name}</h1>
        <p className="mt-3 font-mono text-[12.5px] text-mute">{stats.join("  ·  ")}</p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 lg:max-w-4xl">
          {/* The 7-stage pipeline scrolls sideways on narrow phones. */}
          <div className="no-scrollbar -mx-5 max-w-[calc(100%+2.5rem)] overflow-x-auto px-5 sm:mx-0 sm:max-w-full sm:px-0">
            <Segmented<Status> id="status" value={p.status} onChange={setStatus} options={STAGES.map((s) => ({ value: s.id, label: s.short }))} />
          </div>
          <button onClick={focus} data-cursor="go" className="flex items-center gap-1.5 rounded-full border border-line-2 px-3.5 py-1.5 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg">
            <Timer className="size-3.5" /> focus on this
          </button>
        </div>
        <div className="mt-5 flex items-center gap-3 lg:max-w-4xl">
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <DotBar value={chapterFraction(chapter, p, exam)} dots="auto" size={4} />
          </div>
          <span className="font-mono text-[12px] text-mute">
            {checked}/{names.length}
          </span>
        </div>
      </motion.header>

      {/* Laptops: topics on the left, everything else in a sticky panel on the right. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
      <div className="lg:col-span-7">
      <TestSeriesPanel chapterId={chapter.id} />
      <Section
        label="topics"
        right={
          <button
            onClick={() => {
              buzz();
              const all = checked < names.length;
              store.setAllTopics(chapter.id, names, all);
              if (all && !isStudied(p.status)) setStatus("ready");
              else if (!all && isStudied(p.status)) store.setStatus(chapter.id, "working", []);
            }}
            className="hover:text-fg"
          >
            {checked < names.length ? "tick all" : "untick all"}
          </button>
        }
      >
        <ul>
          {topics.map((t) => {
            const on = !!p.topics[t.name];
            return (
              <li key={t.name} className="flex items-start gap-3 border-b border-line/60 py-3 last:border-0">
                <div className="pt-0.5">
                  <Check checked={on} label={t.name} onToggle={() => toggleTopic(t.name)} />
                </div>
                <div className="min-w-0 flex-1">
                  <button onClick={() => toggleTopic(t.name)} className={`text-left text-[15.5px] leading-snug transition-colors ${on ? "text-dim line-through decoration-dim" : "text-fg"}`}>
                    {t.name}
                  </button>
                  {(t.mainNote || !t.inMain || !t.inAdv) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {t.mainNote && <Tag tone="red">not in syllabus · asked {t.mainQs}× in main</Tag>}
                      {!t.inMain && <Tag>adv only</Tag>}
                      {!t.inAdv && <Tag>main only</Tag>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {hidden > 0 && <p className="mt-3 font-mono text-[12px] text-dim">{hidden} advanced-only topics hidden in main mode</p>}
      </Section>
      </div>

      <aside className="lg:sticky lg:top-10 lg:col-span-5 lg:self-start">
      <Section label="done so far">
        <div className="flex flex-wrap gap-2">
          {steps.map((s) => {
            const on = !!p.steps[s.id];
            return (
              <motion.button
                key={s.id}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  buzz();
                  store.toggleStep(chapter.id, s.id);
                }}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition-colors ${on ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:text-fg"}`}
              >
                {on ? "✓ " : ""}
                {s.label}
              </motion.button>
            );
          })}
        </div>
      </Section>

      <Section label="confidence" right={p.confidence != null ? CONFIDENCE[p.confidence] : "not rated"}>
        <div className="flex gap-2">
          {CONFIDENCE.map((label, i) => {
            const on = p.confidence != null && i <= p.confidence;
            return (
              <button
                key={label}
                aria-label={label}
                onClick={() => {
                  buzz();
                  store.setConfidence(chapter.id, p.confidence === i ? null : i);
                }}
                className="group flex-1 py-2"
              >
                <span
                  className="block h-1.5 rounded-full"
                  style={{
                    background: on ? (p.confidence! <= 1 ? "var(--color-red)" : "var(--color-fg)") : "var(--color-dot-off)",
                    transition: `background-color 0.2s ${on ? i * 0.04 : 0}s`,
                  }}
                />
              </button>
            );
          })}
        </div>
      </Section>

      {isStudied(p.status) && (
        <Section label="revisions" right={p.revisions.at(-1) ? `last ${p.revisions.at(-1)}` : `done ${p.doneAt}`}>
          <div className="flex items-center justify-between">
            <span className="dot text-3xl">×{p.revisions.length}</span>
            <button
              onClick={() => {
                buzz(12);
                store.addRevision(chapter.id);
              }}
              className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink"
            >
              revised today
            </button>
          </div>
        </Section>
      )}

      {w && (
        <Section label="jee main · questions per shift" right={`${w.confidence} confidence`}>
          <YearDots byYear={w.mainByYear} />
          {w.roiReason && <p className="mt-4 text-[14.5px] leading-relaxed text-mute">{w.roiReason}</p>}
        </Section>
      )}

      {chapter.prereqs.length > 0 && (
        <Section label="learn first">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {chapter.prereqs.map((id) => {
              const pre = getChapter(id);
              if (!pre) return null;
              const done = isStudied(store.chapters[id]?.status ?? "undone");
              return (
                <Link key={id} href={`/c/${id}`} className={`text-[15px] underline decoration-line-2 underline-offset-4 transition hover:decoration-fg ${done ? "text-dim" : "text-fg"}`}>
                  {done ? "✓ " : ""}
                  {pre.name}
                </Link>
              );
            })}
          </div>
        </Section>
      )}

      {chapter.res && (
        <Disclosure label="resources" count={chapter.res.videos.length + chapter.res.notes.length + chapter.res.books.length}>
          <div className="space-y-5">
            {chapter.res.videos.length > 0 && (
              <div>
                <Label className="mb-2">lectures</Label>
                {chapter.res.videos.map((v) => (
                  <a key={v.url} href={v.url} target="_blank" rel="noreferrer" className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-ink-2">
                    <span className="mt-0.5 font-mono text-[12px] text-dim">▶</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[15px]">{v.title}</span>
                      <span className="font-mono text-[11.5px] text-dim">
                        {v.channel}
                        {v.duration ? ` · ${v.duration}` : ""} · {v.lang}
                      </span>
                    </span>
                    <ArrowUpRight className="mt-0.5 size-3.5 text-dim group-hover:text-fg" />
                  </a>
                ))}
              </div>
            )}
            {chapter.res.notes.length > 0 && (
              <div>
                <Label className="mb-2">formula sheets</Label>
                {chapter.res.notes.map((n) => (
                  <a key={n.url} href={n.url} target="_blank" rel="noreferrer" className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[15px] transition hover:bg-ink-2">
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <ArrowUpRight className="size-3.5 text-dim group-hover:text-fg" />
                  </a>
                ))}
              </div>
            )}
            {chapter.res.books.length > 0 && (
              <div>
                <Label className="mb-2">books</Label>
                {chapter.res.books.map((b) => (
                  <div key={b.name + b.section} className="py-1.5 text-[15px]">
                    {b.name}
                    {b.section && <span className="text-dim"> — {b.section}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Disclosure>
      )}

      {chapter.notes && <p className="mt-6 font-mono text-[12px] leading-relaxed text-dim">{chapter.notes}</p>}
      </aside>
      </div>
    </Page>
  );
}
