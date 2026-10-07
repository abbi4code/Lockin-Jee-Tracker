import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/admin/Charts";
import { levelColumns } from "@/components/admin/columns";
import { Block, fmtDay, hours, MeterRow, Tile, Tiles } from "@/components/admin/StudentParts";
import { collegeInsights, loadStudent } from "@/lib/admin-student";

export const metadata: Metadata = { title: "College", robots: { index: false } };

const TIERS = [
  { name: "IITs", from: 17 },
  { name: "NITs + BITS", from: 6 },
  { name: "IIITs", from: 1 },
];

export default async function College({ params }: PageProps<"/admin/u/[userId]/college">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = collegeInsights(s);
  const d = x.todayDetail;
  const form = x.form.level;

  return (
    <>
      <section className="pb-8">
        <div className="font-mono text-[11px] tracking-[0.14em] text-mute uppercase">heading for · {x.form.days < 30 ? `form since joining (${x.form.days} day${x.form.days === 1 ? "" : "s"})` : "30-day form"}</div>
        <div className="mt-3 text-[40px] leading-tight font-semibold tracking-tight lg:text-[56px]">{form ? form.college.short : "–"}</div>
        <p className="mt-2 font-mono text-[13px] text-mute">
          {form ? `${form.college.branch} · level ${form.n} of ${x.levels.length} · average daily score ${Math.round(x.form.score)}` : "no data yet"}
        </p>
        <p className="mt-3 max-w-2xl text-[14px] text-dim">
          The level his average daily score reaches over the last 30 days, or since he joined if that&apos;s more recent (days with nothing logged count as zero). It&apos;s the app&apos;s motivation game, not a rank prediction: the score is
          hours, questions and test results against his targets.
        </p>
      </section>

      <Tiles>
        <Tile label="today" value={`L${x.today.level}`} sub={`${x.today.college?.short ?? "–"} · score ${Math.round(x.today.score)}`} />
        <Tile label="this week" value={x.week.level ? `L${x.week.level.n}` : "–"} sub={`${x.week.level?.college.short ?? "–"} · score ${Math.round(x.week.score)}`} />
        <Tile label="last week" value={x.lastWeek.level ? `L${x.lastWeek.level.n}` : "–"} sub={`${x.lastWeek.level?.college.short ?? "–"} · score ${Math.round(x.lastWeek.score)}`} />
        <Tile label="best day · 30d" value={x.best.score > 0 ? `L${x.best.level}` : "–"} sub={x.best.score > 0 ? `${x.best.college?.short} · ${fmtDay(x.best.date)}` : "nothing yet"} />
        <Tile label="colleges reached" value={x.unlocked.size} sub={`of ${x.levels.length} on the ladder, last 30 days`} />
        <Tile label="days scored" value={`${x.daysScored}/${x.form.days}`} sub={x.form.days < 30 ? "since joining" : "last 30 days"} />
      </Tiles>

      <Block title="level per day · last 30 days" className="mt-6">
        <ColumnChart columns={levelColumns(x.history, s.today)} series={[{ name: "level", color: "var(--color-fg)" }]} caption="taller = higher college · hover a day to see which" unit="level" height={170} />
      </Block>

      <div className="grid gap-x-14 lg:grid-cols-12">
        <Block title="today's score, part by part" className="lg:col-span-5" right={`score ${Math.round(d.score)}`}>
          <MeterRow label="hours" fraction={d.minutes / d.targetMinutes} value={`${hours(d.minutes)} / ${d.targetMinutes / 60}h`} />
          <MeterRow label="questions" fraction={d.questions / d.targetQuestions} value={`${d.questions} / ${d.targetQuestions}`} />
          <MeterRow label="tests · 7 days" fraction={(d.testAvg ?? 0) / 100} value={d.testAvg != null ? `${Math.round(d.testAvg)}% avg` : "none this week"} />
          <p className="mt-3 font-mono text-[11.5px] text-dim">
            weights: hours {d.weights.hours} · questions {d.weights.questions} · tests {d.weights.tests}
            {d.weights.tests === 0 ? " (no test in 7 days, so hours and questions carry it)" : ""}
          </p>
        </Block>

        <Block title="the ladder" className="lg:col-span-7" right="✓ reached in the last 30 days">
          <div className="grid gap-x-8 sm:grid-cols-3">
            {TIERS.map((tier, ti) => {
              const to = ti === 0 ? x.levels.length : TIERS[ti - 1].from - 1;
              const levels = x.levels.filter((l) => l.n >= tier.from && l.n <= to).reverse();
              return (
                <div key={tier.name} className="mb-4">
                  <div className="mb-2 font-mono text-[11px] text-dim uppercase">{tier.name}</div>
                  {levels.map((l) => {
                    const reached = x.unlocked.has(l.college.short);
                    const isForm = form?.n === l.n;
                    return (
                      <div key={l.n} className={`flex items-center gap-2 py-0.5 text-[13.5px] ${reached ? "text-fg" : "text-dim"}`}>
                        <span className="w-6 font-mono text-[11px] text-dim">{l.n}</span>
                        <span className="min-w-0 flex-1 truncate">{l.college.short}</span>
                        {isForm && <span className="size-1.5 rounded-full bg-red" title="30-day form" />}
                        <span className="w-6 text-right font-mono text-[11px] text-dim">{l.min}</span>
                        <span className="w-3 font-mono text-[11px]">{reached ? "✓" : ""}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="font-mono text-[11.5px] text-dim">right column = daily score needed · red dot = his 30-day form</p>
        </Block>
      </div>
    </>
  );
}
