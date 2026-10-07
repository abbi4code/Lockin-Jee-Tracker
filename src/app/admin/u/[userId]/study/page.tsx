import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ColumnChart } from "@/components/admin/Charts";
import { STUDY_SERIES, studyColumns } from "@/components/admin/columns";
import { Block, Empty, fmtDay, hours, MeterRow, SUBJECT_NAME, Tile, Tiles } from "@/components/admin/StudentParts";
import { getChapter, SUBJECT_COLOR } from "@/data";
import { DEFAULT_TARGETS } from "@/lib/college";
import { loadStudent, studyInsights } from "@/lib/admin-student";

export const metadata: Metadata = { title: "Study time", robots: { index: false } };

export default async function Study({ params }: PageProps<"/admin/u/[userId]/study">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = studyInsights(s);
  const target = (s.settings?.targets?.hoursOff ?? DEFAULT_TARGETS.hoursOff) * 60;
  const maxSubject = Math.max(...x.bySubject.map((b) => b.minutes), 1);
  const maxChapter = Math.max(...x.topChapters.map((b) => b.minutes), 1);

  return (
    <>
      <Tiles>
        <Tile label="today" value={hours(x.today.total)} sub={x.today.coaching ? `${hours(x.today.coaching)} of it coaching` : "self-study only"} tone={x.today.total === 0 ? "red" : undefined} />
        <Tile label="this week" value={hours(x.week)} sub="last 7 days, incl. coaching" />
        <Tile label="last 30 days" value={hours(x.month)} sub={`avg ${hours(x.avg30)} a day`} />
        <Tile label="active days" value={`${x.activeDays30}/${x.window}`} sub={x.window < 30 ? "since joining" : "last 30 days"} />
        <Tile label="best day" value={x.best?.total ? hours(x.best.total) : "–"} sub={x.best?.total ? fmtDay(x.best.date) : "in the last 30 days"} />
        <Tile label="all time" value={hours(x.focusAll + x.coachingAll)} sub={`${hours(x.focusAll)} self-study · ${hours(x.coachingAll)} coaching`} />
      </Tiles>

      <Block title="hours per day · last 30 days" className="mt-6">
        <ColumnChart
          columns={studyColumns(x.days30, s.today)}
          series={STUDY_SERIES}
          caption={`${hours(x.month)} in 30 days · line = ${target / 60}h daily target (non-coaching days)`}
          reference={{ value: target, label: `${target / 60}h target` }}
          unit="minutes"
          height={180}
        />
      </Block>

      <div className="grid gap-x-14 lg:grid-cols-2">
        <Block title="self-study by subject" right="focus-timer sessions, all time">
          {x.bySubject.map((b) => (
            <MeterRow key={b.id} label={SUBJECT_NAME[b.id]} subject={b.id} fraction={b.minutes / maxSubject} value={hours(b.minutes)} />
          ))}
          {x.general > 0 && <MeterRow label="general (no chapter)" fraction={x.general / maxSubject} value={hours(x.general)} />}
        </Block>
        <Block title="most time on" right="top chapters">
          {x.topChapters.length ? (
            x.topChapters.map((c) => <MeterRow key={c.id} label={c.name} subject={c.subject} fraction={c.minutes / maxChapter} value={hours(c.minutes)} />)
          ) : (
            <Empty>no focus sessions tied to a chapter yet.</Empty>
          )}
        </Block>
      </div>

      <Block title="recent focus sessions" right={`since ${fmtDay(x.since)}`}>
        {x.sessions.length === 0 ? (
          <Empty>no focus sessions yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead className="font-mono text-[11px] text-dim uppercase">
                <tr>
                  <th className="py-2 font-normal">when</th>
                  <th className="py-2 font-normal">chapter</th>
                  <th className="py-2 font-normal">mode</th>
                  <th className="py-2 text-right font-normal">length</th>
                </tr>
              </thead>
              <tbody>
                {x.sessions.map((r) => {
                  const c = r.chapterId ? getChapter(r.chapterId) : null;
                  return (
                    <tr key={r.id} className="border-t border-line/60">
                      <td className="py-2 pr-3 font-mono text-[12px] text-dim">{new Date(r.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                      <td className="py-2 pr-3">
                        {c && <span className="mr-2 inline-block size-1.5 rounded-full align-middle" style={{ background: SUBJECT_COLOR[c.subject] }} />}
                        {c?.name ?? <span className="text-mute">general study</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-mute">{r.mode}</td>
                      <td className="py-2 text-right font-mono text-[13px]">{hours(r.minutes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </>
  );
}
