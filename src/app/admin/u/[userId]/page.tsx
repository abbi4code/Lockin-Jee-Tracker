import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/admin/Charts";
import { STUDY_SERIES, studyColumns } from "@/components/admin/columns";
import { Block, Empty, fmtDay, hours, MeterRow, SUBJECT_NAME, Tile, Tiles } from "@/components/admin/StudentParts";
import { attention, chapterInsights, collegeInsights, loadStudent, questionInsights, studyInsights, testInsights } from "@/lib/admin-student";

export const metadata: Metadata = { title: "Student", robots: { index: false } };

/** The main screen: the five numbers that matter, the last two weeks, and what needs a nudge. */
export default async function Overview({ params }: PageProps<"/admin/u/[userId]">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const study = studyInsights(s);
  const q = questionInsights(s);
  const t = testInsights(s);
  const c = collegeInsights(s);
  const ch = chapterInsights(s);
  const a = attention(s);
  const base = `/admin/u/${s.id}`;
  const days14 = study.days30.slice(-14);

  return (
    <>
      <Tiles>
        <Tile label="studied this week" value={hours(study.week)} sub={`today ${hours(study.today.total)} · all time ${hours(study.focusAll + study.coachingAll)}`} href={`${base}/study`} tone={study.today.total === 0 ? "red" : undefined} />
        <Tile label="questions this week" value={q.week} sub={`today ${q.today.total} · all time ${q.allTime}`} href={`${base}/questions`} />
        <Tile label="tests given" value={t.given} sub={t.avg != null ? `avg ${Math.round(t.avg)}% · last 5 ${Math.round(t.last5!)}%` : "no scores yet"} href={`${base}/tests`} />
        <Tile
          label="college · form"
          value={c.form.level ? `L${c.form.level.n}` : "–"}
          sub={c.form.level ? `${c.form.level.college.short} · today ${c.today.college?.short ?? "–"}` : "no data yet"}
          href={`${base}/college`}
        />
        <Tile label="chapters studied" value={`${ch.overall.done}/${ch.overall.total}`} sub={`${Math.round(ch.overall.percent)}% of topics · ${ch.working.length} in progress`} href={`${base}/chapters`} />
        <Tile label="streak" value={a.streak.days} sub={`${a.weekDays - a.inactive7}/${a.weekDays} days active this week`} tone={a.streak.atRisk ? "red" : undefined} />
      </Tiles>

      <div className="mt-6 grid gap-x-14 lg:grid-cols-12">
        <Block title="study · last 14 days" right={<Link href={`${base}/study`} className="hover:text-fg">study time →</Link>} className="lg:col-span-7">
          <ColumnChart columns={studyColumns(days14, s.today, 2)} series={STUDY_SERIES} caption={`${hours(days14.reduce((n, d) => n + d.total, 0))} in 14 days · hover a day for details`} unit="minutes" />
        </Block>

        <Block title="needs attention" className="lg:col-span-5">
          <ul className="space-y-2.5 text-[14.5px]">
            {a.overduePlan.length > 0 && (
              <li className="flex justify-between gap-3">
                <span>{a.overduePlan.length} planned item{a.overduePlan.length === 1 ? "" : "s"} overdue</span>
                <Link href={`${base}/plan`} className="font-mono text-[12px] text-red">plan →</Link>
              </li>
            )}
            {a.revisionsDue.length > 0 && (
              <li className="flex justify-between gap-3">
                <span>{a.revisionsDue.length} revision{a.revisionsDue.length === 1 ? "" : "s"} due</span>
                <Link href={`${base}/chapters`} className="font-mono text-[12px] text-mute hover:text-fg">chapters →</Link>
              </li>
            )}
            {a.openWeak.length > 0 && (
              <li className="flex justify-between gap-3">
                <span>{a.openWeak.length} open weak spot{a.openWeak.length === 1 ? "" : "s"}</span>
                <Link href={`${base}/notes`} className="font-mono text-[12px] text-mute hover:text-fg">notes →</Link>
              </li>
            )}
            {a.shaky.length > 0 && (
              <li className="flex justify-between gap-3">
                <span>
                  {a.shaky.length} chapter{a.shaky.length === 1 ? "" : "s"} rated shaky / cooked <span className="text-mute">({a.shaky.slice(0, 2).map((x) => x.name).join(", ")}{a.shaky.length > 2 ? "…" : ""})</span>
                </span>
                <Link href={`${base}/chapters`} className="shrink-0 font-mono text-[12px] text-mute hover:text-fg">chapters →</Link>
              </li>
            )}
            {a.inactive7 >= 3 && (
              <li className="text-red">
                no activity on {a.inactive7} of the last {a.weekDays} days
              </li>
            )}
            {q.daysOnTarget30 === 0 && q.allTime > 0 && <li>hasn&apos;t hit the {q.target}-question target yet</li>}
          </ul>
          {!a.overduePlan.length && !a.revisionsDue.length && !a.openWeak.length && !a.shaky.length && a.inactive7 < 3 && <Empty>nothing flagged. he&apos;s on it.</Empty>}
          {c.best && c.best.score > 0 && (
            <p className="mt-5 font-mono text-[12px] text-dim">
              best day in 30: {fmtDay(c.best.date)} · level {c.best.level} ({c.best.college?.short})
            </p>
          )}
        </Block>
      </div>

      <Block title="syllabus by subject" right={<Link href={`${base}/chapters`} className="hover:text-fg">chapters →</Link>}>
        {ch.bySubject.map((x) => (
          <MeterRow key={x.id} label={SUBJECT_NAME[x.id]} subject={x.id} fraction={x.percent / 100} value={`${x.done}/${x.total} · ${Math.round(x.percent)}%`} />
        ))}
        <p className="mt-3 font-mono text-[11.5px] text-dim">a chapter counts as studied from &quot;test ready&quot; onwards.</p>
      </Block>
    </>
  );
}
