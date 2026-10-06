"use client";

import { BellRing, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { currentSubscription, disablePush, enablePush, isInstalled, isIOS, pushSupported, sendTestPush } from "../lib/push-client";
import { useSync } from "../lib/sync";
import { useProgress, type Reminders } from "../store/progress";
import { buzz } from "./Controls";
import { Section } from "./ui";

const DEFAULTS: Omit<Reminders, "tz"> = { morning: "07:00", evening: "20:30" };
// Every 30 minutes; the reminder job runs every 15, so a reminder lands within ~15 min of its time.
const times = (from: number, to: number) => Array.from({ length: (to - from) * 2 + 1 }, (_, i) => `${String(from + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const MORNING = times(4, 12);
const EVENING = times(16, 23);
const label = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

function TimeSelect({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? "off"}
      onChange={(e) => onChange(e.target.value === "off" ? null : e.target.value)}
      className="appearance-none rounded-full border border-line-2 bg-transparent px-3.5 py-1.5 font-mono text-[13px] text-fg outline-none hover:border-fg"
    >
      <option value="off">off</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {label(t)}
        </option>
      ))}
    </select>
  );
}

/** Me page: turn push reminders on for this device and pick the morning / evening times. */
export function RemindersSection() {
  const { settings, setSettings } = useProgress();
  const { user } = useSync();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [env, setEnv] = useState({ supported: true, iosBrowser: false });
  const r = settings.reminders;

  useEffect(() => {
    setEnv({ supported: pushSupported(), iosBrowser: isIOS() && !isInstalled() });
    currentSubscription().then((s) => setOn(!!s));
  }, []);

  const saveTimes = (patch: Partial<Omit<Reminders, "tz">>) =>
    setSettings({ reminders: { ...DEFAULTS, ...r, ...patch, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });

  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        if (!r) saveTimes({});
        setOn(true);
        buzz(12);
        setMsg("on. use “send a test” to check it arrives.");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setMsg("sending…");
    try {
      const n = await sendTestPush();
      setMsg(n ? `sent to ${n} device${n === 1 ? "" : "s"}.` : "no device is subscribed yet.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Section label="reminders" right={on ? "on for this device" : on === false ? "off" : undefined}>
      <p className="text-[14px] text-mute">A morning note with today&apos;s plan, and an evening nudge only if something planned is still open. They arrive even when the app is closed.</p>

      {env.iosBrowser ? (
        <p className="mt-4 text-[14px] text-fg">On iPhone, add lockin. to your home screen first (Share → Add to Home Screen), then open it from there and turn reminders on.</p>
      ) : !env.supported ? (
        <p className="mt-4 font-mono text-[12.5px] text-dim">this browser can&apos;t receive notifications.</p>
      ) : !user ? (
        <p className="mt-4 font-mono text-[12.5px] text-dim">sign in to turn reminders on.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={toggle}
            disabled={busy || on === null}
            data-cursor={on ? undefined : "go"}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] transition disabled:opacity-60 ${on ? "border border-line-2 text-mute hover:border-red hover:text-red" : "bg-fg font-medium text-ink"}`}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
            {on ? "turn off on this device" : "turn on reminders"}
          </button>
          {on && (
            <button onClick={test} className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
              send a test
            </button>
          )}
        </div>
      )}

      <div className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px]">morning plan</span>
          <TimeSelect value={r ? r.morning : DEFAULTS.morning} options={MORNING} onChange={(morning) => saveTimes({ morning })} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px]">evening nudge</span>
          <TimeSelect value={r ? r.evening : DEFAULTS.evening} options={EVENING} onChange={(evening) => saveTimes({ evening })} />
        </div>
      </div>
      {msg && <p className="mt-3 font-mono text-[12.5px] text-mute">{msg}</p>}
    </Section>
  );
}
