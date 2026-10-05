import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DotField } from "@/components/DotField";
import { LandingCountdown } from "@/screens/Landing";
import { ALL_CHAPTERS } from "@/data";

const topics = ALL_CHAPTERS.reduce((n, c) => n + c.topics.length, 0);
const videos = ALL_CHAPTERS.reduce((n, c) => n + (c.res?.videos.length ?? 0), 0);

const FEATURES = [
  { title: "The whole syllabus, mapped", body: `${ALL_CHAPTERS.length} chapters and ${topics} topics from the official 2026 Main and Advanced syllabi, each flagged Main, Advanced or both.` },
  { title: "Know what's worth your hours", body: "Questions per shift for every chapter from 2019 to 2026, plus the topics NTA dropped from the syllabus but still asks." },
  { title: "A focus timer that remembers", body: "Pomodoro or stopwatch, tied to a chapter. Every session is logged, so streaks and study hours count themselves." },
  { title: "Quiet by design", body: "Black, minimal, nothing to scroll. Open it, tick a topic, close it. Works offline and syncs across phone and laptop." },
];

export default function Landing() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <DotField className="absolute inset-x-0 top-0 h-[78vh] w-full" accent />
      <div className="relative mx-auto max-w-3xl px-6 lg:max-w-[1500px] lg:px-12 xl:px-16">
        <header className="flex items-center justify-between py-7">
          <span className="dot text-xl">lockin.</span>
          <Link href="/login" className="font-mono text-[13px] text-mute transition hover:text-fg">
            sign in
          </Link>
        </header>

        {/* Laptops: headline on the left, live countdown on the right. */}
        <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-x-16 lg:pb-16">
        <section className="pt-[18vh] pb-20 lg:col-span-7 lg:pb-0">
          <p className="font-mono text-[12px] tracking-[0.18em] text-mute uppercase">jee main + advanced · 2027</p>
          <h1 className="mt-5 text-[44px] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-[72px] xl:text-[96px]">
            Stop planning.
            <br />
            <span className="text-mute">Lock in.</span>
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-mute">A study tracker that knows the JEE syllabus better than your timetable does, and stays out of your way.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" data-cursor="go" className="group inline-flex items-center gap-2 rounded-full bg-fg px-6 py-3.5 text-[15px] font-medium text-ink">
              start tracking <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link href="/login" className="rounded-full border border-line-2 px-6 py-3.5 text-[15px] text-fg transition hover:border-mute">
              I have an account
            </Link>
          </div>
        </section>

        <section className="border-t border-line py-8 lg:col-span-5 lg:border-t-0 lg:py-0">
          <LandingCountdown />
        </section>
        </div>

        <section className="border-t border-line lg:grid lg:grid-cols-2 lg:gap-x-16">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="grid grid-cols-[3rem_1fr] gap-2 border-b border-line py-7 lg:py-10">
              <span className="dot text-[16px] text-dim">0{i + 1}</span>
              <div>
                <h2 className="text-[18px] font-medium tracking-tight">{f.title}</h2>
                <p className="mt-2 max-w-lg text-[15.5px] leading-relaxed text-mute">{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-y-8 py-14 sm:grid-cols-4">
          {[
            [ALL_CHAPTERS.length, "chapters"],
            [topics, "topics"],
            [videos, "lectures"],
            [8, "years of papers"],
          ].map(([n, l]) => (
            <div key={l}>
              <div className="dot text-4xl">{n}</div>
              <div className="mt-1 font-mono text-[12px] text-mute">{l}</div>
            </div>
          ))}
        </section>

        <footer className="flex items-center justify-between border-t border-line py-8 font-mono text-[12px] text-dim">
          <span>lockin.</span>
          <Link href="/signup" className="text-fg">
            get started →
          </Link>
        </footer>
      </div>
    </main>
  );
}
