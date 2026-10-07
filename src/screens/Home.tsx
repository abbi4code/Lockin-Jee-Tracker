"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { buzz, Check, Segmented } from "../components/Controls";
import { TodayCollege, WeekCollege } from "../components/College";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { Headline } from "../components/Headline";
import { AdminLink } from "../components/AdminLink";
import { Rolling, useCountdown } from "../components/Numbers";
import { Page } from "../components/Shell";
import { DotBar, DotText, fadeUp, Label, Section } from "../components/ui";
import { findExam, SUBJECT_COLOR, SUBJECTS, type Exam } from "../data";
import { celebrate } from "../lib/celebrate";
import { activityGrid, chapterFraction, currentFocus, daysBetween, formatMinutes, freeMarks, pace, revisionsDue, streak, subjectStats } from "../lib/stats";
import { currentPlan, isScheduled, studyByDay, toggleDay } from "../lib/coaching";
import { today, useProgress } from "../store/progress";
import { PlanItemRow } from "../components/PlanItemRow";
import { live, onDay, overdue } from "../lib/plan";
import { scoreTone, seriesSummary } from "../lib/tests";

function Header() {
  const { settings, setSettings } = useProgress();
  return (
    <motion.header variants={fadeUp} className="pb-8">
      <div className="flex items-center justify-between">
        <span className="dot text-lg">lockin.</span>
        <div className="flex items-center gap-4">
        <AdminLink />
        <div className="hidden sm:block">
          <ThemeSwitcher />
        </div>
        <Segmented<Exam>
          id="exam"
          value={settings.exam}
          onChange={(exam) => setSettings({ exam })}
          options={[
            { value: "main", label: "Main" },
            { value: "advanced", label: "Main + Adv" },
          ]}
        />
        </div>
      </div>
      <Headline />
    </motion.header>
  );
}

function Countdown() {
  const main = findExam(/Main 2027 Session 1$/);
  const adv = findExam(/Advanced 2027$/);
  const boards = findExam(/CBSE/);
  const target = useMemo(() => new Date(`${main?.start ?? "2027-01-22"}T09:00:00+05:30`), [main?.start]);
  const t = useCountdown(target);
  const now = new Date();
  return (
    <Section label="jee main · session 1" right={
        main?.status === "official" ? (
          <>
            22 jan<span className="hidden sm:inline"> 2027 · nta official</span>
          </>
        ) : (
          "expected"
        )
      }>
      <div className="flex items-baseline gap-3">
        <span className="dot text-[56px] leading-none lg:text-[80px]">
          <Rolling value={t.days} pad={3} />
        </span>
        <span className="font-mono text-xs text-mute">days</span>
        <span className="ml-auto flex items-baseline text-2xl leading-none text-mute">
          <Rolling value={t.hours} className="dot" />
          <span className="mx-0.5 text-base text-dim">:</span>
          <Rolling value={t.minutes} className="dot" />
          <span className="mx-0.5 text-base text-dim">:</span>
          <Rolling value={t.seconds} className="dot text-red" />
        </span>
      </div>
      <div className="mt-3 font-mono text-[12px] text-dim">
        {boards && <>boards {daysBetween(now, new Date(boards.start))}d</>}
        {adv && <> · advanced {daysBetween(now, new Date(adv.start))}d</>}
      </div>
    </Section>
  );
}

function Now() {
  const store = useProgress();
  const router = useRouter();
  const exam = store.settings.exam;
  const focus = currentFocus(store.chapters, exam);
  if (!focus) return null;
  const { chapter, started, nextTopic, topics } = focus;
  const p = store.chapters[chapter.id];
  const done = topics.filter((t) => p?.topics[t]).length;

  const tick = () => {
    if (!nextTopic) return;
    const after = store.toggleTopic(chapter.id, nextTopic, topics);
    if (after === "ready") celebrate(chapter.subject);
  };

  return (
    <Section label={started ? "now · continue" : "now · start here"}>
      <Link href={`/c/${chapter.id}`} className="group flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight lg:text-[28px]">{chapter.name}</h2>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[12px] text-mute">
            <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[chapter.subject] }} />
            {chapter.subject} · {done}/{topics.length} topics
            {chapter.weight?.main != null && <> · {chapter.weight.main.toFixed(1)} q/shift</>}
          </div>
        </div>
        <ArrowRight className="mt-1.5 size-4 shrink-0 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg" />
      </Link>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 overflow-hidden">
          <DotBar value={chapterFraction(chapter, p, exam)} dots="auto" size={4} />
        </div>
        <button
          onClick={() => {
            if (!store.timer.sessionStart) store.timerStart({ chapterId: chapter.id });
            router.push("/focus");
          }}
          data-cursor="go"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg"
        >
          <Timer className="size-3.5" /> focus
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {nextTopic && (
          <motion.div
            key={nextTopic}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="mt-5 flex items-center gap-3 rounded-lg border border-line px-3 py-3"
          >
            <Check checked={false} onToggle={tick} label={nextTopic} />
            <div className="min-w-0">
              <Label>next topic</Label>
              <div className="mt-0.5 truncate text-[15px]">{nextTopic}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  );
}

function Syllabus() {
  const { chapters, settings } = useProgress();
  const all = subjectStats("all", chapters, settings.exam);
  return (
    <Section label="syllabus" right={`${Math.round(all.percent)}% · ${all.done}/${all.total} chapters`}>
      <div className="space-y-1">
        {SUBJECTS.map((s) => {
          const st = subjectStats(s.id, chapters, settings.exam);
          return (
            <Link key={s.id} href={`/s/${s.id}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-ink-2">
              <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[s.id] }} />
              <span className="w-20 text-[15px]">{s.name}</span>
              <div className="flex min-w-0 flex-1 overflow-hidden">
                <DotBar value={st.percent / 100} dots="auto" size={4} />
              </div>
              <span className="w-12 text-right font-mono text-[12px] text-mute">
                {st.done}/{st.total}
              </span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

function Rhythm() {
  const { chapters, activity, settings } = useProgress();
  const st = streak(activity);
  const p = pace(chapters, settings.exam);
  const strip = activityGrid(activity, 28);
  return (
    <motion.section variants={fadeUp} className="grid grid-cols-2 border-t border-line">
      <div className="border-r border-line py-4 pr-4">
        <Label>streak</Label>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="dot text-3xl">{st.days}</span>
          <span className="font-mono text-[12px] text-mute">{st.atRisk ? "at risk" : st.activeToday ? "today ✓" : "days"}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-[3px]">
          {strip.map((d) => (
            <span key={d.date} title={d.date} className="size-[5px] rounded-full" style={{ background: d.active ? "var(--color-fg)" : "var(--color-dot-off)" }} />
          ))}
        </div>
      </div>
      <div className="py-4 pl-4">
        <Label>pace · ch/week</Label>
        <div className="mt-2 flex items-baseline gap-1.5">
          <DotText className={`text-3xl ${p.onTrack || p.left === 0 ? "" : "text-red"}`}>{p.actual.toFixed(1)}</DotText>
          <span className="font-mono text-[12px] text-mute">/ {(p.needed ?? 0).toFixed(1)} needed</span>
        </div>
        <p className="mt-3 font-mono text-[12px] text-dim">
          {p.left === 0 ? "syllabus done" : `${p.left} left · ${p.weeksLeft ? Math.floor(p.weeksLeft) : 0} wks to go`}
        </p>
      </div>
    </motion.section>
  );
}

/** Hours studied: focus-timer sessions plus coaching days, today and over the last week. */
function StudyTime() {
  const { sessions, settings, setSettings } = useProgress();
  const coaching = settings.coaching;
  const week = studyByDay(sessions, coaching, 7);
  const t = week[6];
  const weekTotal = week.reduce((n, d) => n + d.total, 0);
  const max = Math.max(...week.map((d) => d.total), 240);
  const plan = currentPlan(coaching);
  const went = t.coaching > 0;

  return (
    <Section label="study time" right={`${formatMinutes(weekTotal)} this week`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DotText className="block text-3xl leading-none">{t.total ? formatMinutes(t.total) : "0m"}</DotText>
          <p className="mt-2 font-mono text-[12px] text-mute">
            today{t.coaching ? ` · ${formatMinutes(t.coaching)} coaching` : ""}
            {t.focus ? ` · ${formatMinutes(t.focus)} self-study` : t.coaching ? "" : " · nothing logged yet"}
          </p>
        </div>
        {plan ? (
          <button
            onClick={() => {
              buzz();
              setSettings({ coaching: toggleDay(coaching!, t.date) });
            }}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-[12px] transition-colors ${went ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:text-fg"}`}
          >
            {went ? `✓ coaching ${plan.hours}h` : isScheduled(coaching, t.date) ? "skipped coaching" : `+ coaching ${plan.hours}h`}
          </button>
        ) : (
          <Link href="/me" className="shrink-0 rounded-full border border-line-2 px-3.5 py-1.5 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg">
            + coaching hours
          </Link>
        )}
      </div>

      <div className="mt-5 flex h-28 items-end gap-2">
        {week.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.date}: ${formatMinutes(d.focus)} self-study, ${formatMinutes(d.coaching)} coaching`}>
            <span className="font-mono text-[10.5px] text-mute">{d.total ? (d.total / 60).toFixed(1) : "–"}</span>
            {/* Self-study stacked on top of coaching. */}
            <motion.div
              className="flex w-full flex-col overflow-hidden rounded-sm"
              initial={{ height: 0 }}
              animate={{ height: `${Math.max((d.total / max) * 64, 1)}px` }}
              transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ background: d.total ? undefined : "var(--color-dot-off)" }}
            >
              <div className="bg-fg" style={{ flexGrow: d.focus }} />
              <div className="bg-dim" style={{ flexGrow: d.coaching }} />
            </motion.div>
            <span className={`font-mono text-[10px] ${d.date === t.date ? "text-fg" : "text-dim"}`}>{new Date(d.date + "T00:00").toLocaleDateString([], { weekday: "narrow" })}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-dim">
        <span>avg {formatMinutes(Math.round(weekTotal / 7))}/day · hours per day</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-fg" /> self-study
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-dim" /> coaching
        </span>
      </div>
    </Section>
  );
}

function TestSeries() {
  const tests = useProgress((s) => s.tests);
  const sum = seriesSummary(tests);
  const lowest = sum.lowest.slice(0, 3);
  return (
    <Section label="mathongo tests" right={`${sum.done}/${sum.total} done`}>
      <div className="flex items-center gap-4">
        <DotText className={`text-3xl leading-none`}>{sum.avg != null ? `${Math.round(sum.avg)}%` : "–"}</DotText>
        <div className="min-w-0 flex-1">
          <DotBar value={sum.total ? sum.done / sum.total : 0} dots="auto" size={4} />
          <p className="mt-2 font-mono text-[12px] text-dim">{sum.avg != null ? "average score" : "log a score on any chapter page"} · {sum.total - sum.done} tests left</p>
        </div>
      </div>
      {lowest.length > 0 && (
        <div className="mt-4">
          <Label className="mb-1">lowest scores · retest these</Label>
          {lowest.map((p) => (
            <Link key={p.track.id} href={`/c/${p.track.chapterIds[0]}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-ink-2">
              <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[p.track.subject] }} />
              <span className="min-w-0 flex-1 truncate text-[15px]">{p.track.name}</span>
              <span className="font-mono text-[12px]" style={{ color: scoreTone(p.avg) }}>
                {Math.round(p.avg!)}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Today's scheduled chapters (plus anything overdue), and spaced-repetition revisions not planned yet. */
function TodayPlan() {
  const { plan, chapters, settings, schedule } = useProgress();
  const t = today();
  const items = [...overdue(plan, t), ...onDay(plan, t).sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt))];
  const planned = new Set(live(plan).filter((i) => !i.doneAt).map((i) => i.chapterId));
  const unplanned = revisionsDue(chapters, settings.exam).filter((d) => !planned.has(d.chapter.id));
  const done = items.filter((i) => i.doneAt).length;
  return (
    <Section
      label="today's plan"
      right={
        <Link href="/plan" className="hover:text-fg">
          {items.length ? `${done}/${items.length} done · ` : ""}planner →
        </Link>
      }
    >
      {items.length === 0 && <p className="font-mono text-[13px] text-dim">nothing scheduled today. plan revisions on any chapter page or in the planner.</p>}
      <AnimatePresence initial={false}>
        {items.map((i) => (
          <PlanItemRow key={i.id} item={i} t={t} />
        ))}
      </AnimatePresence>
      {unplanned.length > 0 && (
        <div className="mt-3 border-t border-line/60 pt-3">
          <Label className="mb-1">due for revision · not planned</Label>
          {unplanned.slice(0, 3).map(({ chapter, revisions }) => (
            <div key={chapter.id} className="flex items-center gap-3 py-1.5">
              <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[chapter.subject] }} />
              <Link href={`/c/${chapter.id}`} className="min-w-0 flex-1 truncate text-[15px]">
                {chapter.name}
              </Link>
              <span className="font-mono text-[12px] text-dim">rev {revisions + 1}</span>
              <button onClick={() => schedule([{ chapterId: chapter.id, date: t }])} className="rounded-full border border-line-2 px-3 py-1 font-mono text-[12px] text-mute transition hover:border-fg hover:text-fg">
                + today
              </button>
            </div>
          ))}
          {unplanned.length > 3 && (
            <Link href="/plan" className="mt-1 inline-block font-mono text-[12px] text-mute hover:text-fg">
              +{unplanned.length - 3} more · plan my week →
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}

function UpNext() {
  const { chapters, settings } = useProgress();
  const focusId = currentFocus(chapters, settings.exam)?.chapter.id;
  const list = freeMarks(chapters, settings.exam, 4).filter((x) => x.chapter.id !== focusId).slice(0, 3);
  if (!list.length) return null;
  return (
    <Section label="highest weightage · not started">
      {list.map(({ chapter }) => (
        <Link key={chapter.id} href={`/c/${chapter.id}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-ink-2">
          <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[chapter.subject] }} />
          <span className="min-w-0 flex-1 truncate text-[15px]">{chapter.name}</span>
          {chapter.weight?.main != null && <span className="font-mono text-[12px] text-mute">{chapter.weight.main.toFixed(1)} q/shift</span>}
        </Link>
      ))}
    </Section>
  );
}

export function Home() {
  return (
    <Page>
      <Header />
      {/* Laptops: what to do on the left, how it's going on the right. Phones: one column. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <div className="lg:col-span-7">
          <Countdown />
          <TodayPlan />
          <TodayCollege />
          <Now />
          <Syllabus />
        </div>
        <div className="lg:col-span-5">
          <WeekCollege />
          <Rhythm />
          <StudyTime />
          <TestSeries />
          <UpNext />
        </div>
      </div>
    </Page>
  );
}
