"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { lastDay, scrollMode } from "../lib/announcements";
import { STREAK_HOURS } from "../lib/college";
import { useSync } from "../lib/sync";
import { today, useProgress } from "../store/progress";
import { buzz } from "./Controls";
import { DotBar, DotText } from "./ui";

// The home page's announcement for the new weekly college game: a scroll (in the app's own dot-and-hairline look)
// that unrolls the first time he opens the app, then stays rolled up (swaying now and then) for 10 days.

const ID = "college-v2";
const DAYS = 10;
const OPENED_KEY = `lockin-scroll-${ID}-opened`;

const RULES: { title: string; body: string }[] = [
  { title: "Once a week", body: "Your college now changes once a week (Monday to Sunday), not every day." },
  { title: "Three things decide it", body: "Hours you study each day (coaching counts too), questions you solve each day, and your test scores." },
  { title: "Real competition", body: "You're compared with real JEE students. Study like a topper, get topper colleges. Study like an average student, get average colleges." },
  { title: "Streak days", body: `${STREAK_HOURS}+ hours in a day is a streak day. Every streak day pushes your college up. All 7 days in a week gives an extra boost, and strong weeks back to back give even more.` },
  { title: "Tests", body: "Tests count fully once you've given 3 in 4 weeks, so one lucky test can't carry you." },
  { title: "Next college", body: "The card on the home screen always shows what gets you the next college, like “+15 min a day”." },
  { title: "Your goals are yours", body: "The daily goals on the Me page are just for you. They don't change your college." },
  { title: "Log honestly", body: "Questions on the home screen, time with the timer (forgot? fix it in the Focus log). Fake numbers only fool you." },
];
/** A scroll "roller" in the app's own language: a hairline capsule with a row of dots that light up left to right. */
function Roller() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-line-2 bg-ink-2 px-3 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-red" />
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <DotBar value={1} dots="auto" size={3} gap={4} />
      </div>
      <span className="size-1.5 shrink-0 rounded-full bg-red" />
    </div>
  );
}

function OpenScroll({ until, onClose }: { until: string; onClose: () => void }) {
  return (
    <motion.div key="open" role="dialog" aria-label="the new college game" exit={{ opacity: 0, transition: { duration: 0.2, delay: 0.7 } }} className="mx-auto w-full max-w-3xl">
      <Roller />
      {/* The panel unrolls downwards; the bottom roller rides on its edge. */}
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: "auto" }}
        exit={{ height: 0 }}
        transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
        className="mx-3 overflow-hidden"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.35, duration: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className="border-x border-line-2 bg-ink-2/60 px-5 pt-6 pb-7 sm:px-9"
        >
          <div className="flex items-center justify-between gap-3 font-mono text-[11.5px] tracking-[0.16em] text-mute uppercase">
            <span className="flex items-center gap-2">
              <motion.span className="size-1.5 rounded-full bg-red" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
              announcement
            </span>
            <span>from your big bro</span>
          </div>
          <h2 className="mt-4 text-[28px] leading-tight font-semibold tracking-tight lg:text-[34px]">The new college game</h2>
          <p className="mt-1.5 text-[15px] text-mute">How your college is decided from now on. Read it once, properly.</p>

          <ol className="mt-6 border-t border-line">
            {RULES.map((r, i) => (
              <motion.li
                key={r.title}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0, transition: { delay: 0.5 + i * 0.07, duration: 0.3 } }}
                className="grid grid-cols-[2.75rem_1fr] gap-2 border-b border-line/60 py-3.5"
              >
                <DotText className="pt-0.5 text-[18px] leading-none text-dim">{String(i + 1).padStart(2, "0")}</DotText>
                <p className="text-[15.5px] leading-snug text-mute">
                  <span className="font-semibold text-fg">{r.title}.</span> {r.body}
                </p>
              </motion.li>
            ))}
          </ol>

          <motion.blockquote initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: 1.2, duration: 0.5 } }} className="mt-8">
            <p className="text-[20px] leading-snug font-medium tracking-tight sm:text-[23px]">
              <span className="text-red">&ldquo;</span>A success without sacrifice is no success at all. This is what makes a boy a man&hellip;<span className="text-red">&rdquo;</span>
            </p>
            <p className="mt-3 text-[16px]">All the best, champ.</p>
            <footer className="mt-1 flex items-center gap-2 font-mono text-[12.5px] text-mute">
              <span className="h-px w-6 bg-line-2" /> your big bro
            </footer>
          </motion.blockquote>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => {
                buzz(10);
                onClose();
              }}
              data-cursor="go"
              className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink"
            >
              got it, roll it up
            </button>
            <p className="font-mono text-[11.5px] text-dim">
              stays here till {new Date(`${until}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toLowerCase()} · tap it anytime
            </p>
          </div>
        </motion.div>
      </motion.div>
      <Roller />
    </motion.div>
  );
}

/** A rolled scroll's end: a short column of dots. */
const RollEnd = () => (
  <span className="flex shrink-0 flex-col gap-[3px]" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span key={i} className="size-[3px] rounded-full bg-mute" />
    ))}
  </span>
);

/** Rolled up: a capsule that sways now and then, with a light sweep and a live red dot. */
function RolledScroll({ until, onOpen }: { until: string; onOpen: () => void }) {
  return (
    <motion.div key="rolled" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.3 }} className="flex justify-center">
      <motion.button
        onClick={() => {
          buzz(10);
          onOpen();
        }}
        aria-label="open the new college game rules"
        animate={{ rotate: [0, -1.2, 1, -0.6, 0] }}
        transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 3.4, ease: "easeInOut" }}
        whileTap={{ scale: 0.97 }}
        className="relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-full border border-line-2 bg-ink-2 py-3 pr-4 pl-4 transition-colors hover:border-mute"
      >
        {/* Light sweep. */}
        <motion.span
          className="pointer-events-none absolute inset-y-0 w-24 -skew-x-12"
          style={{ background: "linear-gradient(to right, transparent, color-mix(in srgb, var(--color-fg) 9%, transparent), transparent)" }}
          initial={{ left: "-25%" }}
          animate={{ left: ["-25%", "125%"] }}
          transition={{ duration: 1.3, repeat: Infinity, repeatDelay: 3.2, ease: "easeInOut" }}
        />
        <RollEnd />
        <motion.span className="size-1.5 shrink-0 rounded-full bg-red" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
        <span className="text-[15px] font-medium whitespace-nowrap">the new college game</span>
        <span className="ml-auto hidden font-mono text-[11.5px] whitespace-nowrap text-dim min-[360px]:inline">tap to read</span>
        <RollEnd />
      </motion.button>
      <span className="sr-only">shown till {until}</span>
    </motion.div>
  );
}

/** Home page: the rules scroll, while it's still in its 10 days. */
export function RulesScroll() {
  const { settings, setSettings } = useProgress();
  const { state } = useSync();
  const [open, setOpen] = useState<boolean | null>(null);
  const firstSeen = settings.seen?.[ID];
  // Decide only once this account's saved settings are in: writing "seen" before the first sync on a new device
  // would replace his real settings with this device's empty ones.
  const ready = state === "synced" || state === "off" || state === "signed-out";

  // Decided once per visit: writing "seen" below changes these inputs, and must not re-decide (or cancel the unroll).
  const decided = useRef(false);
  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    let openedHere = false;
    try {
      openedHere = localStorage.getItem(OPENED_KEY) === "1";
    } catch {
      // Private mode: it opens again next time, which is fine.
    }
    const mode = scrollMode(firstSeen, today(), openedHere, DAYS);
    if (mode === "first") setSettings({ seen: { ...settings.seen, [ID]: today() } });
    if (mode === "first" || mode === "reopen") {
      try {
        localStorage.setItem(OPENED_KEY, "1");
      } catch {
        // see above
      }
      // A beat after the page appears, so the unroll is seen.
      setTimeout(() => setOpen(true), 500);
    } else setOpen(false);
  }, [ready, firstSeen, settings.seen, setSettings]);

  const start = firstSeen ?? today();
  if (open === null || scrollMode(start, today(), true, DAYS) === "gone") return null;
  const until = lastDay(start, DAYS);
  return (
    <section className="pb-8" aria-label="announcement">
      <AnimatePresence mode="wait">
        {open ? (
          <OpenScroll
            until={until}
            onClose={() => {
              setOpen(false);
              // The button is far down a long scroll: glide back up with it so he lands on the top of the page.
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : <RolledScroll until={until} onOpen={() => setOpen(true)} />}
      </AnimatePresence>
    </section>
  );
}
