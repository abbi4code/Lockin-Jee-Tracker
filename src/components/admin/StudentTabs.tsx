"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "", label: "overview" },
  { seg: "study", label: "study time" },
  { seg: "questions", label: "questions" },
  { seg: "tests", label: "tests" },
  { seg: "college", label: "college" },
  { seg: "chapters", label: "chapters" },
  { seg: "plan", label: "plan" },
  { seg: "notes", label: "notes" },
];

/** The student's sections, one page each. Scrolls sideways on phones. */
export function StudentTabs({ id }: { id: string }) {
  const path = usePathname();
  const base = `/admin/u/${id}`;
  return (
    <nav className="no-scrollbar -mx-5 flex gap-6 overflow-x-auto border-b border-line px-5 lg:mx-0 lg:px-0">
      {TABS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base;
        const active = path === href;
        return (
          <Link key={t.seg} href={href} className={`relative shrink-0 py-3.5 font-mono text-[13px] transition-colors ${active ? "text-fg" : "text-mute hover:text-fg"}`}>
            {t.label}
            {active && <motion.span layoutId="student-tab" className="absolute inset-x-0 -bottom-px h-px bg-fg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          </Link>
        );
      })}
    </nav>
  );
}
