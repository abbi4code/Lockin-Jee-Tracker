"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DotBar } from "../ui";

export interface StudentRow {
  id: string;
  name: string;
  email: string;
  lastActive: string;
  activeToday: boolean;
  streak: number;
  study7: string;
  questions7: number;
  tests: number;
  college: string | null;
  syllabus: number;
  done: string;
}

/** The admin home: every student, searchable by name or email. A row opens that student's pages. */
export function StudentList({ rows }: { rows: StudentRow[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)) : rows;

  return (
    <section className="pt-6">
      <label className="flex items-center gap-2 border-b border-line-2 pb-2.5 focus-within:border-fg">
        <Search className="size-4 text-dim" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search students by name or email" className="w-full bg-transparent text-[16px] outline-none placeholder:text-dim" />
        {needle && <span className="shrink-0 font-mono text-[12px] text-dim">{list.length} found</span>}
      </label>

      {/* Column headings (laptops). */}
      <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)_minmax(0,1.4fr)_1.5rem] gap-4 border-b border-line py-3 font-mono text-[11px] text-dim uppercase lg:grid">
        <span>student</span>
        <span>study · 7d</span>
        <span>questions · 7d</span>
        <span>tests</span>
        <span>streak</span>
        <span>today&apos;s college</span>
        <span>syllabus</span>
        <span />
      </div>

      {list.map((r) => (
        <Link
          key={r.id}
          href={`/admin/u/${r.id}`}
          className="group grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line py-4 transition hover:bg-ink-2/60 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)_minmax(0,1.4fr)_1.5rem] lg:items-center"
        >
          <div className="col-span-2 min-w-0 lg:col-span-1">
            <div className="flex items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-full ${r.activeToday ? "bg-fg" : "bg-red"}`} title={r.activeToday ? "active today" : "not active today"} />
              <span className="truncate text-[17px] font-medium">{r.name}</span>
            </div>
            <div className="mt-0.5 truncate pl-3.5 font-mono text-[12px] text-dim">
              {r.email} · {r.activeToday ? "active today" : `active ${r.lastActive}`}
            </div>
          </div>
          <Cell label="study · 7d" value={r.study7} />
          <Cell label="questions · 7d" value={String(r.questions7)} />
          <Cell label="tests" value={String(r.tests)} />
          <Cell label="streak" value={`${r.streak}d`} />
          <Cell label="today's college" value={r.college ?? "–"} />
          <div className="col-span-2 lg:col-span-1">
            <div className="font-mono text-[11px] text-dim lg:hidden">syllabus</div>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 overflow-hidden">
                <DotBar value={r.syllabus / 100} dots="auto" size={4} />
              </div>
              <span className="font-mono text-[12px] text-mute">{r.done}</span>
            </div>
          </div>
          <ArrowRight className="hidden size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg lg:block" />
        </Link>
      ))}
      {list.length === 0 && <p className="py-16 text-center font-mono text-[13px] text-dim">{rows.length ? "no student matches that." : "no accounts yet."}</p>}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[11px] text-dim lg:hidden">{label}</div>
      <div className="truncate font-mono text-[14px]">{value}</div>
    </div>
  );
}
