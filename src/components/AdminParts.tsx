import Link from "next/link";
import type { ReactNode } from "react";
import { ChatDock } from "./ChatDock";
import { DotText } from "./ui";

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
