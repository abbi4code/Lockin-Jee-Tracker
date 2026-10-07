import Link from "next/link";
import type { ReactNode } from "react";
import { SUBJECT_COLOR, type SubjectId } from "@/data";
import { DotBar, DotText } from "../ui";

export const SUBJECT_NAME: Record<SubjectId, string> = { physics: "Physics", chemistry: "Chemistry", maths: "Maths" };

/** "tue 6 oct" */
export const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).toLowerCase().replace(",", "");
/** Day of the month, for chart ticks. */
export const tickDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString("en-IN", { day: "numeric" });
export const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)}m`);

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase">{children}</h2>
      {right && <div className="font-mono text-[12px] text-dim">{right}</div>}
    </div>
  );
}

/** A titled block separated by a hairline, like the rest of the app. */
export function Block({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // min-w-0: inside a grid, a section would otherwise grow to its content's width and overflow phones.
    <section className={`min-w-0 border-t border-line pt-5 pb-8 ${className}`}>
      <SectionTitle right={right}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** Stat tile: label, one big value, one line of context. Links to its tab when `href` is given. */
export function Tile({ label, value, sub, href, tone }: { label: string; value: string | number; sub?: ReactNode; href?: string; tone?: "red" }) {
  const body = (
    <>
      <div className="font-mono text-[11px] tracking-[0.14em] text-mute uppercase">{label}</div>
      <DotText className={`mt-3 block text-[30px] leading-none lg:text-[34px] ${tone === "red" ? "text-red" : ""}`}>{String(value)}</DotText>
      {sub && <div className="mt-2.5 font-mono text-[12px] leading-relaxed text-dim">{sub}</div>}
    </>
  );
  const cls = "block border-t border-line py-5 pr-4";
  return href ? (
    <Link href={href} className={`${cls} group transition hover:bg-ink-2/60`}>
      {body}
      <span className="mt-2 inline-block font-mono text-[11px] text-dim group-hover:text-fg">details →</span>
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/**
 * One labelled row per subject (or chapter): name, a dot bar, and the value in words. Identity is carried by the
 * label and position, the subject dot only supplements it (the subject colours aren't colour-blind safe as a pair).
 */
export function MeterRow({ label, subject, fraction, value }: { label: string; subject?: SubjectId; fraction: number; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {subject ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: SUBJECT_COLOR[subject] }} /> : null}
      <span className="w-32 shrink-0 truncate text-[14.5px] sm:w-40 lg:w-56">{label}</span>
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <DotBar value={fraction} dots="auto" size={4} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[12.5px] text-mute sm:w-28">{value}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[13px] text-dim">{children}</p>;
}
