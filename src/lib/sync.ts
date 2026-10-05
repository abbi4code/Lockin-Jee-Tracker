"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import { useProgress, type ChapterProgress, type QuestionDay, type Settings, type StudySession } from "../store/progress";
import { normalizeStatus } from "./stages";
import { fromTestRow, toTestRow } from "./tests";

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
    supabase.from("study_sessions").select("id, chapter_id, subject, mode, started_at, minutes").gte("started_at", since),
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
  store.mergeSessions(
    (sessionRows ?? []).map((r): StudySession => ({ id: r.id, chapterId: r.chapter_id, subject: r.subject, mode: r.mode, startedAt: r.started_at, minutes: r.minutes })),
  );

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
  store.markDirty([...toPush, ...testsToPush, ...(serverComplete ? [] : ["state"])]);
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
  const sessionIds = ids.filter((id) => id.startsWith("session:")).map((id) => id.slice(8));
  const sessionRows = s.sessions
    .filter((x) => sessionIds.includes(x.id))
    .map((x) => ({ id: x.id, user_id: userId, chapter_id: x.chapterId, subject: x.subject, mode: x.mode, started_at: x.startedAt, minutes: x.minutes }));
  if (sessionRows.length) {
    const { error } = await supabase.from("study_sessions").upsert(sessionRows);
    if (error) throw error;
  }
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
  useProgress.getState().markClean(ids, syncedAt);
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
