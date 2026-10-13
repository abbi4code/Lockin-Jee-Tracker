"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import { useProgress, type ChapterProgress, type QuestionDay, type Settings } from "../store/progress";
import { normalizeStatus } from "./stages";
import { fromTestRow, toTestRow } from "./tests";
import { fromPlanRow, toPlanRow, type PlanRow } from "./plan";
import { fromQuizrrRow, fromScheduleRows, toQuizrrRow } from "./quizrr";
import { legacyRow, mergeSessions, toSessionRow, type SessionRow } from "./sessions";

// Whether public.plan_items exists (null = not checked yet). Until its migration is applied the planner
// works locally only; the next full sync after it appears uploads everything.
let planTable: boolean | null = null;
const missingTable = (e: { code?: string } | null) => e?.code === "PGRST205" || e?.code === "42P01";
// Same for the Quizrr tables: scores stay on the device and the draft dates apply until the migration is in.
let quizrrTable: boolean | null = null;
// Whether study_sessions has the columns for edits and deletions (null = not known yet). Until the
// session-edits migration is applied, sessions upload in the old shape and deletions are hard deletes.
let sessionColumns: boolean | null = null;
const missingColumn = (e: { code?: string } | null) => e?.code === "PGRST204" || e?.code === "42703";

// Local-first sync: progress lives in localStorage and is pushed to Supabase whenever the user
// is signed in. Conflicts resolve per chapter by updatedAt (newest wins); streak days are merged.

export type SyncState = "off" | "signed-out" | "syncing" | "synced" | "offline" | "error";

let session: Session | null = null;
let state: SyncState = supabase ? "signed-out" : "off";
const listeners = new Set<() => void>();
const setState = (s: SyncState) => {
  state = s;
  listeners.forEach((l) => l());
};

async function pull(userId: string) {
  if (!supabase) return;
  const store = useProgress.getState();
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [{ data: rows, error }, { data: remoteState, error: stateError }, { data: sessionRows, error: sessionError }, { data: testRows, error: testError }] = await Promise.all([
    supabase.from("chapter_progress").select("chapter_id, data"),
    supabase.from("user_state").select("data").eq("user_id", userId).maybeSingle(),
    supabase.from("study_sessions").select("*").gte("started_at", since),
    supabase.from("test_results").select("*"),
  ]);
  if (error) throw error;
  if (stateError) throw stateError;
  if (sessionError) throw sessionError;
  if (testError) throw testError;
  store.mergeTests((testRows ?? []).map(fromTestRow));
  // Upload local test results the server doesn't have yet (or has an older copy of).
  const remoteTests = new Map((testRows ?? []).map((r) => [r.id as string, new Date(r.updated_at).getTime()]));
  const testsToPush = Object.values(useProgress.getState().tests)
    .filter((t) => t.updatedAt > (remoteTests.get(t.id) ?? -1))
    .map((t) => `test:${t.id}`);
  // Sessions: newest copy of each wins, deletions included. Read the store fresh: edits may have happened during the fetch.
  const now = useProgress.getState();
  if ((sessionRows ?? []).length) sessionColumns = "updated_at" in (sessionRows![0] as object);
  const merged = mergeSessions(now.sessions, now.removedSessions, (sessionRows ?? []) as SessionRow[], since);
  store.replaceSessions(merged.sessions, merged.removed);
  const sessionsToPush = merged.push.map((id) => `session:${id}`);

  const incoming: Record<string, ChapterProgress> = {};
  const remoteUpdated = new Map<string, number>();
  for (const row of rows ?? []) {
    const remote = { ...(row.data as ChapterProgress), status: normalizeStatus((row.data as ChapterProgress).status) };
    remoteUpdated.set(row.chapter_id, remote.updatedAt);
    const local = store.chapters[row.chapter_id];
    if (!local || remote.updatedAt > local.updatedAt) incoming[row.chapter_id] = remote;
  }
  // Local chapters that are newer than the server copy (or not on the server yet) need uploading.
  const toPush = Object.entries(store.chapters)
    .filter(([id, p]) => p.updatedAt > (remoteUpdated.get(id) ?? -1))
    .map(([id]) => id);

  const rs = remoteState?.data as { settings: Settings; activity: string[]; questions?: Record<string, QuestionDay>; updatedAt: number } | undefined;
  const activity = [...new Set([...store.activity, ...(rs?.activity ?? [])])].sort();
  const remoteNewer = !!rs && rs.updatedAt > store.stateUpdatedAt;
  // Question counts: per day, the most recently edited copy wins.
  const questions = { ...store.questions };
  let localQuestionsAhead = false;
  for (const [day, q] of Object.entries(rs?.questions ?? {})) if (!questions[day] || q.at > questions[day].at) questions[day] = q;
  for (const [day, q] of Object.entries(store.questions)) if (q.at > (rs?.questions?.[day]?.at ?? -1)) localQuestionsAhead = true;
  store.applyRemote({
    chapters: incoming,
    activity,
    questions,
    ...(remoteNewer ? { settings: rs.settings, stateUpdatedAt: rs.updatedAt } : {}),
  });
  // Upload state unless the server already has everything (newer settings, every streak day and question count).
  const serverComplete = remoteNewer && activity.length === rs.activity.length && !localQuestionsAhead;
  // Planner items: same newest-wins merge as tests, but tolerate the table not existing yet.
  const planRes = await supabase.from("plan_items").select("id, chapter_id, date, kind, done_at, deleted, updated_at");
  let planToPush: string[] = [];
  if (planRes.error) {
    if (!missingTable(planRes.error)) throw planRes.error;
    planTable = false;
  } else {
    planTable = true;
    const rowsIn = (planRes.data ?? []) as PlanRow[];
    store.mergePlan(rowsIn.map(fromPlanRow));
    const remotePlan = new Map(rowsIn.map((r) => [r.id, new Date(r.updated_at).getTime()]));
    planToPush = Object.values(useProgress.getState().plan)
      .filter((i) => i.updatedAt > (remotePlan.get(i.id) ?? -1))
      .map((i) => `plan:${i.id}`);
  }
  const quizrrToPush = await pullQuizrr();
  store.markDirty([...toPush, ...testsToPush, ...planToPush, ...sessionsToPush, ...quizrrToPush, ...(serverComplete ? [] : ["state"])]);
}

/** Quizrr scores (newest copy wins) and the admin's dates (the server's copy replaces ours). Returns ids to upload. */
async function pullQuizrr() {
  if (!supabase) return [];
  const [attempts, schedule] = await Promise.all([supabase.from("quizrr_attempts").select("*"), supabase.from("quizrr_schedule").select("test_id, date")]);
  if (attempts.error || schedule.error) {
    if (!missingTable(attempts.error) && !missingTable(schedule.error)) throw attempts.error ?? schedule.error;
    quizrrTable = false;
    return [];
  }
  quizrrTable = true;
  const store = useProgress.getState();
  store.mergeQuizrr((attempts.data ?? []).map(fromQuizrrRow));
  store.setQuizrrDates(fromScheduleRows(schedule.data ?? []));
  const remote = new Map((attempts.data ?? []).map((r) => [r.id as string, new Date(r.updated_at).getTime()]));
  return Object.values(useProgress.getState().quizrr)
    .filter((a) => a.updatedAt > (remote.get(a.id) ?? -1))
    .map((a) => `quizrr:${a.id}`);
}

async function push(userId: string) {
  if (!supabase) return;
  const s = useProgress.getState();
  if (!s.dirty.length) return;
  const ids = [...s.dirty];
  const syncedAt: Record<string, number> = {};

  const chapterRows = ids
    .filter((id) => id !== "state" && s.chapters[id])
    .map((id) => {
      syncedAt[id] = s.chapters[id].updatedAt;
      return { user_id: userId, chapter_id: id, data: s.chapters[id], updated_at: new Date(s.chapters[id].updatedAt).toISOString() };
    });
  if (chapterRows.length) {
    const { error } = await supabase.from("chapter_progress").upsert(chapterRows);
    if (error) throw error;
  }
  if (ids.includes("state")) {
    syncedAt.state = s.stateUpdatedAt;
    const { error } = await supabase.from("user_state").upsert({
      user_id: userId,
      data: { settings: s.settings, activity: s.activity, questions: s.questions, updatedAt: s.stateUpdatedAt },
      updated_at: new Date(s.stateUpdatedAt || Date.now()).toISOString(),
    });
    if (error) throw error;
  }
  const sessionRows = ids
    .filter((id) => id.startsWith("session:"))
    .flatMap((id) => {
      const key = id.slice(8);
      const live = s.sessions.find((x) => x.id === key);
      const x = live ?? s.removedSessions[key];
      if (!x) return [];
      syncedAt[id] = x.updatedAt as number;
      return [toSessionRow(x, userId, !live)];
    });
  if (sessionRows.length) await pushSessions(sessionRows);
  const testRows = ids
    .filter((id) => id.startsWith("test:") && s.tests[id.slice(5)])
    .map((id) => {
      const t = s.tests[id.slice(5)];
      syncedAt[id] = t.updatedAt;
      return toTestRow(t, userId);
    });
  if (testRows.length) {
    const { error } = await supabase.from("test_results").upsert(testRows);
    if (error) throw error;
  }
  const planIds = ids.filter((id) => id.startsWith("plan:") && s.plan[id.slice(5)]);
  for (const id of planIds) syncedAt[id] = s.plan[id.slice(5)].updatedAt;
  if (planIds.length && planTable !== false) {
    const { error } = await supabase.from("plan_items").upsert(planIds.map((id) => toPlanRow(s.plan[id.slice(5)], userId)));
    if (missingTable(error)) planTable = false;
    else if (error) throw error;
  }
  const quizrrIds = ids.filter((id) => id.startsWith("quizrr:") && s.quizrr[id.slice(7)]);
  for (const id of quizrrIds) syncedAt[id] = s.quizrr[id.slice(7)].updatedAt;
  if (quizrrIds.length && quizrrTable !== false) {
    const { error } = await supabase.from("quizrr_attempts").upsert(quizrrIds.map((id) => toQuizrrRow(s.quizrr[id.slice(7)], userId)));
    if (missingTable(error)) quizrrTable = false;
    else if (error) throw error;
  }
  useProgress.getState().markClean(ids, syncedAt);
}

/** Uploads session rows (soft deletions included). Falls back to the old table shape if the migration isn't applied. */
export async function pushSessions(rows: SessionRow[]) {
  if (!supabase) return;
  if (sessionColumns !== false) {
    const { error } = await supabase.from("study_sessions").upsert(rows);
    if (!error) return void (sessionColumns = true);
    if (!missingColumn(error)) throw error;
    sessionColumns = false;
  }
  const live = rows.filter((r) => !r.deleted).map(legacyRow);
  const gone = rows.filter((r) => r.deleted).map((r) => r.id);
  if (live.length) {
    const { error } = await supabase.from("study_sessions").upsert(live);
    if (error) throw error;
  }
  if (gone.length) {
    const { error } = await supabase.from("study_sessions").delete().in("id", gone);
    if (error) throw error;
    // Hard-deleted: nothing left to sync for these.
    const st = useProgress.getState();
    const removed = { ...st.removedSessions };
    for (const id of gone) delete removed[id];
    st.replaceSessions(st.sessions, removed);
  }
}

/** Local data belongs to one account: switching accounts on a device starts from that account's data. */
function claimDevice(userId: string) {
  const store = useProgress.getState();
  if (store.owner && store.owner !== userId) store.reset();
  useProgress.getState().setOwner(userId);
}

/** Signs out and clears this device's copy, so the next person doesn't inherit it. */
export async function signOut() {
  if (!supabase) return;
  // Push anything pending first so nothing is lost.
  if (session) await run(false);
  await supabase.auth.signOut();
  useProgress.getState().reset();
  useProgress.getState().setOwner(null);
  window.location.href = "/login";
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function run(full: boolean) {
  if (!session || running) return;
  if (!navigator.onLine) return setState("offline");
  running = true;
  setState("syncing");
  try {
    claimDevice(session.user.id);
    if (full) await pull(session.user.id);
    await push(session.user.id);
    setState("synced");
  } catch (e) {
    console.error("sync failed", e);
    setState("error");
  } finally {
    running = false;
    // Edits made during the upload get their own round.
    if (useProgress.getState().dirty.length && session) schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => run(false), 1500);
}

let started = false;
export function startSync() {
  if (!supabase || started) return;
  started = true;
  supabase.auth.getSession().then(({ data }) => {
    session = data.session;
    if (session) run(true);
  });
  supabase.auth.onAuthStateChange((_event, s) => {
    const signedIn = !session && s;
    session = s;
    if (!s) setState("signed-out");
    else if (signedIn) run(true);
  });
  useProgress.subscribe((s, prev) => {
    if (s.dirty !== prev.dirty && s.dirty.length && session) schedule();
  });
  window.addEventListener("online", () => run(true));
  window.addEventListener("offline", () => setState("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run(true);
  });
}

export function useSync() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { state, session, user: session?.user ?? null };
}
