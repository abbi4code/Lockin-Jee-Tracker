import { SUBJECT_COLOR } from "@/data";
import { adminDeleteQuizrr, adminResetQuizrrDates, adminSaveQuizrr, adminSaveQuizrrDates } from "@/app/admin/actions";
import type { StudentDetail } from "@/lib/admin-student";
import { ACTIVE_TESTS, assignedDate, attemptFor, quizrrPct, seriesProgress, testName, type QuizrrTest } from "@/lib/quizrr";
import { scoreTone } from "@/lib/tests";
import { Block, fmtDay, Tile, Tiles } from "./StudentParts";

const label = "font-mono text-[11px] tracking-[0.16em] text-mute uppercase";
const input = "w-full border-b border-line-2 bg-transparent py-1.5 font-mono text-[14px] outline-none focus:border-fg";

/** Short syllabus for the schedule table: subject dot + chapter names, or the whole-class note. */
function Syllabus({ t }: { t: QuizrrTest }) {
  const s = t.syllabus;
  if (s.kind !== "chapters") return <span className="text-mute">complete class {s.cls}</span>;
  return (
    <span className="text-mute">
      {s.subjects.map(({ subject, items }) => (
        <span key={subject} className="mr-3 inline-flex items-baseline gap-1.5">
          <span className="inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: SUBJECT_COLOR[subject] }} />
          {items.map((i) => i.name).join(", ")}
        </span>
      ))}
    </span>
  );
}

/** Quizrr in the admin panel: the dates (only admins can set them) and the scores, with a form to log or fix one. */
export function QuizrrAdmin({ s }: { s: StudentDetail }) {
  const rows = ACTIVE_TESTS.map((t) => ({ t, date: assignedDate(t, s.quizrrDates), moved: t.id in s.quizrrDates, a: attemptFor(t.id, s.quizrr) })).sort(
    (x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999") || x.t.series.localeCompare(y.t.series) || x.t.no - y.t.no,
  );
  const qrt = seriesProgress("qrt", s.quizrr, s.quizrrDates);
  const qpt = seriesProgress("qpt", s.quizrr, s.quizrrDates);
  const missed = rows.filter((r) => !r.a && r.date && r.date < s.today).length;
  const scored = rows.filter((r) => r.a && quizrrPct(r.a) != null);
  const avg = scored.length ? scored.reduce((n, r) => n + quizrrPct(r.a!)!, 0) / scored.length : null;

  return (
    <>
      <Tiles>
        <Tile label="qrt done" value={`${qrt.done}/${qrt.total}`} sub={qrt.finishBy ? `last one ${fmtDay(qrt.finishBy)}` : "no dates"} />
        <Tile label="qpt done" value={`${qpt.done}/${qpt.total}`} sub={qpt.finishBy ? `last one ${fmtDay(qpt.finishBy)}` : "no dates"} />
        <Tile label="missed" value={missed} sub="past their date, no score" tone={missed ? "red" : undefined} />
        <Tile label="quizrr average" value={avg != null ? `${Math.round(avg)}%` : "–"} sub={`${scored.length} scored · counts in college`} tone={avg != null && avg < 40 ? "red" : undefined} />
      </Tiles>

      {!s.quizrrAvailable && (
        <p className="mt-4 font-mono text-[12.5px] text-red">
          run supabase/migrations/20261013000000_quizrr.sql in the supabase sql editor first: until then dates can&apos;t be saved and {s.name}&apos;s scores stay on his device.
        </p>
      )}

      <Block title="quizrr · dates" className="mt-6" right={`only admins can change these · ${s.name} sees them on today, /quizrr and the planner`}>
        <form action={adminSaveQuizrrDates}>
          <input type="hidden" name="userId" value={s.id} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[14px]">
              <thead className="font-mono text-[11px] text-dim uppercase">
                <tr>
                  <th className="py-2 font-normal">test</th>
                  <th className="py-2 font-normal">syllabus</th>
                  <th className="w-44 py-2 font-normal">date</th>
                  <th className="w-36 py-2 text-right font-normal">result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, date, moved, a }) => {
                  const p = a ? quizrrPct(a) : null;
                  const late = !a && date && date < s.today;
                  return (
                    <tr key={t.id} className="border-t border-line/60 align-top">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {testName(t)}
                        {moved && <span className="ml-2 font-mono text-[10.5px] text-dim">set by you</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-[13px] leading-relaxed">
                        <Syllabus t={t} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="date" name={`date:${t.id}`} defaultValue={date ?? ""} className={input} aria-label={`date for ${testName(t)}`} />
                      </td>
                      <td className="py-2.5 text-right font-mono text-[12.5px] whitespace-nowrap">
                        {a ? (
                          <>
                            {a.score}/{a.maxScore} {p != null && <span style={{ color: scoreTone(p) }}>{Math.round(p)}%</span>}
                          </>
                        ) : late ? (
                          <span className="text-red">missed</span>
                        ) : (
                          <span className="text-dim">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink">save dates</button>
            <span className="font-mono text-[11.5px] text-dim">clear a date to take a test off the schedule. {s.name} sees changes the next time the app syncs.</span>
          </div>
        </form>
        <form action={adminResetQuizrrDates} className="mt-3">
          <input type="hidden" name="userId" value={s.id} />
          <button className="font-mono text-[12px] text-mute underline underline-offset-4 hover:text-red">reset to the suggested schedule</button>
        </form>
      </Block>

      <Block title="quizrr · log or fix a score">
        <form action={adminSaveQuizrr} className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 lg:grid-cols-10">
          <input type="hidden" name="userId" value={s.id} />
          <label className="col-span-2">
            <span className={label}>test</span>
            <select name="testId" required className={input}>
              {ACTIVE_TESTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {testName(t)} ({t.marks} marks)
                </option>
              ))}
            </select>
          </label>
          {[
            ["score", "marks"],
            ["maxScore", "out of"],
            ["physics", "phy"],
            ["chemistry", "chem"],
            ["maths", "math"],
            ["percentile", "percentile"],
            ["rank", "rank"],
          ].map(([name, text]) => (
            <label key={name}>
              <span className={label}>{text}</span>
              <input name={name} inputMode="decimal" required={name === "score"} placeholder={name === "maxScore" ? "test max" : undefined} className={input} />
            </label>
          ))}
          <label>
            <span className={label}>date</span>
            <input name="takenOn" type="date" className={input} />
          </label>
          <div className="col-span-2 flex items-end sm:col-span-4 lg:col-span-10">
            <button className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink">save score</button>
            <span className="ml-3 font-mono text-[11px] text-dim">saving a test that already has a score replaces it.</span>
          </div>
        </form>
        {rows.some((r) => r.a) && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {rows
              .filter((r) => r.a)
              .map(({ t, a }) => (
                <form key={a!.id} action={adminDeleteQuizrr} className="flex items-center rounded border border-line-2 font-mono text-[11px]">
                  <input type="hidden" name="userId" value={s.id} />
                  <input type="hidden" name="id" value={a!.id} />
                  <span className="px-1.5 py-0.5" style={{ color: scoreTone(quizrrPct(a!)) }} title={a!.takenOn ?? ""}>
                    {testName(t)} {a!.score}/{a!.maxScore}
                  </span>
                  <button className="border-l border-line-2 px-1 text-dim hover:text-red" aria-label={`remove ${testName(t)} score`}>
                    ×
                  </button>
                </form>
              ))}
          </div>
        )}
      </Block>
    </>
  );
}
