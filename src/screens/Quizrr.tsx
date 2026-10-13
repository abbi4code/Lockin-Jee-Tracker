"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ScoreLine } from "../components/admin/Charts";
import { formatLine, QuizrrEditor, QuizrrListRow, Readiness, ScoreBlock, SyllabusList, useTestStatus } from "../components/Quizrr";
import { Page } from "../components/Shell";
import { DotBar, DotText, fadeUp, Label, Section, Tag } from "../components/ui";
import { SUBJECT_COLOR, type SubjectId } from "../data";
import { dayLabel } from "../lib/plan";
import {
  ACTIVE_SERIES,
  ACTIVE_TESTS,
  attemptFor,
  dueQuizrr,
  findTest,
  fmtRelease,
  getActiveSeries,
  getQuizrrTest,
  nextQuizrr,
  quizrrPct,
  QUIZRR_SERIES,
  QUIZRR_TESTS,
  scheduleOrder,
  seriesHref,
  seriesProgress,
  testHref,
  testName,
  type QuizrrTest,
  type SeriesId,
} from "../lib/quizrr";
import { scoreTone } from "../lib/tests";
import { today, useProgress } from "../store/progress";

// Three levels so no page shows everything at once: /quizrr (overview), /quizrr/qrt (one series),
// /quizrr/qrt/1 (one test: syllabus and score).

const SUBJECTS: { id: SubjectId; name: string }[] = [
  { id: "physics", name: "Physics" },
  { id: "chemistry", name: "Chemistry" },
  { id: "maths", name: "Maths" },
];

function Back({ href, children }: { href: string; children: ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="pb-6">
      <Link href={href} className="inline-flex items-center gap-1.5 font-mono text-[12px] text-mute transition hover:text-fg">
        <ArrowLeft className="size-3.5" /> {children}
      </Link>
    </motion.div>
  );
}

/** "QRT 1" with the number in dot-matrix. */
const Name = ({ test }: { test: QuizrrTest }) => (
  <>
    {test.series.toUpperCase()} <DotText>{test.no}</DotText>
  </>
);

// ── /quizrr ─────────────────────────────────────────────────────────────

/** Today's (or a missed) test, big; otherwise the next one. */
function UpNext() {
  const { quizrr, quizrrDates } = useProgress();
  const t = today();
  const due = dueQuizrr(quizrr, quizrrDates, t);
  const head = due.find((d) => d.date === t) ?? due[0];
  const item = head ?? nextQuizrr(quizrr, quizrrDates, t);
  if (!item) return null;
  const late = item.date < t;
  return (
    <Section label={head ? (late ? "missed · take it next" : "today's test") : "next test"} right={due.length > 1 ? `${due.length - 1} more missed` : undefined}>
      <Link href={testHref(item.test)} className="group flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[30px] leading-none font-semibold tracking-tight lg:text-[40px]">
            <Name test={item.test} />
          </div>
          <p className={`mt-2 font-mono text-[12.5px] ${late ? "text-red" : "text-mute"}`}>
            {late ? `was due ${dayLabel(item.date, t)}` : dayLabel(item.date, t)} · {formatLine(item.test)}
          </p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-medium ${head ? "bg-fg text-ink" : "border border-line-2 text-mute group-hover:text-fg"}`}>
          {head ? "open · log score" : "see syllabus"} <ArrowRight className="size-3.5" />
        </span>
      </Link>
    </Section>
  );
}

/** One block per series: progress, finish-by, average, and its next test. */
function SeriesCards() {
  const { quizrr, quizrrDates } = useProgress();
  const t = today();
  return (
    <Section label="series">
      <div className="divide-y divide-line/60">
        {ACTIVE_SERIES.map((s) => {
          const p = seriesProgress(s.id, quizrr, quizrrDates);
          const next = nextQuizrr(quizrr, quizrrDates, t, s.id);
          const missed = dueQuizrr(quizrr, quizrrDates, t).filter((d) => d.test.series === s.id && d.date < t).length;
          return (
            <Link key={s.id} href={seriesHref(s.id)} className="group -mx-2 block rounded-lg px-2 py-5 transition hover:bg-ink-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[24px] font-semibold tracking-tight">{s.name}</span>
                <span className="text-[15px] text-mute">{s.title}</span>
                {missed > 0 && <Tag tone="red">{missed} missed</Tag>}
                <span className="ml-auto flex items-center gap-1 font-mono text-[12.5px] text-mute group-hover:text-fg">
                  {p.total} tests <ChevronRight className="size-4" />
                </span>
              </div>
              <div className="mt-3">
                <DotBar value={p.done / p.total} dots={p.total} size={7} gap={5} />
              </div>
              <p className="mt-3 font-mono text-[12.5px] text-dim">
                <span className="text-fg">
                  {p.done}/{p.total} done
                </span>
                {p.finishBy && ` · last one ${dayLabel(p.finishBy, t)}`}
                {p.avg != null && (
                  <>
                    {" · "}
                    <span style={{ color: scoreTone(p.avg) }}>avg {Math.round(p.avg)}%</span>
                  </>
                )}
                {next && ` · next ${testName(next.test).toLowerCase()} ${dayLabel(next.date, t)}`}
              </p>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

/** Full tests aren't scheduled yet: one line per series. */
function ComingSoon() {
  return (
    <Section label="coming soon">
      {QUIZRR_SERIES.filter((s) => !s.active).map((s) => {
        const tests = QUIZRR_TESTS.filter((t) => t.series === s.id);
        return (
          <div key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line/60 py-4 first:border-t-0 first:pt-1">
            <span className="text-[18px] font-semibold tracking-tight text-mute">{s.name}</span>
            <span className="text-[14.5px] text-mute">
              {tests.length} {s.title}
            </span>
            <span className="font-mono text-[12px] text-dim">{formatLine(tests[0])}</span>
            <Tag>coming soon</Tag>
          </div>
        );
      })}
    </Section>
  );
}

/** Right panel: overall progress, average, the trend, and how each subject is going. */
function Summary() {
  const { quizrr } = useProgress();
  const taken = ACTIVE_TESTS.map((t) => ({ t, a: attemptFor(t.id, quizrr) })).filter((x): x is { t: QuizrrTest; a: NonNullable<typeof x.a> } => !!x.a);
  const scored = taken.filter((x) => quizrrPct(x.a) != null).sort((x, y) => (x.a.takenOn ?? "").localeCompare(y.a.takenOn ?? ""));
  const avg = scored.length ? scored.reduce((n, x) => n + quizrrPct(x.a)!, 0) / scored.length : null;
  // Per subject: marks as a share of that subject's third of the paper.
  const bySubject = SUBJECTS.map((s) => {
    const xs = taken.filter((x) => x.a[s.id] != null && x.a.maxScore);
    return { ...s, avg: xs.length ? xs.reduce((n, x) => n + (x.a[s.id]! / (x.a.maxScore! / 3)) * 100, 0) / xs.length : null };
  });
  return (
    <>
      <Section label="scores" right={`${taken.length}/${ACTIVE_TESTS.length} taken`}>
        <div className="flex items-baseline gap-3">
          <DotText className="text-[44px] leading-none">{avg != null ? `${Math.round(avg)}%` : "–"}</DotText>
          <span className="font-mono text-[12px] text-mute">{avg != null ? "average" : "log your first score"}</span>
        </div>
        <div className="mt-4">
          <DotBar value={taken.length / ACTIVE_TESTS.length} dots="auto" size={4} />
        </div>
        <p className="mt-2 font-mono text-[12px] text-dim">counts toward your weekly college, like mathongo tests.</p>
        {scored.length >= 2 && (
          <div className="mt-5">
            <ScoreLine
              height={120}
              points={scored.map(({ t, a }) => ({ key: a.id, value: Math.max(0, quizrrPct(a)!), tip: `${testName(t)} · ${a.takenOn ? dayLabel(a.takenOn, today()) : "undated"} · ${a.score}/${a.maxScore} (${Math.round(quizrrPct(a)!)}%)` }))}
              caption={`${scored.length} scored · hover a dot`}
            />
          </div>
        )}
      </Section>
      <Section label="by subject">
        {bySubject.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-1.5">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: SUBJECT_COLOR[s.id] }} aria-hidden />
            <span className="w-24 shrink-0 text-[14.5px]">{s.name}</span>
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <DotBar value={Math.max(0, (s.avg ?? 0) / 100)} dots="auto" size={4} />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-[12.5px]" style={{ color: scoreTone(s.avg) }}>
              {s.avg != null ? `${Math.round(s.avg)}%` : "–"}
            </span>
          </div>
        ))}
        <p className="mt-2 font-mono text-[12px] text-dim">from the subject marks you log</p>
      </Section>
    </>
  );
}

export function QuizrrScreen() {
  const router = useRouter();
  // Old links (/quizrr#qrt-1) go to the test's own page.
  useEffect(() => {
    const t = getQuizrrTest(decodeURIComponent(window.location.hash.slice(1)));
    if (t) router.replace(testHref(t));
  }, [router]);

  return (
    <Page>
      <motion.header variants={fadeUp} className="pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>mathongo</Tag>
          <Tag>test series</Tag>
        </div>
        <h1 className="mt-4 text-[30px] leading-[1.08] font-semibold tracking-tight sm:text-[38px] lg:text-[48px]">quizrr tests</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-mute">Take each one on Quizrr on its day, then log the marks here. QRT first (class 11 revision), QPT mixed in. Dates are set by your bro; ask him to move one.</p>
      </motion.header>
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <div className="min-w-0 lg:col-span-8">
          <UpNext />
          <SeriesCards />
          <ComingSoon />
        </div>
        <aside className="min-w-0 lg:col-span-4">
          <div className="lg:sticky lg:top-10">
            <Summary />
          </div>
        </aside>
      </div>
    </Page>
  );
}

// ── /quizrr/[series] ────────────────────────────────────────────────────

export function QuizrrSeriesScreen({ seriesId }: { seriesId: SeriesId }) {
  const { quizrr, quizrrDates } = useProgress();
  const series = getActiveSeries(seriesId)!;
  const t = today();
  const p = seriesProgress(seriesId, quizrr, quizrrDates);
  const tests = scheduleOrder(seriesId, quizrrDates);
  const left = tests.filter((x) => !attemptFor(x.id, quizrr));
  const done = tests.filter((x) => attemptFor(x.id, quizrr));
  return (
    <Page>
      <Back href="/quizrr">quizrr tests</Back>
      <motion.header variants={fadeUp} className="pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{p.total} tests</Tag>
          <Tag>{formatLine(tests[0])}</Tag>
        </div>
        <h1 className="mt-4 text-[30px] leading-[1.08] font-semibold tracking-tight sm:text-[38px] lg:text-[48px]">
          {series.name} <span className="text-mute">· {series.title}</span>
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <DotBar value={p.done / p.total} dots={p.total} size={7} gap={5} />
          <span className="font-mono text-[12.5px] text-mute">
            {p.done}/{p.total} done{p.finishBy ? ` · last one ${dayLabel(p.finishBy, t)}` : ""}
            {p.avg != null && (
              <>
                {" · "}
                <span style={{ color: scoreTone(p.avg) }}>avg {Math.round(p.avg)}%</span>
              </>
            )}
          </span>
        </div>
      </motion.header>
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <div className="min-w-0 lg:col-span-8">
          <Section label="to take" right={`${left.length} left · in order`}>
            {left.length ? (
              <div className="divide-y divide-line/60">
                {left.map((x) => (
                  <QuizrrListRow key={x.id} test={x} />
                ))}
              </div>
            ) : (
              <p className="font-mono text-[13px] text-dim">all done. go flex.</p>
            )}
          </Section>
          {done.length > 0 && (
            <Section label="done" right={`${done.length}`}>
              <div className="divide-y divide-line/60">
                {done.map((x) => (
                  <QuizrrListRow key={x.id} test={x} />
                ))}
              </div>
            </Section>
          )}
        </div>
        <aside className="min-w-0 lg:col-span-4">
          <div className="lg:sticky lg:top-10">
            <Section label="how it works">
              <ul className="space-y-2 text-[14.5px] text-mute">
                <li>one test on the day shown. open it to see the syllabus.</li>
                <li>take it on quizrr, then log marks, subject marks and percentile.</li>
                <li>missed one? it stays red here and on today until you log it.</li>
              </ul>
            </Section>
            <Section label="other series">
              {ACTIVE_SERIES.filter((s) => s.id !== seriesId).map((s) => (
                <Link key={s.id} href={seriesHref(s.id)} className="group flex items-center justify-between py-1.5 text-[15px]">
                  <span>
                    {s.name} <span className="text-mute">· {s.title}</span>
                  </span>
                  <ChevronRight className="size-4 text-dim group-hover:text-fg" />
                </Link>
              ))}
            </Section>
          </div>
        </aside>
      </div>
    </Page>
  );
}

// ── /quizrr/[series]/[no] ───────────────────────────────────────────────

export function QuizrrTestScreen({ series, no }: { series: SeriesId; no: number }) {
  const test = findTest(series, no)!;
  const meta = getActiveSeries(series)!;
  const quizrrDates = useProgress((s) => s.quizrrDates);
  const { t, attempt, date, state, later } = useTestStatus(test);
  const [editing, setEditing] = useState(false);
  // Before/after in the order he takes them.
  const order = scheduleOrder(series, quizrrDates);
  const i = order.findIndex((x) => x.id === test.id);
  const prev = order[i - 1];
  const next = order[i + 1];
  const urgent = state === "today" || state === "overdue";

  return (
    <Page>
      <Back href={seriesHref(series)}>
        {meta.name.toLowerCase()} · {meta.title}
      </Back>
      <motion.header variants={fadeUp} className="pb-6">
        <div className="flex flex-wrap items-center gap-2">
          {state === "today" && <Tag tone="red">today</Tag>}
          {state === "overdue" && <Tag tone="red">missed</Tag>}
          {state === "done" && <Tag tone="fg">done</Tag>}
          <Tag>{formatLine(test)}</Tag>
        </div>
        <h1 className="mt-4 text-[40px] leading-none font-semibold tracking-tight lg:text-[56px]">
          <Name test={test} />
        </h1>
        <p className={`mt-3 font-mono text-[13px] ${urgent ? "text-red" : "text-mute"}`}>
          {date ? (state === "done" ? `set for ${dayLabel(date, t)}` : state === "overdue" ? `was due ${dayLabel(date, t)}` : `take it ${dayLabel(date, t)}`) : "no date yet"}
          {later && ` · opens ${fmtRelease(test.opensAt!)} ist`}
        </p>
      </motion.header>

      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <div className="min-w-0 lg:col-span-8">
          <Section label="syllabus" right={<Readiness test={test} />}>
            <SyllabusList test={test} />
          </Section>
        </div>
        <aside className="min-w-0 lg:col-span-4">
          <div className="lg:sticky lg:top-10">
            <Section label="your score">
              {attempt && !editing && (
                <button onClick={() => setEditing(true)} className="-m-1 block rounded-md p-1 text-left transition hover:bg-ink-2" aria-label="fix this score">
                  <ScoreBlock a={attempt} big />
                  <span className="mt-3 block font-mono text-[12px] text-dim">taken {attempt.takenOn ? dayLabel(attempt.takenOn, t) : "–"} · tap to fix</span>
                </button>
              )}
              {!attempt && !editing && (
                <div>
                  {later ? (
                    <p className="font-mono text-[13px] text-dim">opens {fmtRelease(test.opensAt!)}. log it after you take it.</p>
                  ) : (
                    <button
                      onClick={() => setEditing(true)}
                      data-cursor="go"
                      className={`rounded-full px-4 py-2 text-[14px] font-medium ${urgent ? "bg-fg text-ink" : "border border-line-2 text-mute hover:border-fg hover:text-fg"}`}
                    >
                      took it? log score
                    </button>
                  )}
                </div>
              )}
              <AnimatePresence>{editing && <QuizrrEditor test={test} existing={attempt} onClose={() => setEditing(false)} />}</AnimatePresence>
            </Section>
            <Section label="in order">
              <div className="grid grid-cols-2 gap-4">
                {prev ? <NearTest test={prev} dir="before" /> : <span />}
                {next ? <NearTest test={next} dir="after" /> : <span />}
              </div>
            </Section>
          </div>
        </aside>
      </div>
    </Page>
  );
}

function NearTest({ test, dir }: { test: QuizrrTest; dir: "before" | "after" }) {
  const { date, t, attempt } = useTestStatus(test);
  const after = dir === "after";
  return (
    <Link href={testHref(test)} className={`group block ${after ? "text-right" : ""}`}>
      <Label>{dir}</Label>
      <span className={`mt-1 flex items-center gap-1 text-[16px] font-semibold tracking-tight ${after ? "justify-end" : ""}`}>
        {!after && <ArrowLeft className="size-3.5 text-dim group-hover:text-fg" />}
        <Name test={test} />
        {after && <ArrowRight className="size-3.5 text-dim group-hover:text-fg" />}
      </span>
      <span className="font-mono text-[12px] text-dim">{attempt ? "done" : date ? dayLabel(date, t) : "no date"}</span>
    </Link>
  );
}
