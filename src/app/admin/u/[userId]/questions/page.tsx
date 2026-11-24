import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/admin/Charts";
import { QUESTION_SERIES, questionColumns } from "@/components/admin/columns";
import { Block, fmtDay, MeterRow, SUBJECT_NAME, Tile, Tiles } from "@/components/admin/StudentParts";
import { loadStudent, questionInsights } from "@/lib/admin-student";
import { formatPace } from "@/lib/focus";

export const metadata: Metadata = { title: "Questions", robots: { index: false } };

export default async function Questions({ params }: PageProps<"/admin/u/[userId]/questions">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = questionInsights(s);
  const maxSubject = Math.max(...x.bySubject.map((b) => b.count), 1);

  return (
    <>
      <Tiles>
        <Tile label="today" value={x.today.total} sub={`target ${x.target}`} tone={x.today.total === 0 ? "red" : undefined} />
        <Tile label="this week" value={x.week} sub={`avg ${Math.round(x.week / 7)} a day`} />
        <Tile label="last 30 days" value={x.month} sub={`avg ${Math.round(x.month / x.window)} a day`} />
        <Tile label="days on target" value={`${x.daysOnTarget30}/${x.window}`} sub={`days with ${x.target}+ questions`} />
        <Tile label="best day" value={x.best?.total ?? "–"} sub={x.best ? fmtDay(x.best.date) : "nothing logged yet"} />
        <Tile label="all time" value={x.allTime} sub={`${x.fromFocus} in focus sessions · ${x.fromTests} in tests`} />
      </Tiles>

      <Block title="questions per day · last 30 days" className="mt-6">
        <ColumnChart
          columns={questionColumns(x.days30, s.today)}
          series={QUESTION_SERIES}
          caption={`${x.month} questions in 30 days · line = ${x.target}/day target`}
          reference={{ value: x.target, label: `${x.target} target` }}
          unit="count"
          height={180}
        />
      </Block>

      <Block title="in focus sessions · last 30 days" right={x.focus.pending ? `${x.focus.pending} not answered yet` : undefined}>
        {x.focus.hit + x.focus.short === 0 && x.focus.solved === 0 ? (
          <p className="font-mono text-[12.5px] text-dim">no questions logged in focus sessions yet. he sets an aim before a session and says how many he solved when it ends.</p>
        ) : (
          <>
            <MeterRow label="aims hit" fraction={x.focus.hit / Math.max(1, x.focus.hit + x.focus.short)} value={`${x.focus.hit} of ${x.focus.hit + x.focus.short} sessions`} />
            <MeterRow label="solved vs aim" fraction={x.focus.aim ? Math.min(1, x.focus.aimSolved / x.focus.aim) : 0} value={x.focus.aim ? `${x.focus.aimSolved} of ${x.focus.aim}` : "–"} />
            <p className="mt-3 font-mono text-[11.5px] text-dim">
              {x.focus.solved} solved in focus sessions{x.focus.pace ? ` · ${formatPace(x.focus.pace)} on average` : ""} · short in {x.focus.short} session{x.focus.short === 1 ? "" : "s"}
            </p>
          </>
        )}
      </Block>

      <Block title="by subject" right="counter + focus sessions, all time">
        {x.bySubject.map((b) => (
          <MeterRow key={b.id} label={SUBJECT_NAME[b.id]} subject={b.id} fraction={b.count / maxSubject} value={String(b.count)} />
        ))}
        <p className="mt-3 font-mono text-[11.5px] text-dim">focus-session questions count under the session's chapter (none for general study). questions attempted in logged tests (correct + wrong) count on the day of the test.</p>
      </Block>
    </>
  );
}
