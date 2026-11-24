"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getChapter } from "../data";
import { AIM_PRESETS, clampAim, clampSolved, formatPace, MAX_AIM, MAX_SOLVED } from "../lib/focus";
import { formatMinutes } from "../lib/stats";
import { useProgress, type StudySession } from "../store/progress";
import { buzz } from "./Controls";
import { Label } from "./ui";

// Questions in focus sessions, the pieces the focus page, the timer pill and the log share: a number stepper, the
// aim picker (before starting) and the "how many did you solve?" prompt (when a session with an aim ends).

/**
 * −  12  +, with the number typeable. `nullable`: empty shows "–" and means "not said". 16px+ text: iPhones zoom into
 * smaller fields.
 */
export function Stepper({ value, onChange, max, label, nullable = false, big = false }: { value: number | null; onChange: (n: number | null) => void; max: number; label: string; nullable?: boolean; big?: boolean }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  // Follow changes from outside (presets, a reset), but not while the field shows the same number.
  useEffect(() => setText((t) => (Number(t) === value && t !== "" ? t : value == null ? "" : String(value))), [value]);
  const step = (n: number) => {
    buzz(6);
    onChange(Math.min(max, Math.max(0, (value ?? 0) + n)));
  };
  const button = "grid size-9 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg disabled:opacity-30";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => step(-1)} disabled={value == null || value <= 0} aria-label={`one less (${label})`} className={button}>
        <Minus className="size-4" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        placeholder={nullable ? "–" : "0"}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
          setText(digits);
          if (digits === "") return onChange(nullable ? null : 0);
          onChange(Math.min(max, Number(digits)));
        }}
        onBlur={() => setText(value == null ? "" : String(value))}
        onFocus={(e) => e.target.select()}
        className={`dot w-14 bg-transparent text-center leading-none text-fg outline-none placeholder:text-dim ${big ? "text-[34px]" : "text-[26px]"}`}
      />
      <button type="button" onClick={() => step(1)} disabled={(value ?? 0) >= max} aria-label={`one more (${label})`} className={button}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Before starting: how many questions this session is for (none for theory or a lecture), and the pace that needs. */
export function AimPicker({ minutes }: { minutes: number | null }) {
  const aim = useProgress((s) => s.timer.aim ?? null);
  const timerSet = useProgress((s) => s.timerSet);
  const set = (n: number | null) => timerSet({ aim: n ? clampAim(n) : null });
  const value = aim ?? 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Label>questions to solve</Label>
        <span className="font-mono text-[12px] text-dim">{value > 0 && minutes ? `≈ ${formatPace(minutes / value)}` : value > 0 ? "" : "theory, a lecture: none"}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {AIM_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                buzz(6);
                set(n);
              }}
              aria-pressed={value === n}
              className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[12.5px] transition-colors ${value === n ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:border-fg hover:text-fg"}`}
            >
              {n === 0 ? "none" : n}
            </button>
          ))}
        </div>
        <Stepper value={value} onChange={(n) => set(n)} max={MAX_AIM} label="questions to solve" />
      </div>
    </div>
  );
}

// "Later" on the prompt: not asked again on this device until the tab closes (the log still shows it unanswered).
const LATER_KEY = "lockin-focus-later";
const putOff = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(LATER_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);
let putOffVersion = 0;
const putOffListeners = new Set<() => void>();
export function askLater(id: string) {
  putOff.add(id);
  putOffVersion++;
  try {
    sessionStorage.setItem(LATER_KEY, JSON.stringify([...putOff]));
  } catch {
    // Private mode: forgotten on reload, which is fine.
  }
  putOffListeners.forEach((l) => l());
}
/** The sessions put off on this device (re-renders when one is added). */
export function usePutOff(): ReadonlySet<string> {
  useSyncExternalStore(
    (l) => (putOffListeners.add(l), () => void putOffListeners.delete(l)),
    () => putOffVersion,
    () => 0,
  );
  return putOff;
}

/**
 * "how many did you solve?" for a session with an aim that just ended. Starts at the aim, so hitting it is one tap.
 * `onSaved` gets the number (the caller says how it went); "later" leaves it unanswered in the log.
 */
export function SolvedPrompt({ session, onSaved, onLater, compact = false }: { session: StudySession; onSaved: (solved: number) => void; onLater: () => void; compact?: boolean }) {
  const setSolved = useProgress((s) => s.setSolved);
  const aim = session.aim ?? 0;
  const [solved, setDraft] = useState<number>(aim);
  const chapter = session.chapterId ? getChapter(session.chapterId) : null;
  const save = () => {
    buzz(12);
    const n = clampSolved(solved);
    setSolved(session.id, n);
    onSaved(n);
  };
  return (
    <div data-testid="solved-prompt" className={compact ? "" : "rounded-xl border border-line-2 p-4 text-left"}>
      <p className="font-mono text-[12px] text-mute">
        {formatMinutes(session.minutes)}
        {chapter ? ` on ${chapter.name}` : ""} · aim {aim}
      </p>
      <p className={`mt-1 text-fg ${compact ? "text-[14.5px]" : "text-[16px]"}`}>how many did you solve?</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2.5">
          <Stepper value={solved} onChange={(n) => setDraft(n ?? 0)} max={MAX_SOLVED} label="questions solved" big={!compact} />
          <span className="font-mono text-[12.5px] text-dim">of {aim}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onLater} className="rounded-full px-3 py-2 text-[14px] text-mute transition hover:text-fg">
            later
          </button>
          <button type="button" onClick={save} data-cursor="go" className="rounded-full bg-fg px-5 py-2 text-[14px] font-medium text-ink">
            save
          </button>
        </div>
      </div>
    </div>
  );
}
