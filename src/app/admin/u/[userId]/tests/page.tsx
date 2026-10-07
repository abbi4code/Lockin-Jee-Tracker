import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScoreLine } from "@/components/admin/Charts";
import { Block, Empty, fmtDay, MeterRow, SUBJECT_NAME, Tile, Tiles } from "@/components/admin/StudentParts";
import { getTrack, SUBJECT_COLOR, SUBJECTS, TRACKS } from "@/data";
import { loadStudent, testInsights } from "@/lib/admin-student";
import { pct, scoreTone, trackProgress } from "@/lib/tests";
import { adminDeleteTest, adminImportExcel, adminSaveTest } from "../../../actions";

export const metadata: Metadata = { title: "Tests", robots: { index: false } };

const label = "font-mono text-[11px] tracking-[0.16em] text-mute uppercase";
const input = "w-full border-b border-line-2 bg-transparent py-1.5 font-mono text-[14px] outline-none focus:border-fg";

export default async function Tests({ params }: PageProps<"/admin/u/[userId]/tests">) {
  const { userId } = await params;
  const s = await loadStudent(userId);
  if (!s) notFound();
  const x = testInsights(s);
  const bySubject = SUBJECTS.map((sub) => {
    const scored = x.scored.filter((t) => x.subjectOf(t) === sub.id);
    return { id: sub.id, n: scored.length, avg: scored.length ? scored.reduce((a, t) => a + pct(t)!, 0) / scored.length : null };
  });
  const recent = [...x.scored].reverse();

  return (
    <>
      <Tiles>
        <Tile label="tests given" value={x.given} sub={x.imported ? `${x.imported} imported without scores` : "chapterwise + pyq"} />
        <Tile label="with scores" value={x.scored.length} sub="logged with marks" />
        <Tile label="average" value={x.avg != null ? `${Math.round(x.avg)}%` : "–"} sub="all scored tests" tone={x.avg != null && x.avg < 40 ? "red" : undefined} />
        <Tile label="last 5" value={x.last5 != null ? `${Math.round(x.last5)}%` : "–"} sub={x.avg != null && x.last5 != null ? (x.last5 >= x.avg ? "above his average" : "below his average") : "–"} />
        <Tile label="accuracy" value={x.accuracy != null ? `${Math.round(x.accuracy)}%` : "–"} sub={`${x.correct} right · ${x.wrong} wrong`} />
        <Tile label="questions in tests" value={x.correct + x.wrong} sub="attempted" />
      </Tiles>

      <Block title="scores over time" className="mt-6" right="in the order taken · guides at 40% and 70%">
        {x.scored.length ? (
          <ScoreLine
            points={x.scored.map((t) => ({ key: t.id, value: pct(t)!, tip: `${t.takenOn ? fmtDay(t.takenOn) : "undated"} · ${getTrack(t.trackId)?.name ?? t.trackId} ${t.kind === "pyq" ? "pyq" : "#" + t.testNo} · ${t.score}/${t.maxScore} (${Math.round(pct(t)!)}%)` }))}
            caption={`${x.scored.length} scored tests · hover a dot`}
          />
        ) : (
          <Empty>no scored tests yet.</Empty>
        )}
      </Block>

      <div className="grid gap-x-14 lg:grid-cols-12">
        <Block title="average by subject" className="lg:col-span-5">
          {bySubject.map((b) => (
            <MeterRow key={b.id} label={SUBJECT_NAME[b.id]} subject={b.id} fraction={(b.avg ?? 0) / 100} value={b.avg != null ? `${Math.round(b.avg)}% · ${b.n} test${b.n === 1 ? "" : "s"}` : "–"} />
          ))}
        </Block>
        <Block title="recent results" className="lg:col-span-7" right={`${recent.length} scored`}>
          {recent.length === 0 ? (
            <Empty>nothing scored yet.</Empty>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="sticky top-0 bg-ink font-mono text-[11px] text-dim uppercase">
                  <tr>
                    <th className="py-2 font-normal">date</th>
                    <th className="py-2 font-normal">chapter</th>
                    <th className="py-2 font-normal">test</th>
                    <th className="py-2 text-right font-normal">score</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => {
                    const tr = getTrack(t.trackId);
                    return (
                      <tr key={t.id} className="border-t border-line/60">
                        <td className="py-2 pr-3 font-mono text-[12px] text-dim">{t.takenOn ? fmtDay(t.takenOn) : "–"}</td>
                        <td className="py-2 pr-3">
                          {tr && <span className="mr-2 inline-block size-1.5 rounded-full align-middle" style={{ background: SUBJECT_COLOR[tr.subject] }} />}
                          {tr?.name ?? t.trackId}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[12px] text-mute">{t.kind === "pyq" ? "pyq" : `#${t.testNo}`}</td>
                        <td className="py-2 text-right font-mono text-[13px]">
                          {t.score}/{t.maxScore} <span style={{ color: scoreTone(pct(t)) }}>{Math.round(pct(t)!)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      </div>

      {!x.imported && (
        <section className="border-b border-line py-7">
          <div className={label}>import the old excel tracker</div>
          <p className="mt-2 max-w-2xl text-[14px] text-mute">
            Copies the board stages (undone → adv level) onto {s.name}&apos;s chapters and marks the 107 MathonGo tests already taken as done (without scores, since the Excel
            didn&apos;t have them). It only runs once per student.
          </p>
          <form action={adminImportExcel} className="mt-4">
            <input type="hidden" name="userId" value={s.id} />
            <button className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink">import into {s.name}&apos;s account</button>
          </form>
        </section>
      )}

      <section className="border-b border-line py-7">
        <div className={label}>log a test result</div>
        <form action={adminSaveTest} className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 lg:grid-cols-8">
          <input type="hidden" name="userId" value={s.id} />
          <label className="col-span-2 sm:col-span-4 lg:col-span-3">
            <span className={label}>chapter</span>
            <select name="trackId" required className={input}>
              {SUBJECTS.map((sub) => (
                <optgroup key={sub.id} label={sub.name}>
                  {TRACKS.filter((t) => t.subject === sub.id).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.tests} tests)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>type</span>
            <select name="kind" className={input}>
              <option value="chapterwise">chapterwise</option>
              <option value="pyq">pyq</option>
            </select>
          </label>
          <label>
            <span className={label}>test no.</span>
            <input name="testNo" type="number" min={1} required className={input} />
          </label>
          <label>
            <span className={label}>marks</span>
            <input name="score" inputMode="decimal" className={input} />
          </label>
          <label>
            <span className={label}>out of</span>
            <input name="maxScore" inputMode="decimal" className={input} />
          </label>
          <label>
            <span className={label}>date</span>
            <input name="takenOn" type="date" className={input} />
          </label>
          <label>
            <span className={label}>correct</span>
            <input name="correct" type="number" min={0} className={input} />
          </label>
          <label>
            <span className={label}>wrong</span>
            <input name="wrong" type="number" min={0} className={input} />
          </label>
          <label>
            <span className={label}>skipped</span>
            <input name="unattempted" type="number" min={0} className={input} />
          </label>
          <label>
            <span className={label}>time (min)</span>
            <input name="timeMin" type="number" min={0} className={input} />
          </label>
          <div className="col-span-2 flex items-end sm:col-span-4 lg:col-span-1">
            <button className="w-full rounded-full bg-fg py-2.5 text-[14px] font-medium text-ink">save</button>
          </div>
        </form>
        <p className="mt-3 font-mono text-[11px] text-dim">saving a test number that already exists updates it. {s.name} sees changes the next time the app syncs.</p>
      </section>

      <details className="group border-t border-line py-5">
        <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase hover:text-fg">
          every mathongo chapter · results per test
          <span className="text-[12px] tracking-normal normal-case text-dim group-open:hidden">show</span>
          <span className="hidden text-[12px] tracking-normal normal-case text-dim group-open:inline">hide</span>
        </summary>
      {SUBJECTS.map((sub) => (
        <section key={`tests-${sub.id}`} className="border-b border-line py-7">
          <div className="mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[sub.id] }} />
            <span className={label}>{sub.name} · mathongo tests</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="font-mono text-[11px] text-dim uppercase">
                <tr>
                  <th className="py-2 font-normal">chapter</th>
                  <th className="py-2 font-normal">done</th>
                  <th className="py-2 font-normal">avg</th>
                  <th className="py-2 font-normal">results (click × to remove)</th>
                </tr>
              </thead>
              <tbody>
                {TRACKS.filter((t) => t.subject === sub.id).map((t) => {
                  const p = trackProgress(t, s.tests);
                  return (
                    <tr key={t.id} className="border-t border-line/60 align-top">
                      <td className={`py-2.5 pr-3 ${p.done === 0 ? "text-dim" : ""}`}>{t.name}</td>
                      <td className="py-2.5 pr-3 font-mono text-[12px] text-mute">
                        {p.done}/{p.total}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[12px]" style={{ color: scoreTone(p.avg) }}>
                        {p.avg != null ? `${Math.round(p.avg)}%` : "–"}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {[...p.chapterwise, ...p.pyq].map((r) => {
                            const v = pct(r);
                            return (
                              <form key={r.id} action={adminDeleteTest} className="flex items-center rounded border border-line-2 font-mono text-[11px]">
                                <input type="hidden" name="userId" value={s.id} />
                                <input type="hidden" name="id" value={r.id} />
                                <span className="px-1.5 py-0.5" style={{ color: scoreTone(v) }} title={r.takenOn ?? ""}>
                                  {r.kind === "pyq" ? "pyq " : "#"}
                                  {r.testNo} {v != null ? `${r.score}/${r.maxScore}` : r.imported ? "✓" : "–"}
                                </span>
                                <button className="border-l border-line-2 px-1 text-dim hover:text-red" aria-label="remove result">
                                  ×
                                </button>
                              </form>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      </details>
    </>
  );
}
