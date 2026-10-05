import Link from "next/link";
import type { ReactNode } from "react";
import { SUBJECT_COLOR, SUBJECTS } from "@/data";
import { ago, formatMinutes, type StudentSummary } from "@/lib/admin-data";
import { ChatDock } from "./ChatDock";
import { DotBar, DotText } from "./ui";

export function AdminShell({ title, back, chatWith, children }: { title: string; back?: { href: string; label: string }; chatWith?: { id: string; name: string }; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pt-8 pb-24 lg:max-w-[1500px] lg:px-12 xl:px-16">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <div className="flex items-baseline gap-3">
          <span className="dot text-lg">lockin.</span>
          <span className="font-mono text-[12px] tracking-[0.16em] text-red uppercase">{title}</span>
        </div>
        <Link href={back?.href ?? "/today"} className="font-mono text-[12px] text-mute hover:text-fg">
          ← {back?.label ?? "back to app"}
        </Link>
      </header>
      {children}
      <ChatDock placement="admin" openStudentId={chatWith?.id} openStudentName={chatWith?.name} />
    </main>
  );
}

export function Stat({ value, label, tone }: { value: string | number; label: string; tone?: "red" }) {
  return (
    <div>
      <DotText className={`block text-2xl leading-none ${tone === "red" ? "text-red" : ""}`}>{String(value)}</DotText>
      <div className="mt-1.5 font-mono text-[11px] text-mute">{label}</div>
    </div>
  );
}

export function StudyBars({ days }: { days: { date: string; minutes: number }[] }) {
  const max = Math.max(...days.map((d) => d.minutes), 60);
  return (
    <div className="flex h-12 items-end gap-1" title="focus minutes per day">
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${formatMinutes(d.minutes)}`}
          className="flex-1 rounded-[2px] bg-fg"
          style={{ height: `${Math.max((d.minutes / max) * 100, d.minutes ? 6 : 3)}%`, opacity: d.minutes ? 1 : 0.12 }}
        />
      ))}
    </div>
  );
}

/** One student: the at-a-glance block used on the overview and at the top of the detail page. */
export function StudentCard({ s, link = true }: { s: StudentSummary; link?: boolean }) {
  const inactive = !s.streak.activeToday;
  const head = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[20px] font-semibold tracking-tight">{s.name}</div>
        <div className="mt-1 font-mono text-[12px] text-mute">
          {s.email} · {s.exam === "main" ? "main" : "main + adv"} · joined {new Date(s.joined).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </div>
      </div>
      <div className="shrink-0 text-right font-mono text-[12px]">
        <div className={inactive ? "text-red" : "text-mute"}>active {ago(s.lastActive)}</div>
        {s.college.today && (
          <div className="mt-1 text-fg">
            today {s.college.today.name} <span className="text-dim">({s.college.today.score})</span>
          </div>
        )}
        {s.college.week && (
          <div className="mt-0.5 text-mute">
            week {s.college.week.name} <span className="text-dim">({s.college.week.score})</span>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <section className="border-b border-line py-7">
      {link ? (
        <Link href={`/admin/u/${s.id}`} className="block hover:opacity-80">
          {head}
        </Link>
      ) : (
        head
      )}

      <div className="mt-6 grid grid-cols-3 gap-y-6 sm:grid-cols-6">
        <Stat value={`${Math.round(s.overall.percent)}%`} label="syllabus" />
        <Stat value={`${s.overall.done}/${s.overall.total}`} label="chapters done" />
        <Stat value={s.streak.days} label={s.streak.atRisk ? "streak · at risk" : "day streak"} tone={s.streak.atRisk ? "red" : undefined} />
        <Stat value={formatMinutes(s.minutesToday)} label="focus today" tone={s.minutesToday === 0 ? "red" : undefined} />
        <Stat value={formatMinutes(s.minutes7)} label="last 7 days" />
        <Stat value={s.revisionsDue} label="revisions due" tone={s.revisionsDue > 3 ? "red" : undefined} />
        <Stat value={`${s.series.done}/${s.series.total}`} label="mathongo tests" />
        <Stat value={s.series.avg != null ? `${Math.round(s.series.avg)}%` : "–"} label="avg test score" tone={s.series.avg != null && s.series.avg < 40 ? "red" : undefined} />
        <Stat value={s.bySubject.physics.weak + s.bySubject.chemistry.weak + s.bySubject.maths.weak} label="weak chapters" tone="red" />
      </div>

      <div className="mt-6 space-y-2">
        {SUBJECTS.map((sub) => {
          const st = s.bySubject[sub.id];
          return (
            <div key={sub.id} className="flex items-center gap-3">
              <span className="size-1.5 rounded-full" style={{ background: SUBJECT_COLOR[sub.id] }} />
              <span className="w-20 text-[14px]">{sub.name}</span>
              <div className="flex min-w-0 flex-1 overflow-hidden">
                <DotBar value={st.percent / 100} dots="auto" size={4} />
              </div>
              <span className="w-24 text-right font-mono text-[11.5px] text-mute">
                {st.done}/{st.total} · {st.doing} wip
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-2 font-mono text-[11px] tracking-[0.16em] text-mute uppercase">focus · last 14 days</div>
          <StudyBars days={s.last14} />
        </div>
        <div className="space-y-3 text-[14px]">
          <div>
            <div className="mb-1 font-mono text-[11px] tracking-[0.16em] text-mute uppercase">working on</div>
            {s.inProgress.length ? s.inProgress.slice(0, 3).map((c) => <div key={c.id} className="truncate">{c.name}</div>) : <div className="text-dim">nothing in progress</div>}
          </div>
          {s.series.lowest.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[11px] tracking-[0.16em] text-red uppercase">lowest test scores</div>
              <div className="text-mute">
                {s.series.lowest
                  .slice(0, 4)
                  .map((p) => `${p.track.name} ${Math.round(p.avg!)}%`)
                  .join(" · ")}
              </div>
            </div>
          )}
          {s.weak.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[11px] tracking-[0.16em] text-red uppercase">rated shaky / cooked</div>
              <div className="text-mute">{s.weak.map((w) => w.name).join(", ")}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
