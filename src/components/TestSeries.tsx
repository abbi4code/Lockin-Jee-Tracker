"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { getChapter, getTrack, tracksForChapter, type Track } from "../data";
import { celebrate } from "../lib/celebrate";
import { pct, scoreTone, trackProgress, type TestResult } from "../lib/tests";
import { today, useProgress } from "../store/progress";
import { buzz } from "./Controls";
import { Label, Section } from "./ui";

type Slot = { trackId: string; kind: TestResult["kind"]; testNo: number };

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const input = "w-full border-b border-line-2 bg-transparent py-1.5 font-mono text-[15px] outline-none transition-colors placeholder:text-dim focus:border-fg";

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="font-mono text-[11px] tracking-wider text-mute uppercase">{label}</span>
      {children}
    </label>
  );
}

/** Inline form to log or edit one test. */
function Editor({ slot, existing, onClose }: { slot: Slot; existing?: TestResult; onClose: () => void }) {
  const { saveTest, deleteTest, lastMaxScore, tests } = useProgress();
  const [f, setF] = useState({
    score: existing?.score?.toString() ?? "",
    max: (existing?.maxScore ?? lastMaxScore ?? "").toString(),
    date: existing?.takenOn ?? today(),
    correct: existing?.correct?.toString() ?? "",
    wrong: existing?.wrong?.toString() ?? "",
    unattempted: existing?.unattempted?.toString() ?? "",
    time: existing?.timeMin?.toString() ?? "",
  });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const score = num(f.score);
  const max = num(f.max);
  const invalid = (score != null && Number.isNaN(score)) || (max != null && (Number.isNaN(max) || max <= 0)) || (score != null && max != null && score > max);

  const save = () => {
    if (invalid) return;
    buzz(12);
    const track = getTrack(slot.trackId);
    const before = trackDone(slot.trackId, tests);
    saveTest({
      id: existing?.id ?? crypto.randomUUID(),
      trackId: slot.trackId,
      kind: slot.kind,
      testNo: slot.testNo,
      takenOn: f.date || null,
      score,
      maxScore: max,
      correct: num(f.correct),
      wrong: num(f.wrong),
      unattempted: num(f.unattempted),
      timeMin: num(f.time),
    });
    // Finished the whole MathonGo chapter: small celebration.
    if (!existing && slot.kind === "chapterwise" && track && before + 1 === track.tests) {
      const subject = getChapter(track.chapterIds[0])?.subject;
      if (subject) celebrate(subject);
    }
    onClose();
  };

  const p = score != null && max ? Math.round((score / max) * 100) : null;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mt-4 rounded-lg border border-line-2 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <Label>
            {slot.kind === "pyq" ? "pyq test" : "test"} {slot.testNo}
            {existing?.imported && existing.score == null ? " · imported, add score" : ""}
          </Label>
          {p != null && (
            <span className="font-mono text-[13px]" style={{ color: scoreTone(p) }}>
              {p}%
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Field label="marks">
            <input inputMode="decimal" value={f.score} onChange={set("score")} placeholder="e.g. 64" className={input} autoFocus />
          </Field>
          <Field label="out of">
            <input inputMode="decimal" value={f.max} onChange={set("max")} placeholder="e.g. 100" className={input} />
          </Field>
          <Field label="date">
            <input type="date" value={f.date} onChange={set("date")} className={input} />
          </Field>
          <Field label="correct">
            <input inputMode="numeric" value={f.correct} onChange={set("correct")} placeholder="–" className={input} />
          </Field>
          <Field label="wrong">
            <input inputMode="numeric" value={f.wrong} onChange={set("wrong")} placeholder="–" className={input} />
          </Field>
          <Field label="skipped">
            <input inputMode="numeric" value={f.unattempted} onChange={set("unattempted")} placeholder="–" className={input} />
          </Field>
          <Field label="time (min)">
            <input inputMode="numeric" value={f.time} onChange={set("time")} placeholder="–" className={input} />
          </Field>
        </div>
        {invalid && <p className="mt-3 font-mono text-[12px] text-red">marks can&apos;t be more than the max, and max must be above 0.</p>}
        <div className="mt-4 flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={save} disabled={invalid} className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
            save
          </motion.button>
          <button onClick={onClose} className="rounded-full px-3 py-2 text-[14px] text-mute hover:text-fg">
            cancel
          </button>
          {existing && (
            <button
              onClick={() => {
                buzz(20);
                deleteTest(existing.id);
                onClose();
              }}
              data-cursor="danger"
              className="ml-auto rounded-full px-3 py-2 font-mono text-[12px] text-mute hover:text-red"
            >
              remove
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function trackDone(trackId: string, tests: Record<string, TestResult>) {
  return new Set(Object.values(tests).filter((t) => !t.deleted && t.trackId === trackId && t.kind === "chapterwise").map((t) => t.testNo)).size;
}

/** One numbered square per test. Filled = done, shaded by score; imported-without-score shows a tick. */
function SlotButton({ n, result, active, onClick }: { n: number; result?: TestResult; active: boolean; onClick: () => void }) {
  const p = result ? pct(result) : null;
  const done = !!result;
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={`test ${n}${done ? (p != null ? `, ${Math.round(p)}%` : ", done") : ", not taken"}`}
      className={`relative grid size-9 place-items-center rounded-md border font-mono text-[12px] transition-colors ${active ? "ring-2 ring-fg ring-offset-2 ring-offset-ink" : ""}`}
      style={
        done
          ? { background: p != null ? scoreTone(p) : "var(--color-dim)", borderColor: "transparent", color: "var(--color-ink)" }
          : { borderColor: "var(--color-line-2)", color: "var(--color-dim)" }
      }
      title={done ? (p != null ? `${result!.score}/${result!.maxScore} (${Math.round(p)}%)` : "done (imported, no score)") : "not taken"}
    >
      {done && p == null ? "✓" : n}
    </motion.button>
  );
}

function TrackBlock({ track, chapterId }: { track: Track; chapterId: string }) {
  const tests = useProgress((s) => s.tests);
  const [open, setOpen] = useState<Slot | null>(null);
  const prog = trackProgress(track, tests);
  const byNo = new Map(prog.chapterwise.map((t) => [t.testNo, t]));
  const shared = track.chapterIds.filter((id) => id !== chapterId).map((id) => getChapter(id)?.name).filter(Boolean);
  const existing = open ? (open.kind === "pyq" ? prog.pyq.find((t) => t.testNo === open.testNo) : byNo.get(open.testNo)) : undefined;
  const toggle = (slot: Slot) => setOpen((o) => (o && o.trackId === slot.trackId && o.kind === slot.kind && o.testNo === slot.testNo ? null : slot));

  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[15px]">{track.name}</span>
        <span className="font-mono text-[12px] text-mute">
          {prog.done}/{prog.total} done · {prog.left} left{prog.avg != null ? ` · avg ${Math.round(prog.avg)}%` : ""}
        </span>
      </div>
      {shared.length > 0 && <p className="-mt-1 mb-2.5 font-mono text-[11px] text-dim">shared with {shared.join(", ")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: track.tests }, (_, i) => i + 1).map((n) => (
          <SlotButton key={n} n={n} result={byNo.get(n)} active={open?.kind === "chapterwise" && open.testNo === n} onClick={() => toggle({ trackId: track.id, kind: "chapterwise", testNo: n })} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-dim">pyq</span>
        {prog.pyq.map((t) => (
          <SlotButton key={t.id} n={t.testNo} result={t} active={open?.kind === "pyq" && open.testNo === t.testNo} onClick={() => toggle({ trackId: track.id, kind: "pyq", testNo: t.testNo })} />
        ))}
        <button
          onClick={() => toggle({ trackId: track.id, kind: "pyq", testNo: Math.max(0, ...prog.pyq.map((t) => t.testNo)) + 1 })}
          className="grid size-9 place-items-center rounded-md border border-dashed border-line-2 text-dim transition hover:border-fg hover:text-fg"
          aria-label="add a PYQ test"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <AnimatePresence>{open && <Editor key={`${open.kind}-${open.testNo}`} slot={open} existing={existing} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

/** MathonGo test-series progress for a chapter: tests left, scores, and logging. */
export function TestSeriesPanel({ chapterId }: { chapterId: string }) {
  const tracks = tracksForChapter(chapterId);
  const tests = useProgress((s) => s.tests);
  if (!tracks.length) return null;
  const total = tracks.reduce((n, t) => n + t.tests, 0);
  const done = tracks.reduce((n, t) => n + trackProgress(t, tests).done, 0);
  return (
    <Section label="mathongo tests" right={`${total - done} left`}>
      {tracks.map((t) => (
        <TrackBlock key={t.id} track={t} chapterId={chapterId} />
      ))}
      <p className="mt-4 font-mono text-[11px] text-dim">tap a square to log a test · colour = score (red &lt;40%, grey 40–70%, solid &gt;70%)</p>
    </Section>
  );
}
