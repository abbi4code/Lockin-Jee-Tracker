import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Block, Empty, fmtDay, Tile, Tiles } from "@/components/admin/StudentParts";
import { ALL_CHAPTERS, SUBJECT_COLOR } from "@/data";
import { loadStudent } from "@/lib/admin-student";

export const metadata: Metadata = { title: "Notes", robots: { index: false } };

/** His weak spots (open first) and free notes, chapter by chapter. */
export default async function Notes({ params }: PageProps<"/admin/u/[userId]/notes">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const withWeak = ALL_CHAPTERS.map((c) => ({ c, weak: s.chapters[c.id]?.weak ?? [] }))
    .filter((x) => x.weak.length)
    .sort((a, b) => b.weak.filter((w) => !w.fixed).length - a.weak.filter((w) => !w.fixed).length);
  const withNotes = ALL_CHAPTERS.filter((c) => s.chapters[c.id]?.notes?.trim());
  const open = withWeak.reduce((n, x) => n + x.weak.filter((w) => !w.fixed).length, 0);
  const fixed = withWeak.reduce((n, x) => n + x.weak.filter((w) => w.fixed).length, 0);

  return (
    <>
      <Tiles>
        <Tile label="open weak spots" value={open} sub={`in ${withWeak.filter((x) => x.weak.some((w) => !w.fixed)).length} chapters`} tone={open ? "red" : undefined} />
        <Tile label="fixed" value={fixed} sub="ticked off by him" />
        <Tile label="chapters with notes" value={withNotes.length} />
      </Tiles>

      <Block title="weak spots" className="mt-6" right="open first">
        {withWeak.length === 0 ? (
          <Empty>he hasn&apos;t noted any weak spots yet.</Empty>
        ) : (
          <div className="grid gap-x-14 lg:grid-cols-2">
            {withWeak.map(({ c, weak }) => (
              <div key={c.id} className="mb-5">
                <div className="mb-1 flex items-center gap-2 text-[15px] font-medium">
                  <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[c.subject] }} />
                  {c.name}
                </div>
                {[...weak].sort((a, b) => Number(a.fixed) - Number(b.fixed)).map((w) => (
                  <div key={w.id} className="flex items-start gap-3 py-1 text-[14.5px]">
                    <span className={`mt-1 font-mono text-[11px] ${w.fixed ? "text-dim" : "text-red"}`}>{w.fixed ? "✓" : "•"}</span>
                    <span className={`min-w-0 flex-1 ${w.fixed ? "text-dim line-through decoration-dim" : ""}`}>{w.text}</span>
                    <span className="font-mono text-[11px] text-dim">{fmtDay(w.at)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="notes">
        {withNotes.length === 0 ? (
          <Empty>no chapter notes yet.</Empty>
        ) : (
          <div className="grid gap-x-14 gap-y-6 lg:grid-cols-2">
            {withNotes.map((c) => (
              <div key={c.id}>
                <div className="mb-1.5 flex items-center gap-2 text-[15px] font-medium">
                  <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[c.subject] }} />
                  {c.name}
                </div>
                <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap text-mute">{s.chapters[c.id].notes}</p>
              </div>
            ))}
          </div>
        )}
      </Block>
    </>
  );
}
