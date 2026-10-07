import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Block, MeterRow, SUBJECT_NAME, Tile, Tiles } from "@/components/admin/StudentParts";
import { SUBJECT_COLOR, SUBJECTS } from "@/data";
import { ago } from "@/lib/admin-data";
import { chapterInsights, loadStudent } from "@/lib/admin-student";
import { STAGES, stageLabel } from "@/lib/stages";

export const metadata: Metadata = { title: "Chapters", robots: { index: false } };

const CONFIDENCE = ["cooked", "shaky", "okay", "solid", "goated"];
const label = "font-mono text-[11px] tracking-[0.16em] text-mute uppercase";

export default async function Chapters({ params }: PageProps<"/admin/u/[userId]/chapters">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = chapterInsights(s);
  const stageCount = STAGES.map((st) => ({ ...st, n: Object.values(s.chapters).filter((p) => p.status === st.id).length }));
  stageCount[0].n = x.overall.total - stageCount.slice(1).reduce((a, b) => a + b.n, 0);

  return (
    <>
      <Tiles>
        <Tile label="studied" value={`${x.overall.done}/${x.overall.total}`} sub={`${Math.round(x.overall.percent)}% of topics ticked`} />
        <Tile label="in progress" value={x.working.length} sub={x.working.slice(0, 2).map((c) => c.name).join(", ") || "none"} />
        <Tile label="not started" value={x.overall.todo} sub="chapters still undone" />
        <Tile label="revisions done" value={x.revisionsDone} sub="across all chapters" />
        <Tile label="revisions due" value={x.revisionsDue.length} sub={x.revisionsDue[0]?.chapter.name ?? "all caught up"} tone={x.revisionsDue.length > 3 ? "red" : undefined} />
        <Tile label="exam scope" value={s.exam === "main" ? "Main" : "Adv"} sub={s.exam === "main" ? "advanced-only chapters hidden" : "main + advanced syllabus"} />
      </Tiles>

      <div className="mt-6 grid gap-x-14 lg:grid-cols-2">
        <Block title="by subject">
          {x.bySubject.map((b) => (
            <MeterRow key={b.id} label={SUBJECT_NAME[b.id]} subject={b.id} fraction={b.percent / 100} value={`${b.done}/${b.total} studied`} />
          ))}
        </Block>
        <Block title="by stage" right="all subjects">
          {stageCount.map((st) => (
            <MeterRow key={st.id} label={st.label} fraction={st.n / Math.max(x.overall.total, 1)} value={`${st.n} chapter${st.n === 1 ? "" : "s"}`} />
          ))}
        </Block>
      </div>

      {SUBJECTS.map((sub) => (
        <section key={sub.id} className="border-b border-line py-7">
          <div className="mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[sub.id] }} />
            <span className={label}>{sub.name} · chapters</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[14px]">
              <thead className="font-mono text-[11px] text-dim uppercase">
                <tr>
                  <th className="py-2 font-normal">chapter</th>
                  <th className="py-2 font-normal">stage</th>
                  <th className="py-2 font-normal">topics</th>
                  <th className="py-2 font-normal">confidence</th>
                  <th className="py-2 font-normal">revised</th>
                  <th className="py-2 text-right font-normal">updated</th>
                </tr>
              </thead>
              <tbody>
                {sub.chapters.map((c) => {
                  const p = s.chapters[c.id];
                  const status = p?.status ?? "undone";
                  return (
                    <tr key={c.id} className="border-t border-line/60">
                      <td className={`py-2 pr-3 ${status === "undone" ? "text-dim" : ""}`}>{c.name}</td>
                      <td className={`py-2 pr-3 font-mono text-[12px] ${status === "weak" || status === "working" ? "text-red" : status === "undone" ? "text-dim" : ""}`}>{stageLabel(status)}</td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-mute">
                        {p ? Object.keys(p.topics).length : 0}/{c.topics.length}
                      </td>
                      <td className={`py-2 pr-3 font-mono text-[12px] ${p?.confidence != null && p.confidence <= 1 ? "text-red" : "text-mute"}`}>{p?.confidence != null ? CONFIDENCE[p.confidence] : "–"}</td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-mute">{p?.revisions.length ? `×${p.revisions.length}` : "–"}</td>
                      <td className="py-2 text-right font-mono text-[12px] text-dim">{p?.updatedAt ? ago(new Date(p.updatedAt).toISOString()) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
