"use client";

import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { analysisError, biggestReason, emptyAnalysis, lostOf, needsAnalysis, REASONS, sortedOf, type Analysis, type Reason } from "../lib/analysis";
import { dayLabel } from "../lib/plan";
import { today, useProgress } from "../store/progress";
import { buzz, Segmented } from "./Controls";
import { DotBar } from "./ui";

// The analysis of one test: why each lost question was lost, and one line on what changes next time.
// The same fields sit in the score form (for when he's already done it) and on the test afterwards.

/** What to do about the reason that cost the most. */
const ADVICE: Record<Reason, string> = {
  silly: "slow down on the last step: units, signs, re-read the question.",
  concept: "redo the theory for those chapters before the next test.",
  unstudied: "fine for now. these come back once the chapters are done.",
  time: "skip sooner. don't sink 6 minutes into one question.",
};

const count = (v: string) => {
  const n = parseInt(v.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? 0 : Math.min(n, 500);
};

/** The four counters, the running total against wrong + skipped, and the note. Controlled. */
export function AnalysisFields({ value, onChange, lost }: { value: Analysis; onChange: (a: Analysis) => void; lost: number | null }) {
  const sorted = sortedOf(value);
  const full = lost != null && sorted >= lost;
  const set = (id: Reason, n: number) => onChange({ ...value, [id]: Math.max(0, n) });
  return (
    <div>
      <p className="mb-3 text-[13.5px] leading-snug text-mute">go through every question you got wrong or skipped. why did each one go?</p>
      <div className="divide-y divide-line/60">
        {REASONS.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px]">{r.label}</div>
              <div className="font-mono text-[11.5px] leading-snug text-dim">{r.hint}</div>
            </div>
            <div className="inline-flex shrink-0 items-center rounded-full border border-line-2">
              <button
                type="button"
                onClick={() => {
                  buzz();
                  set(r.id, value[r.id] - 1);
                }}
                disabled={value[r.id] === 0}
                aria-label={`one less ${r.label}`}
                className="grid size-8 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30"
              >
                <Minus className="size-3.5" />
              </button>
              <input
                inputMode="numeric"
                aria-label={`${r.label} questions`}
                value={value[r.id] || ""}
                placeholder="0"
                onChange={(e) => set(r.id, count(e.target.value))}
                onFocus={(e) => e.target.select()}
                className="w-9 bg-transparent text-center font-mono text-[16px] outline-none placeholder:text-dim"
              />
              <button
                type="button"
                onClick={() => {
                  buzz();
                  set(r.id, value[r.id] + 1);
                }}
                disabled={full}
                aria-label={`one more ${r.label}`}
                className="grid size-8 place-items-center rounded-full text-mute transition hover:text-fg disabled:opacity-30"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {lost != null && lost > 0 && (
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <DotBar value={sorted / lost} dots={Math.min(lost, 30)} size={5} />
          </div>
        )}
        <span className={`shrink-0 font-mono text-[12px] ${lost != null && sorted > lost ? "text-red" : sorted && sorted === lost ? "text-fg" : "text-dim"}`}>
          {lost != null ? (lost === 0 ? "nothing lost. clean test." : `${sorted} of ${lost} sorted`) : `${sorted} sorted · add wrong + skipped to check it adds up`}
        </span>
      </div>
      <label className="mt-4 block">
        <span className="font-mono text-[11px] tracking-wider text-mute uppercase">next time I&apos;ll…</span>
        <textarea
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value.slice(0, 500) })}
          rows={2}
          placeholder="e.g. check units before marking. revise rotation formulas."
          className="mt-1 w-full resize-none border-b border-line-2 bg-transparent py-1.5 text-[16px] leading-snug outline-none transition-colors placeholder:text-dim focus:border-fg"
        />
      </label>
    </div>
  );
}

/** "analysis: not yet / done" in a score form; "done" opens the fields. */
export function AnalysisToggle({ id, done, onDone, value, onChange, lost }: { id: string; done: boolean; onDone: (d: boolean) => void; value: Analysis; onChange: (a: Analysis) => void; lost: number | null }) {
  return (
    <div className="mt-4 border-t border-line/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-wider text-mute uppercase">analysis</span>
        <Segmented<"later" | "done">
          id={`analysis-${id}`}
          value={done ? "done" : "later"}
          onChange={(v) => onDone(v === "done")}
          options={[
            { value: "later", label: "not yet" },
            { value: "done", label: "done" },
          ]}
        />
      </div>
      <AnimatePresence initial={false}>
        {done && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="pt-3">
              <AnalysisFields value={value} onChange={onChange} lost={lost} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!done && <p className="mt-2 font-mono text-[11.5px] text-dim">do it within a day or two, while you still remember why.</p>}
    </div>
  );
}

/** A finished analysis: where the questions went, the biggest leak, and the note. */
export function AnalysisSummary({ a, lost }: { a: Analysis; lost: number | null }) {
  const top = biggestReason(a);
  const scale = Math.max(lost ?? 0, sortedOf(a), 1);
  return (
    <div>
      {top ? (
        <p className="text-[15px] leading-snug">
          most lost to <span className="font-semibold">{top.label}</span>. <span className="text-mute">{ADVICE[top.id]}</span>
        </p>
      ) : (
        <p className="text-[15px] text-mute">nothing sorted. {lost === 0 ? "clean test." : ""}</p>
      )}
      <div className="mt-3 space-y-1.5">
        {REASONS.map((r) => (
          <div key={r.id} className="flex items-center gap-3">
            <span className={`w-24 shrink-0 font-mono text-[12px] ${a[r.id] ? "text-fg" : "text-dim"}`}>{r.label}</span>
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <DotBar value={a[r.id] / scale} dots="auto" size={4} color={top?.id === r.id ? "var(--color-red)" : "var(--color-fg)"} />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[12px] text-mute">{a[r.id]}</span>
          </div>
        ))}
      </div>
      {a.note && <p className="mt-3 border-l border-line-2 pl-3 text-[14.5px] leading-snug text-mute">{a.note}</p>}
    </div>
  );
}

type Result = { analysis?: Analysis | null; wrong: number | null; unattempted: number | null; score: number | null; takenOn: string | null; imported?: boolean };

/** The analysis of a logged test on its own page: a nudge while it's missing, the summary once it's in. */
export function AnalysisPanel({ kind, id, result }: { kind: "test" | "quizrr"; id: string; result: Result }) {
  const saveAnalysis = useProgress((s) => s.saveAnalysis);
  const t = today();
  const lost = lostOf(result);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Analysis>(() => result.analysis ?? emptyAnalysis(t));
  const error = analysisError(draft, lost);
  const pending = needsAnalysis(result, t);

  const open = () => {
    setDraft(result.analysis ?? emptyAnalysis(t));
    setEditing(true);
  };
  const save = () => {
    if (error) return;
    buzz(12);
    saveAnalysis(kind, id, { ...draft, on: result.analysis?.on ?? t });
    setEditing(false);
  };

  if (editing)
    return (
      <div className="rounded-lg border border-line-2 p-4">
        <AnalysisFields value={draft} onChange={setDraft} lost={lost} />
        {error && <p className="mt-3 font-mono text-[12px] text-red">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={save} disabled={!!error} data-cursor="go" className="rounded-full bg-fg px-4 py-2 text-[14px] font-medium text-ink disabled:opacity-40">
            save analysis
          </motion.button>
          <button onClick={() => setEditing(false)} className="rounded-full px-3 py-2 text-[14px] text-mute hover:text-fg">
            cancel
          </button>
          {result.analysis && (
            <button
              onClick={() => {
                buzz(20);
                saveAnalysis(kind, id, null);
                setEditing(false);
              }}
              data-cursor="danger"
              className="ml-auto rounded-full px-3 py-2 font-mono text-[12px] text-mute hover:text-red"
            >
              remove
            </button>
          )}
        </div>
      </div>
    );

  if (result.analysis)
    return (
      <button onClick={open} className="-m-1 block w-[calc(100%+0.5rem)] rounded-md p-1 text-left transition hover:bg-ink-2" aria-label="edit the analysis">
        <AnalysisSummary a={result.analysis} lost={lost} />
        <span className="mt-3 block font-mono text-[12px] text-dim">done {dayLabel(result.analysis.on, t)} · tap to edit</span>
      </button>
    );

  return (
    <div>
      <p className={`text-[14.5px] leading-snug ${pending ? "text-fg" : "text-mute"}`}>
        {pending ? "not done yet. " : "no analysis logged. "}
        <span className="text-mute">sort the {lost != null ? `${lost} ` : ""}questions you lost by why you lost them. takes 10 minutes, saves marks next time.</span>
      </p>
      <button
        onClick={open}
        data-cursor="go"
        className={`mt-3 rounded-full px-4 py-2 text-[14px] font-medium ${pending ? "bg-fg text-ink" : "border border-line-2 text-mute hover:border-fg hover:text-fg"}`}
      >
        analyse this test
      </button>
    </div>
  );
}

/** Small label for a section header: "pending" in red while a recent test waits for its analysis. */
export function AnalysisState({ result }: { result: Result }) {
  if (result.analysis) return <span className="text-mute">done</span>;
  return needsAnalysis(result, today()) ? <span className="text-red">pending</span> : null;
}

