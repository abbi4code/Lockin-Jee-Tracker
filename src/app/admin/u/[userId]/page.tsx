import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminShell, StudentCard } from "@/components/AdminParts";
import { SUBJECT_COLOR, SUBJECTS, TRACKS } from "@/data";
import { ago, formatMinutes, loadStudents, requireAdmin } from "@/lib/admin-data";
import { stageLabel } from "@/lib/stages";
import { pct, scoreTone, trackProgress } from "@/lib/tests";
import { adminDeleteTest, adminImportExcel, adminSaveTest } from "../../actions";

export const metadata: Metadata = { title: "Student", robots: { index: false } };

const CONFIDENCE = ["cooked", "shaky", "okay", "solid", "goated"];
const label = "font-mono text-[11px] tracking-[0.16em] text-mute uppercase";
const input = "w-full border-b border-line-2 bg-transparent py-1.5 font-mono text-[14px] outline-none focus:border-fg";

export default async function StudentPage({ params }: PageProps<"/admin/u/[userId]">) {
  if (!(await requireAdmin())) redirect("/today");
  const { userId } = await params;
  const { students } = await loadStudents();
  const s = students.find((x) => x.id === userId);
  if (!s) notFound();

  return (
    <AdminShell title="student" back={{ href: "/admin", label: "all students" }} chatWith={{ id: s.id, name: s.name }}>
      <StudentCard s={s} link={false} />

      {!s.imported && (
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

      <section className="border-b border-line py-7">
        <div className={`mb-3 ${label}`}>recent focus sessions</div>
        {s.sessions.length === 0 ? (
          <p className="font-mono text-[13px] text-dim">none in the last 30 days.</p>
        ) : (
          [...s.sessions]
            .reverse()
            .slice(0, 12)
            .map((x) => (
              <div key={x.id} className="flex items-center gap-3 py-1.5 text-[14px]">
                <span className="w-32 shrink-0 font-mono text-[12px] text-dim">{new Date(x.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate">{x.chapterId ? SUBJECTS.flatMap((sub) => sub.chapters).find((c) => c.id === x.chapterId)?.name : "general study"}</span>
                <span className="font-mono text-[12px] text-dim">{x.mode}</span>
                <span className="w-16 text-right font-mono text-[13px]">{formatMinutes(x.minutes)}</span>
              </div>
            ))
        )}
      </section>

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
    </AdminShell>
  );
}
