import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/admin/Charts";
import { weekColumns } from "@/components/admin/columns";
import { Block, Empty, fmtDay, hours, MeterRow, Tile, Tiles } from "@/components/admin/StudentParts";
import { collegeInsights, loadStudent } from "@/lib/admin-student";
import { BENCHMARKS, cutoffText, formatRank, LADDER, rankHeight, STREAK_HOURS, TYPE_LABEL } from "@/lib/college";

export const metadata: Metadata = { title: "College", robots: { index: false } };

export default async function College({ params }: PageProps<"/admin/u/[userId]/college">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = collegeInsights(s);
  const w = x.week;
  const shown = w.empty ? x.lastWeek : w;

  return (
    <>
      <section className="pb-8">
        <div className="font-mono text-[11px] tracking-[0.14em] text-mute uppercase">{w.empty ? "last week ended at" : `this week so far · ${w.days.length} of 7 days`}</div>
        <div className="mt-3 text-[40px] leading-tight font-semibold tracking-tight lg:text-[56px]">{shown.empty || !shown.college ? "–" : shown.college.short}</div>
        <p className="mt-2 font-mono text-[13px] text-mute">
          {shown.empty || !shown.college ? "nothing logged yet" : `${shown.college.branch} · ${TYPE_LABEL[shown.college.type]} · ${cutoffText(shown.college)} · predicted rank ~${formatRank(shown.rank)} (${shown.percentile.toFixed(1)} %ile)`}
        </p>
        <p className="mt-3 max-w-2xl text-[14px] text-dim">
          Each Mon–Sun week becomes a predicted JEE Main rank: his daily hours (coaching included), questions and recent test scores are each compared with what students at each rank typically put in, then
          combined (hours 40%, questions 30%, tests 30% once he has 3 tests in 4 weeks; with fewer tests that part counts less and hours and questions carry the rest). Days with {STREAK_HOURS}h+ improve the rank a little, a full week and strong weeks in a row more.
          The college is the best one that rank actually got in 2025. Motivation, not a forecast.
        </p>
      </section>

      <Tiles>
        <Tile label="this week" value={w.empty ? "–" : `~${formatRank(w.rank)}`} sub={w.empty ? "nothing logged yet" : `${w.college?.short} · ${w.college?.branch}`} />
        <Tile label="last week" value={x.lastWeek.empty ? "–" : `~${formatRank(x.lastWeek.rank)}`} sub={x.lastWeek.empty ? "nothing logged" : `${x.lastWeek.college?.short} · ${x.lastWeek.college?.branch}`} />
        <Tile label="best week · 12" value={x.best ? `~${formatRank(x.best.rank)}` : "–"} sub={x.best ? `${x.best.college?.short} · week of ${fmtDay(x.best.start)}` : "no finished week yet"} />
        <Tile label="streak days · this week" value={`${w.streakDays}/${w.days.length}`} sub={`${STREAK_HOURS}h+ days · ${w.weekStreak} strong week${w.weekStreak === 1 ? "" : "s"} in a row before`} />
        <Tile label="colleges reached" value={x.unlocked.size} sub={`of ${LADDER.length} on the ladder`} />
        <Tile label="next up" value={x.next ? `~${formatRank(x.next.college.rank)}` : "top"} sub={x.next ? `${x.next.college.short} · ${x.next.minutes != null ? `+${hours(x.next.minutes)}/day` : ""}${x.next.minutes != null && x.next.questions != null ? " or " : ""}${x.next.questions != null ? `+${x.next.questions} q/day` : ""}` : "nothing above"} />
      </Tiles>

      <Block title="predicted rank by week · last 12" className="mt-6">
        {x.history.length ? (
          <ColumnChart columns={weekColumns([...x.history].reverse())} series={[{ name: "rank", color: "var(--color-fg)" }]} caption="taller = better rank (log scale) · hover a week" unit="rank" height={170} />
        ) : (
          <Empty>no finished week yet.</Empty>
        )}
      </Block>

      <div className="grid gap-x-14 lg:grid-cols-12">
        <Block title="this week, part by part" className="lg:col-span-5" right={w.empty ? "nothing yet" : `before bonus ~${formatRank(w.baseRank)}`}>
          <MeterRow label="hours / day" fraction={rankHeight(w.hours.rank)} value={`${hours(w.hours.value * 60)} · like ~${formatRank(w.hours.rank)}`} />
          <MeterRow label="questions / day" fraction={rankHeight(w.questions.rank)} value={`${Math.round(w.questions.value)} · like ~${formatRank(w.questions.rank)}`} />
          <MeterRow label="tests · 4 wks" fraction={w.tests ? rankHeight(w.tests.rank) : 0} value={w.tests ? `${Math.round(w.tests.value)}% (${w.tests.count}) · like ~${formatRank(w.tests.rank)}` : "none · not counted"} />
          <p className="mt-3 font-mono text-[11.5px] text-dim">
            streak bonus ×{w.bonus.toFixed(2)} on the rank ({w.streakDays} streak day{w.streakDays === 1 ? "" : "s"}
            {w.weekStreak ? `, ${w.weekStreak} strong week${w.weekStreak === 1 ? "" : "s"} before` : ""})
          </p>
          <div className="mt-6 font-mono text-[11px] text-dim">
            <div className="mb-1 uppercase">benchmarks · per day</div>
            {BENCHMARKS.slice(0, -1).map((b) => (
              <div key={b.rank} className="flex gap-3 py-px">
                <span className="w-20 text-right">~{formatRank(b.rank)}</span>
                <span>{b.hours}h · {b.questions} q · {b.tests}% tests</span>
              </div>
            ))}
          </div>
        </Block>

        <Block title="the ladder around him" className="lg:col-span-7" right={`${LADDER.length} college-branches · ✓ reached`}>
          {x.around.map((c, i) => {
            const pos = x.at - Math.min(x.at, 6) + i;
            const here = pos === x.at && !w.empty;
            return (
              <div key={c.id} className={`flex items-center gap-3 py-1 text-[13.5px] ${here ? "text-fg" : "text-mute"}`}>
                <span className="w-16 text-right font-mono text-[11px] text-dim">~{formatRank(c.rank)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {c.short} <span className="text-dim">· {c.branch} · {TYPE_LABEL[c.type]}</span>
                </span>
                {here && <span className="size-1.5 rounded-full bg-red" title="this week" />}
                <span className="w-3 font-mono text-[11px]">{x.unlocked.has(c.id) ? "✓" : ""}</span>
              </div>
            );
          })}
          <p className="mt-2 font-mono text-[11.5px] text-dim">left = closing rank on the JEE Main scale (estimates for own-exam colleges) · red dot = this week</p>
        </Block>
      </div>
    </>
  );
}
