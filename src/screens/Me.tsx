"use client";

import { motion } from "motion/react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { buzz, Segmented } from "../components/Controls";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { RemindersSection } from "../components/RemindersSection";
import { Page } from "../components/Shell";
import { DotText, fadeUp, Label, Section } from "../components/ui";
import type { Exam } from "../data";
import { currentPlan, DEFAULT_HOURS, HOUR_OPTIONS, WEEKDAYS, withPlan } from "../lib/coaching";
import { DEFAULT_TARGETS, type Targets } from "../lib/college";
import { formatMinutes, streak, subjectStats } from "../lib/stats";
import { signOut, useSync, type SyncState } from "../lib/sync";
import { setWeight, useWeight, WEIGHTS, type WeightId } from "../lib/theme";
import { useProgress } from "../store/progress";

const SYNC_TEXT: Record<SyncState, string> = {
  off: "local only",
  "signed-out": "not signed in",
  syncing: "syncing",
  synced: "synced",
  offline: "offline · will sync later",
  error: "sync error · retrying",
};

const TARGET_ROWS: { key: keyof Targets; label: string; unit: string; options: number[] }[] = [
  { key: "hoursCoaching", label: "hours on coaching days", unit: "h", options: [6, 7, 8, 9, 10] },
  { key: "hoursOff", label: "hours on other days", unit: "h", options: [8, 9, 10, 11, 12] },
  { key: "questions", label: "questions a day", unit: "", options: [40, 60, 80, 100, 120] },
];

export function MeScreen({ isAdmin }: { isAdmin: boolean }) {
  const store = useProgress();
  const { state, user } = useSync();
  const all = subjectStats("all", store.chapters, store.settings.exam);
  const topicsTicked = Object.values(store.chapters).reduce((n, p) => n + Object.keys(p.topics).length, 0);
  const minutes = store.sessions.reduce((n, s) => n + s.minutes, 0);
  const st = streak(store.activity);
  const weight = useWeight();
  const coaching = store.settings.coaching;
  const plan = currentPlan(coaching);
  const targets = store.settings.targets ?? DEFAULT_TARGETS;

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ chapters: store.chapters, settings: store.settings, activity: store.activity, sessions: store.sessions }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lockin-backup-${new Date().toLocaleDateString("en-CA")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Page>
      <motion.header variants={fadeUp} className="pb-8">
        <Label>you</Label>
        <input
          value={store.settings.name}
          onChange={(e) => store.setSettings({ name: e.target.value.slice(0, 24) })}
          placeholder="your name"
          className="mt-3 w-full bg-transparent text-[34px] leading-none font-semibold tracking-tight outline-none placeholder:text-dim lg:text-[48px]"
        />
        {user?.email && <p className="mt-3 font-mono text-[12px] text-mute">{user.email}</p>}
      </motion.header>

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-14">
      <Section label="lifetime">
        <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-4">
          {[
            [all.done, "chapters done"],
            [topicsTicked, "topics ticked"],
            [formatMinutes(minutes), "focused"],
            [st.days, "day streak"],
          ].map(([v, l]) => (
            <div key={l}>
              <DotText className="block text-3xl">{v}</DotText>
              <div className="mt-1 font-mono text-[11.5px] text-mute">{l}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="appearance">
        <ThemeSwitcher showLabels />
        <p className="mt-3 text-[15px] text-mute">Paper and sepia are easier on the eyes in daylight and for long sessions.</p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Label>text weight</Label>
          <Segmented<WeightId>
            id="weight"
            value={weight}
            onChange={setWeight}
            // Each option is drawn in the weight it gives body text, so it previews itself.
            options={WEIGHTS.map((w) => ({ value: w.id, label: <span style={{ fontWeight: w.sample }}>{w.label}</span> }))}
          />
        </div>
        <p className="mt-3 text-[15px] text-mute">Heavier letters are easier to read on small screens and in bright light.</p>
      </Section>

      <Section label="exam scope">
        <Segmented<Exam>
          id="exam-me"
          value={store.settings.exam}
          onChange={(exam) => store.setSettings({ exam })}
          options={[
            { value: "main", label: "Main only" },
            { value: "advanced", label: "Main + Advanced" },
          ]}
        />
        <p className="mt-3 text-[14px] text-mute">Main only hides Advanced-only chapters and topics everywhere.</p>
      </Section>

      <Section label="coaching" right={plan?.days.length ? `${plan.days.length} days · ${plan.days.length * plan.hours}h a week` : "not set"}>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map((i) => {
            const label = WEEKDAYS[i];
            const on = !!plan?.days.includes(i);
            return (
              <button
                key={label}
                onClick={() => {
                  buzz();
                  const days = on ? plan!.days.filter((d) => d !== i) : [...(plan?.days ?? []), i].sort();
                  store.setSettings({ coaching: withPlan(coaching, { days }) });
                }}
                className={`w-12 rounded-full border py-1.5 font-mono text-[13px] transition-colors ${on ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:text-fg"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Label>hours per day</Label>
          <Segmented<string>
            id="coaching-hours"
            value={String(plan?.hours ?? DEFAULT_HOURS)}
            onChange={(h) => store.setSettings({ coaching: withPlan(coaching, { hours: Number(h) }) })}
            options={HOUR_OPTIONS.map((h) => ({ value: String(h), label: `${h}h` }))}
          />
        </div>
        <p className="mt-3 text-[14px] text-mute">Coaching days add these hours to your study time automatically. Skipped one? Untick it on the home screen.</p>
      </Section>

      <Section label="daily targets" right="for today's college">
        {TARGET_ROWS.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-1.5">
            <span className="text-[15px]">{row.label}</span>
            <Segmented<string>
              id={`target-${row.key}`}
              value={String(targets[row.key])}
              onChange={(v) => store.setSettings({ targets: { ...targets, [row.key]: Number(v) } })}
              options={row.options.map((n) => ({ value: String(n), label: `${n}${row.unit}` }))}
            />
          </div>
        ))}
        <p className="mt-3 text-[14px] text-mute">Hitting all three (plus good test scores) gets the top colleges. Going past a target counts up to 120%.</p>
      </Section>

      <RemindersSection />

      <Section
        label="account"
        right={
          <span className="flex items-center gap-1.5">
            {state === "syncing" && <LoaderCircle className="size-3 animate-spin" />}
            {SYNC_TEXT[state]}
          </span>
        }
      >
        {user ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-mute">Progress syncs to every device you sign in on.</p>
            <button onClick={signOut} data-cursor="danger" className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-red hover:text-red">
              sign out
            </button>
          </div>
        ) : (
          <p className="text-[14px] text-mute">Saved on this device only. Add the Supabase keys to .env to enable accounts and sync.</p>
        )}
      </Section>

      <Section label="backup">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[14px] text-mute">Download everything as a JSON file.</p>
          <button onClick={exportData} className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
            export
          </button>
        </div>
      </Section>

      {isAdmin && (
        <Section label="admin">
          <Link href="/admin" className="group flex items-center justify-between text-[15px]">
            open admin panel
            <ArrowUpRight className="size-4 text-dim group-hover:text-fg" />
          </Link>
        </Section>
      )}
      </div>
    </Page>
  );
}
