import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getChapter, type Exam } from "../data";
import { isStudied, normalizeStatus, type Status } from "../lib/stages";
import type { TestResult } from "../lib/tests";
import type { Coaching } from "../lib/coaching";
import type { Targets } from "../lib/college";
import type { PlanItem, PlanKind } from "../lib/plan";

export type { Status };
export type StepId = "lecture" | "notes" | "module" | "pyq" | "ncert";

export interface ChapterProgress {
  status: Status;
  topics: Record<string, true>;
  steps: Partial<Record<StepId, true>>;
  /** ISO dates of each revision after the chapter was done. */
  revisions: string[];
  /** 0 = 💀 … 4 = 🔥, null = not rated. */
  confidence: number | null;
  doneAt: string | null;
  updatedAt: number;
  /** Free-form notes for this chapter. */
  notes?: string;
  /** Things to fix in this chapter; ticked off when fixed. */
  weak?: WeakSpot[];
}

export interface WeakSpot {
  id: string;
  text: string;
  fixed: boolean;
  /** YYYY-MM-DD it was noted. */
  at: string;
}

/** Push reminder times ("HH:MM" in `tz`, null = off). The reminder job on the server reads these. */
export interface Reminders {
  morning: string | null;
  evening: string | null;
  tz: string;
}

export interface Settings {
  name: string;
  exam: Exam;
  /** Coaching schedule; its hours count as study time. Absent until set up on /me. */
  coaching?: Coaching;
  /** Daily targets for the college score. Absent = defaults (see lib/college.ts). */
  targets?: Targets;
  reminders?: Reminders;
}

/** Questions solved on one day, by subject. `at` = last edit, so the newest copy wins when devices sync. */
export interface QuestionDay {
  physics: number;
  chemistry: number;
  maths: number;
  at: number;
}

export interface StudySession {
  id: string;
  chapterId: string | null;
  subject: string | null;
  mode: TimerMode;
  startedAt: string; // ISO
  minutes: number;
}

export type TimerMode = "stopwatch" | "pomodoro";

export interface Timer {
  mode: TimerMode;
  /** Pomodoro length in minutes. */
  target: number;
  chapterId: string | null;
  /** When the current run started (ms), null while paused/stopped. */
  runningSince: number | null;
  /** Time banked from earlier runs of this session (ms). */
  banked: number;
  /** When the session first started (ms), null when idle. */
  sessionStart: number | null;
}

interface State {
  chapters: Record<string, ChapterProgress>;
  settings: Settings;
  /** Days (YYYY-MM-DD) with any study activity, for streaks. */
  activity: string[];
  stateUpdatedAt: number;
  /** Chapter ids, "state" and "session:<id>" entries changed since the last successful sync. */
  dirty: string[];
  /** Supabase user id this local data belongs to (null = not linked yet). */
  owner: string | null;
  sessions: StudySession[];
  timer: Timer;
  /** MathonGo test results by id (soft-deleted rows kept so removals sync). */
  tests: Record<string, TestResult>;
  /** Max marks last entered, used as the default for the next test. */
  lastMaxScore: number | null;
  /** Questions solved per day (YYYY-MM-DD), logged with the counter on the home screen. */
  questions: Record<string, QuestionDay>;
  /** Planner items by id (soft-deleted rows kept so removals sync). */
  plan: Record<string, PlanItem>;

  toggleTopic: (chapterId: string, topic: string, allTopics: string[]) => Status;
  setAllTopics: (chapterId: string, topics: string[], checked: boolean) => void;
  toggleStep: (chapterId: string, step: StepId) => void;
  setStatus: (chapterId: string, status: Status, topics: string[]) => void;
  addRevision: (chapterId: string) => void;
  setConfidence: (chapterId: string, value: number | null) => void;
  setNotes: (chapterId: string, notes: string) => void;
  addWeak: (chapterId: string, text: string) => void;
  toggleWeak: (chapterId: string, id: string) => void;
  removeWeak: (chapterId: string, id: string) => void;
  /** Adds planner items (skipping a chapter already scheduled for the same day and kind). */
  schedule: (entries: { chapterId: string; date: string; kind?: PlanKind }[]) => void;
  movePlan: (id: string, date: string) => void;
  /** Ticks an item off (or back on). Ticking a revision also logs a revision on the chapter. */
  togglePlanDone: (id: string) => void;
  deletePlan: (id: string) => void;
  /** Used by sync: newest version of each item wins. */
  mergePlan: (rows: PlanItem[]) => void;
  setSettings: (patch: Partial<Settings>) => void;
  /** Used by sync: replace data without marking it dirty. */
  applyRemote: (patch: { chapters?: Record<string, ChapterProgress>; settings?: Settings; activity?: string[]; questions?: Record<string, QuestionDay>; stateUpdatedAt?: number }) => void;
  /** Adds (or with a negative n, removes) questions solved today in one subject. */
  addQuestions: (subject: "physics" | "chemistry" | "maths", n: number) => void;
  saveTest: (test: Omit<TestResult, "updatedAt" | "deleted" | "imported"> & { imported?: boolean }) => void;
  deleteTest: (id: string) => void;
  /** Used by sync: newest version of each test wins. */
  mergeTests: (rows: TestResult[]) => void;
  markClean: (ids: string[], syncedAt: Record<string, number>) => void;
  markDirty: (ids: string[]) => void;
  setOwner: (id: string | null) => void;
  mergeSessions: (sessions: StudySession[]) => void;
  timerStart: (opts?: Partial<Pick<Timer, "mode" | "target" | "chapterId">>) => void;
  timerPause: () => void;
  timerSet: (patch: Partial<Pick<Timer, "mode" | "target" | "chapterId">>) => void;
  /** Ends the session and logs it if it lasted at least a minute. Returns the logged session. */
  timerStop: () => StudySession | null;
  reset: () => void;
}

/** Elapsed ms of the current timer session. */
export const timerElapsed = (t: Timer, now = Date.now()) => t.banked + (t.runningSince ? now - t.runningSince : 0);

const idleTimer = (t?: Timer): Timer => ({ mode: t?.mode ?? "pomodoro", target: t?.target ?? 25, chapterId: t?.chapterId ?? null, runningSince: null, banked: 0, sessionStart: null });

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

export const emptyProgress = (): ChapterProgress => ({
  status: "undone",
  topics: {},
  steps: {},
  revisions: [],
  confidence: null,
  doneAt: null,
  updatedAt: 0,
});

const initial = {
  chapters: {},
  settings: { name: "", exam: "advanced" as Exam },
  activity: [],
  stateUpdatedAt: 0,
  dirty: [] as string[],
  owner: null as string | null,
  sessions: [] as StudySession[],
  timer: idleTimer(),
  tests: {} as Record<string, TestResult>,
  lastMaxScore: null as number | null,
  questions: {} as Record<string, QuestionDay>,
  plan: {} as Record<string, PlanItem>,
};

export const useProgress = create<State>()(
  persist(
    (set, get) => {
      // Every user edit goes through here: stamps the time, logs today's activity, queues a sync.
      const edit = (chapterId: string, fn: (p: ChapterProgress) => ChapterProgress) => {
        const now = Date.now();
        const day = today();
        set((s) => ({
          chapters: { ...s.chapters, [chapterId]: { ...fn(s.chapters[chapterId] ?? emptyProgress()), updatedAt: now } },
          activity: s.activity.includes(day) ? s.activity : [...s.activity, day],
          stateUpdatedAt: s.activity.includes(day) ? s.stateUpdatedAt : now,
          dirty: [...new Set([...s.dirty, chapterId, ...(s.activity.includes(day) ? [] : ["state"])])],
        }));
      };

      return {
        ...initial,

        toggleTopic: (chapterId, topic, allTopics) => {
          edit(chapterId, (p) => {
            const topics = { ...p.topics };
            if (topics[topic]) delete topics[topic];
            else topics[topic] = true;
            const checked = allTopics.filter((t) => topics[t]).length;
            const all = checked === allTopics.length && allTopics.length > 0;
            // Every topic ticked moves an unstudied chapter to "test ready"; unticking from "test ready" steps back.
            let status: Status = p.status;
            if (all && !isStudied(p.status)) status = "ready";
            else if (!all && p.status === "ready") status = "working";
            else if (checked > 0 && p.status === "undone") status = "working";
            return { ...p, topics, status, doneAt: isStudied(status) ? (p.doneAt ?? today()) : null };
          });
          return get().chapters[chapterId].status;
        },

        setAllTopics: (chapterId, topics, checked) =>
          edit(chapterId, (p) => {
            const next = { ...p.topics };
            for (const t of topics) {
              if (checked) next[t] = true;
              else delete next[t];
            }
            return { ...p, topics: next };
          }),

        toggleStep: (chapterId, step) =>
          edit(chapterId, (p) => {
            const steps = { ...p.steps };
            if (steps[step]) delete steps[step];
            else steps[step] = true;
            return { ...p, steps, status: p.status === "undone" ? "working" : p.status };
          }),

        setStatus: (chapterId, status, topics) =>
          edit(chapterId, (p) => {
            const next = { ...p.topics };
            // Reaching "test ready" or beyond means the chapter is studied: tick its topics. Back to "undone" clears them.
            if (isStudied(status) && !isStudied(p.status)) for (const t of topics) next[t] = true;
            if (status === "undone") for (const t of topics) delete next[t];
            return { ...p, status, topics: next, doneAt: isStudied(status) ? (p.doneAt ?? today()) : null };
          }),

        addRevision: (chapterId) => edit(chapterId, (p) => ({ ...p, revisions: [...p.revisions, today()] })),

        setConfidence: (chapterId, value) => edit(chapterId, (p) => ({ ...p, confidence: value })),

        setNotes: (chapterId, notes) => edit(chapterId, (p) => ({ ...p, notes })),

        addWeak: (chapterId, text) =>
          edit(chapterId, (p) => ({ ...p, weak: [...(p.weak ?? []), { id: crypto.randomUUID(), text: text.trim().slice(0, 200), fixed: false, at: today() }] })),

        toggleWeak: (chapterId, id) => edit(chapterId, (p) => ({ ...p, weak: (p.weak ?? []).map((w) => (w.id === id ? { ...w, fixed: !w.fixed } : w)) })),

        removeWeak: (chapterId, id) => edit(chapterId, (p) => ({ ...p, weak: (p.weak ?? []).filter((w) => w.id !== id) })),

        schedule: (entries) =>
          set((s) => {
            const now = Date.now();
            const plan = { ...s.plan };
            const added: string[] = [];
            for (const { chapterId, date, kind = "revision" } of entries) {
              const dup = Object.values(plan).some((i) => !i.deleted && !i.doneAt && i.chapterId === chapterId && i.date === date && i.kind === kind);
              if (dup) continue;
              const id = crypto.randomUUID();
              plan[id] = { id, chapterId, date, kind, doneAt: null, deleted: false, updatedAt: now };
              added.push(`plan:${id}`);
            }
            return added.length ? { plan, dirty: [...new Set([...s.dirty, ...added])] } : s;
          }),

        movePlan: (id, date) =>
          set((s) => (s.plan[id] ? { plan: { ...s.plan, [id]: { ...s.plan[id], date, updatedAt: Date.now() } }, dirty: [...new Set([...s.dirty, `plan:${id}`])] } : s)),

        togglePlanDone: (id) => {
          const item = get().plan[id];
          if (!item) return;
          const done = !item.doneAt;
          set((s) => ({
            plan: { ...s.plan, [id]: { ...item, doneAt: done ? new Date().toISOString() : null, updatedAt: Date.now() } },
            dirty: [...new Set([...s.dirty, `plan:${id}`])],
          }));
          if (item.kind !== "revision") return;
          // Keep the chapter's revision log (and so the spaced-repetition schedule) in step.
          if (done) get().addRevision(item.chapterId);
          else
            edit(item.chapterId, (p) => {
              const i = p.revisions.lastIndexOf(today());
              return i === -1 ? p : { ...p, revisions: p.revisions.filter((_, k) => k !== i) };
            });
        },

        deletePlan: (id) =>
          set((s) => (s.plan[id] ? { plan: { ...s.plan, [id]: { ...s.plan[id], deleted: true, updatedAt: Date.now() } }, dirty: [...new Set([...s.dirty, `plan:${id}`])] } : s)),

        mergePlan: (rows) =>
          set((s) => {
            const plan = { ...s.plan };
            for (const r of rows) if (!plan[r.id] || r.updatedAt > plan[r.id].updatedAt) plan[r.id] = r;
            return { plan };
          }),

        setSettings: (patch) =>
          set((s) => ({
            settings: { ...s.settings, ...patch },
            stateUpdatedAt: Date.now(),
            dirty: [...new Set([...s.dirty, "state"])],
          })),

        saveTest: (test) =>
          set((s) => {
            const day = today();
            const now = Date.now();
            return {
              tests: { ...s.tests, [test.id]: { ...s.tests[test.id], ...test, imported: test.imported ?? s.tests[test.id]?.imported ?? false, deleted: false, updatedAt: now } },
              lastMaxScore: test.maxScore ?? s.lastMaxScore,
              dirty: [...new Set([...s.dirty, `test:${test.id}`, ...(s.activity.includes(day) ? [] : ["state"])])],
              activity: s.activity.includes(day) ? s.activity : [...s.activity, day],
              stateUpdatedAt: s.activity.includes(day) ? s.stateUpdatedAt : now,
            };
          }),

        deleteTest: (id) =>
          set((s) =>
            s.tests[id] ? { tests: { ...s.tests, [id]: { ...s.tests[id], deleted: true, updatedAt: Date.now() } }, dirty: [...new Set([...s.dirty, `test:${id}`])] } : s,
          ),

        mergeTests: (rows) =>
          set((s) => {
            const tests = { ...s.tests };
            for (const r of rows) if (!tests[r.id] || r.updatedAt > tests[r.id].updatedAt) tests[r.id] = r;
            return { tests };
          }),

        addQuestions: (subject, n) =>
          set((s) => {
            const day = today();
            const now = Date.now();
            const prev = s.questions[day] ?? { physics: 0, chemistry: 0, maths: 0, at: 0 };
            const value = Math.max(0, prev[subject] + n);
            if (value === prev[subject]) return s;
            const active = s.activity.includes(day);
            return {
              questions: { ...s.questions, [day]: { ...prev, [subject]: value, at: now } },
              activity: active ? s.activity : [...s.activity, day],
              stateUpdatedAt: now,
              dirty: [...new Set([...s.dirty, "state"])],
            };
          }),

        applyRemote: (patch) => set((s) => ({ ...s, ...patch, chapters: { ...s.chapters, ...patch.chapters } })),

        markClean: (ids, syncedAt) =>
          set((s) => ({
            // Keep an id dirty if it changed again while the upload was in flight.
            dirty: s.dirty.filter((id) => {
              if (!ids.includes(id)) return true;
              if (id.startsWith("session:")) return false; // sessions never change after logging
              const current =
                id === "state"
                  ? s.stateUpdatedAt
                  : id.startsWith("test:")
                    ? s.tests[id.slice(5)]?.updatedAt
                    : id.startsWith("plan:")
                      ? s.plan[id.slice(5)]?.updatedAt
                      : s.chapters[id]?.updatedAt;
              return current !== syncedAt[id];
            }),
          })),

        markDirty: (ids) => set((s) => ({ dirty: [...new Set([...s.dirty, ...ids])] })),

        setOwner: (owner) => set({ owner }),

        mergeSessions: (incoming) =>
          set((s) => {
            const known = new Set(s.sessions.map((x) => x.id));
            return { sessions: [...s.sessions, ...incoming.filter((x) => !known.has(x.id))].sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
          }),

        timerStart: (opts) =>
          set((s) => {
            if (s.timer.runningSince) return s;
            const now = Date.now();
            const day = today();
            const fresh = !s.timer.sessionStart;
            return {
              timer: { ...(fresh ? idleTimer(s.timer) : s.timer), ...opts, runningSince: now, sessionStart: s.timer.sessionStart ?? now },
              // Starting a focus session counts as studying today.
              activity: s.activity.includes(day) ? s.activity : [...s.activity, day],
              stateUpdatedAt: s.activity.includes(day) ? s.stateUpdatedAt : now,
              dirty: s.activity.includes(day) ? s.dirty : [...new Set([...s.dirty, "state"])],
            };
          }),

        timerPause: () =>
          set((s) => (s.timer.runningSince ? { timer: { ...s.timer, banked: timerElapsed(s.timer), runningSince: null } } : s)),

        timerSet: (patch) => set((s) => ({ timer: { ...s.timer, ...patch } })),

        timerStop: () => {
          const { timer } = get();
          const elapsed = timerElapsed(timer);
          // A pomodoro never counts for more than its length, even if the app was closed past the end.
          const ms = timer.mode === "pomodoro" ? Math.min(elapsed, timer.target * 60_000) : elapsed;
          const minutes = Math.round(ms / 60_000);
          let logged: StudySession | null = null;
          if (timer.sessionStart && minutes >= 1) {
            const chapter = timer.chapterId;
            logged = {
              id: crypto.randomUUID(),
              chapterId: chapter,
              subject: chapter ? (getChapter(chapter)?.subject ?? null) : null,
              mode: timer.mode,
              startedAt: new Date(timer.sessionStart).toISOString(),
              minutes,
            };
          }
          set((s) => ({
            timer: idleTimer(s.timer),
            sessions: logged ? [...s.sessions, logged] : s.sessions,
            dirty: logged ? [...s.dirty, `session:${logged.id}`] : s.dirty,
          }));
          return logged;
        },

        reset: () => set({ ...initial, stateUpdatedAt: Date.now(), dirty: [] }),
      };
    },
    // Loaded in the browser after mount (see Providers), so server HTML never mismatches.
    {
      name: "lockin-v1",
      version: 2,
      skipHydration: true,
      // v1 → v2: three-state status (todo/doing/done) became the 7-stage pipeline.
      migrate: (persisted, version) => {
        const s = persisted as State;
        if (version < 2 && s?.chapters) {
          for (const p of Object.values(s.chapters)) p.status = normalizeStatus(p.status);
        }
        return s;
      },
    },
  ),
);
