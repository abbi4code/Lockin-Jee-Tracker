import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Block, Empty, fmtDay, Tile, Tiles } from "@/components/admin/StudentParts";
import { getChapter, SUBJECT_COLOR } from "@/data";
import { loadStudent } from "@/lib/admin-student";
import { addDays, KIND_LABEL, type PlanItem } from "@/lib/plan";

export const metadata: Metadata = { title: "Plan", robots: { index: false } };

function Row({ i, late }: { i: PlanItem; late?: boolean }) {
  const c = getChapter(i.chapterId);
  return (
    <div className="flex items-center gap-3 py-1.5 text-[14.5px]">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: c ? SUBJECT_COLOR[c.subject] : "var(--color-dim)" }} />
      <span className={`min-w-0 flex-1 truncate ${i.doneAt ? "text-dim line-through decoration-dim" : ""}`}>{c?.name ?? i.chapterId}</span>
      <span className="font-mono text-[12px] text-dim">{KIND_LABEL[i.kind]}</span>
      <span className={`w-24 text-right font-mono text-[12px] ${late ? "text-red" : "text-mute"}`}>{i.doneAt ? "done" : late ? fmtDay(i.date) : ""}</span>
    </div>
  );
}

export default async function Plan({ params }: PageProps<"/admin/u/[userId]/plan">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  if (!s.planAvailable) {
    return <Empty>the planner&apos;s database table isn&apos;t set up yet: run supabase/migrations/20261006000000_plan_reminders.sql in the Supabase SQL editor.</Empty>;
  }
  const t = s.today;
  const past14 = s.plan.filter((i) => i.date < t && i.date >= addDays(t, -14));
  const doneOnTime = past14.filter((i) => i.doneAt).length;
  const overdue = s.plan.filter((i) => !i.doneAt && i.date < t).sort((a, b) => a.date.localeCompare(b.date));
  const today = s.plan.filter((i) => i.date === t);
  const upcoming = Array.from({ length: 14 }, (_, k) => addDays(t, k + 1)).map((d) => ({ d, items: s.plan.filter((i) => i.date === d) })).filter((x) => x.items.length);
  const r = s.settings?.reminders;

  return (
    <>
      <Tiles>
        <Tile label="today" value={`${today.filter((i) => i.doneAt).length}/${today.length}`} sub="planned items done" />
        <Tile label="overdue" value={overdue.length} sub="planned, missed, not done" tone={overdue.length ? "red" : undefined} />
        <Tile label="next 14 days" value={upcoming.reduce((n, x) => n + x.items.length, 0)} sub="items scheduled" />
        <Tile label="done · last 14 days" value={past14.length ? `${Math.round((doneOnTime / past14.length) * 100)}%` : "–"} sub={`${doneOnTime} of ${past14.length} planned`} />
        <Tile label="reminders" value={r ? "on" : "off"} sub={r ? `${r.morning ?? "no"} morning · ${r.evening ?? "no"} evening` : "not set up on his Me page"} />
      </Tiles>

      <div className="mt-6 grid gap-x-14 lg:grid-cols-2">
        <Block title="today" right={fmtDay(t)}>
          {today.length ? today.map((i) => <Row key={i.id} i={i} />) : <Empty>nothing planned today.</Empty>}
          {overdue.length > 0 && (
            <div className="mt-5">
              <div className="mb-1 font-mono text-[11px] text-red uppercase">overdue</div>
              {overdue.map((i) => (
                <Row key={i.id} i={i} late />
              ))}
            </div>
          )}
        </Block>
        <Block title="coming up" right="next 14 days">
          {upcoming.length ? (
            upcoming.map(({ d, items }) => (
              <div key={d} className="mb-3">
                <div className="font-mono text-[11.5px] text-mute">{fmtDay(d)}</div>
                {items.map((i) => (
                  <Row key={i.id} i={i} />
                ))}
              </div>
            ))
          ) : (
            <Empty>nothing scheduled ahead.</Empty>
          )}
        </Block>
      </div>
    </>
  );
}
