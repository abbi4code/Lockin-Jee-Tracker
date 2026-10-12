"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ALL_CHAPTERS, chapterInScope, getChapter, SUBJECT_COLOR, SUBJECTS } from "../data";
import { addDays, dayLabel } from "../lib/plan";
import { dayOf, EDITABLE_DAYS, endOf, MAX_SESSION_MIN, overlaps } from "../lib/sessions";
import { formatMinutes } from "../lib/stats";
import { timerElapsed, today, useProgress, type StudySession } from "../store/progress";
import { buzz } from "./Controls";
import { DotText, Label, Section, Tag } from "./ui";

const PRESETS = [25, 50, 60, 90, 120, 180];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** A local date + "HH:MM" as a Date. */
const at = (day: string, time: string) => new Date(`${day}T${time}:00`);

/** Chapter dropdown: chapters being worked on first, then every chapter in scope by subject. */
export function ChapterSelect({ value, onChange, className = "" }: { value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const { chapters, settings } = useProgress();
  const inProgress = ALL_CHAPTERS.filter((c) => chapters[c.id]?.status === "working").map((c) => c.id);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full appearance-none border-b border-line-2 bg-transparent py-2.5 text-[16px] outline-none focus:border-fg ${className}`}
    >
      <option value="">no specific chapter</option>
      {inProgress.length > 0 && (
        <optgroup label="in progress">
          {inProgress.map((id) => (
            <option key={id} value={id}>
              {getChapter(id)?.name}
            </option>
          ))}
        </optgroup>
      )}
      {SUBJECTS.map((s) => (
        <optgroup key={s.id} label={s.name}>
          {s.chapters
            .filter((c) => chapterInScope(c, settings.exam))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

interface Draft {
  chapterId: string | null;
  time: string;
  minutes: number;
}

/** Add or fix one session. Blocks times in the future and overlaps, so nothing gets counted twice. */
function Editor({ day, session, notice, onDone }: { day: string; session: StudySession | null; notice: string | null; onDone: () => void }) {
  const { sessions, timer, addSession, editSession, deleteSession } = useProgress();
  const [draft, setDraft] = useState<Draft>(() => {
    if (session) return { chapterId: session.chapterId, time: hhmm(new Date(session.startedAt)), minutes: session.minutes };
    // New: an hour ending now (today, not before midnight), or 6 pm on an earlier day.
    const start = new Date(Date.now() - 60 * 60_000);
    return { chapterId: timer.chapterId, time: day === today() ? (dayOf(start.toISOString()) === day ? hhmm(start) : "00:00") : "18:00", minutes: 60 };
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const start = at(day, draft.time);
  const end = new Date(start.getTime() + draft.minutes * 60_000);
  const timeChanged = !session || session.minutes !== draft.minutes || new Date(session.startedAt).getTime() !== start.getTime();
  // The running timer counts too: time typed in over it would be logged twice when it stops.
  const running = timer.sessionStart ? [{ id: "timer", startedAt: new Date(timer.sessionStart).toISOString(), minutes: Math.max(1, Math.ceil(timerElapsed(timer) / 60_000)) } as StudySession] : [];
  const clash = timeChanged ? overlaps([...sessions, ...running], start, draft.minutes, session?.id)[0] : undefined;
  const error = !draft.time
    ? "pick a start time."
    : timeChanged && end.getTime() > Date.now() + 60_000
      ? "that ends in the future. start earlier or make it shorter."
      : clash
        ? clash.id === "timer"
          ? "overlaps the timer that's running now."
          : `overlaps your ${clock(new Date(clash.startedAt))} session (${formatMinutes(clash.minutes)}).`
        : null;

  const step = (n: number) => {
    buzz(6);
    setDraft((d) => ({ ...d, minutes: Math.min(MAX_SESSION_MIN, Math.max(5, d.minutes + n)) }));
  };
  const save = () => {
    if (error) return;
    buzz(12);
    if (session) editSession(session.id, { chapterId: draft.chapterId, startedAt: start.toISOString(), minutes: draft.minutes });
    else addSession({ chapterId: draft.chapterId, startedAt: start.toISOString(), minutes: draft.minutes });
    onDone();
  };

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
      <div data-testid="session-editor" className="my-2 rounded-xl border border-line-2 p-4">
        <Label>{session ? (session.source === "manual" ? "edit time" : "fix this session") : `add time · ${dayLabel(day, today())}`}</Label>
        {notice && <p className="mt-2 text-[14px] leading-snug text-red">{notice}</p>}

        <ChapterSelect value={draft.chapterId} onChange={(chapterId) => setDraft((d) => ({ ...d, chapterId }))} className="mt-2" />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-mute">start</span>
            {/* 16px: iPhones zoom into smaller fields. */}
            <input
              type="time"
              value={draft.time}
              onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
              className="rounded-full border border-line-2 bg-transparent px-3 py-1.5 font-mono text-[16px] text-fg outline-none focus:border-fg"
            />
          </label>
          <span className="font-mono text-[12px] text-dim">ends {draft.time ? clock(end) : "–"}</span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono text-[12px] text-mute">length</span>
          <div className="flex items-center gap-3">
            <button onClick={() => step(-5)} aria-label="5 minutes less" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
              <Minus className="size-4" />
            </button>
            <DotText className="min-w-[5.5rem] text-center text-2xl leading-none">{formatMinutes(draft.minutes)}</DotText>
            <button onClick={() => step(5)} aria-label="5 minutes more" className="grid size-9 place-items-center rounded-full border border-line-2 text-mute transition hover:border-fg hover:text-fg">
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
          {PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => {
                buzz(6);
                setDraft((d) => ({ ...d, minutes: m }));
              }}
              className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[12px] transition-colors ${draft.minutes === m ? "border-fg bg-fg text-ink" : "border-line-2 text-mute hover:text-fg"}`}
            >
              {formatMinutes(m)}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 font-mono text-[12px] text-red">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button onClick={save} disabled={!!error} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink transition disabled:opacity-30">
            {session ? "save" : "add"}
          </button>
          <button onClick={onDone} className="rounded-full border border-line-2 px-4 py-2 text-[14px] text-mute transition hover:border-fg hover:text-fg">
            cancel
          </button>
          {session && (
            <button
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                buzz(20);
                deleteSession(session.id);
                onDone();
              }}
              data-cursor="danger"
              className={`ml-auto rounded-full px-3 py-2 text-[14px] transition ${confirmDelete ? "bg-red text-ink" : "text-mute hover:text-red"}`}
            >
              {confirmDelete ? "tap again to delete" : "delete"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Opens one session's editor from outside (the "edit" after stopping the timer). `key` re-triggers the same id. */
export type OpenRequest = { id: string; notice: string | null; key: number };

/**
 * Focus page: the study log for the last week. Tap a session to fix it (forgot to stop the timer), or add time
 * studied without it (forgot to start). Added and edited sessions are marked, here and in the admin panel.
 */
export function SessionLog({ open }: { open: OpenRequest | null }) {
  const sessions = useProgress((s) => s.sessions);
  const t = today();
  const oldest = addDays(t, -(EDITABLE_DAYS - 1));
  const [day, setDay] = useState(t);
  const [editing, setEditing] = useState<string | null>(null); // session id, or "new"
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const s = useProgress.getState().sessions.find((x) => x.id === open.id);
    if (!s) return;
    setDay(dayOf(s.startedAt));
    setEditing(s.id);
    setNotice(open.notice);
    // On phones the log is far below the timer: bring the editor into view.
    const t = setTimeout(() => document.querySelector(`[data-session="${s.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    return () => clearTimeout(t);
  }, [open]);

  const list = sessions.filter((s) => dayOf(s.startedAt) === day);
  const total = list.reduce((n, s) => n + s.minutes, 0);
  const go = (n: number) => {
    setEditing(null);
    setDay((d) => addDays(d, n));
  };
  const close = () => {
    setEditing(null);
    setNotice(null);
  };
  const editor = (session: StudySession | null) => <Editor key={session?.id ?? `new-${day}`} day={day} session={session} notice={session ? notice : null} onDone={close} />;

  return (
    <Section label="log" right={formatMinutes(total)}>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => go(-1)} disabled={day <= oldest} aria-label="previous day" className="grid size-8 place-items-center rounded-full border border-line-2 text-mute transition hover:text-fg disabled:opacity-30">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-28 text-center font-mono text-[12.5px] text-fg">{dayLabel(day, t)}</span>
        <button onClick={() => go(1)} disabled={day >= t} aria-label="next day" className="grid size-8 place-items-center rounded-full border border-line-2 text-mute transition hover:text-fg disabled:opacity-30">
          <ChevronRight className="size-4" />
        </button>
        <button
          onClick={() => {
            setNotice(null);
            setEditing(editing === "new" ? null : "new");
          }}
          className={`ml-auto flex items-center gap-1 rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors ${editing === "new" ? "border-fg text-fg" : "border-line-2 text-mute hover:border-fg hover:text-fg"}`}
        >
          <Plus className="size-3.5" /> add time
        </button>
      </div>

      <AnimatePresence initial={false}>{editing === "new" && editor(null)}</AnimatePresence>

      {list.length === 0 && editing !== "new" && (
        <p className="py-2 font-mono text-[13px] text-dim">{day === t ? "no sessions yet today." : "nothing logged this day."} studied without the timer? add it.</p>
      )}
      <div>
        {[...list].reverse().map((s) => {
          const c = s.chapterId ? getChapter(s.chapterId) : null;
          const open = editing === s.id;
          return (
            <div key={s.id} data-session={s.id}>
              <button
                onClick={() => {
                  setNotice(null);
                  setEditing(open ? null : s.id);
                }}
                aria-expanded={open}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left text-[15px] transition hover:bg-ink-2 ${open ? "bg-ink-2" : ""}`}
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: c ? SUBJECT_COLOR[c.subject] : "var(--color-dim)" }} />
                <span className="min-w-0 flex-1 truncate">{c?.name ?? "general study"}</span>
                {(s.source === "manual" || s.edited) && <Tag>{s.source === "manual" ? "added" : "edited"}</Tag>}
                <span className="hidden font-mono text-[12px] text-dim sm:inline">
                  {clock(new Date(s.startedAt))} – {clock(endOf(s))}
                </span>
                <span className="font-mono text-[12px] text-dim sm:hidden">{clock(new Date(s.startedAt))}</span>
                <span className="w-16 text-right font-mono text-[13px] text-mute">{formatMinutes(s.minutes)}</span>
              </button>
              <AnimatePresence initial={false}>{open && editor(s)}</AnimatePresence>
            </div>
          );
        })}
      </div>
      {day !== t && day <= oldest && <p className="mt-3 font-mono text-[11.5px] text-dim">the log can be changed for the last {EDITABLE_DAYS} days.</p>}
    </Section>
  );
}
