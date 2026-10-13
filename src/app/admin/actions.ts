"use server";

import { revalidatePath } from "next/cache";
import snapshot from "@/data/excel-snapshot.json";
import { ALL_CHAPTERS, getTrack, TRACKS } from "@/data";
import { requireAdmin } from "@/lib/admin-data";
import { ACTIVE_TESTS, assignedDate, fromScheduleRows, getQuizrrTest } from "@/lib/quizrr";
import { isStudied, normalizeStatus } from "@/lib/stages";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChapterProgress } from "@/store/progress";

const num = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? null : Number(v));

async function guard() {
  if (!(await requireAdmin())) throw new Error("Not an admin.");
  return createSupabaseAdmin();
}

/** Log or update one test result for a student (admin side). */
export async function adminSaveTest(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const trackId = String(form.get("trackId"));
  const track = getTrack(trackId);
  if (!track) throw new Error("Unknown test series chapter.");
  const kind = form.get("kind") === "pyq" ? "pyq" : "chapterwise";
  const testNo = Number(form.get("testNo"));
  if (!Number.isInteger(testNo) || testNo < 1) throw new Error("Test number must be 1 or more.");

  // One row per (track, kind, test no): update it if it exists, otherwise create it.
  const { data: existing } = await db.from("test_results").select("id").eq("user_id", userId).eq("track_id", trackId).eq("kind", kind).eq("test_no", testNo).eq("deleted", false).maybeSingle();
  const { error } = await db.from("test_results").upsert({
    id: existing?.id ?? crypto.randomUUID(),
    user_id: userId,
    track_id: trackId,
    kind,
    test_no: testNo,
    taken_on: (form.get("takenOn") as string) || null,
    score: num(form.get("score")),
    max_score: num(form.get("maxScore")),
    correct: num(form.get("correct")),
    wrong: num(form.get("wrong")),
    unattempted: num(form.get("unattempted")),
    time_min: num(form.get("timeMin")),
    deleted: false,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/u/${userId}`, "layout");
}

export async function adminDeleteTest(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const { error } = await db.from("test_results").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", String(form.get("id"))).eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/u/${userId}`, "layout");
}

/**
 * One-time import of the old Excel tracker into a student's account: board stages onto chapters,
 * and each "done" test as a result without a score. Refuses to run twice.
 */
export async function adminImportExcel(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));

  const { count } = await db.from("test_results").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("imported", true);
  if (count) throw new Error("This student already has the Excel import.");

  const now = Date.now();
  const today = new Date().toLocaleDateString("en-CA");

  // Stages: merge onto existing chapter progress, never wiping ticked topics or revisions.
  const { data: rows } = await db.from("chapter_progress").select("chapter_id, data").eq("user_id", userId);
  const existing = new Map((rows ?? []).map((r) => [r.chapter_id as string, r.data as ChapterProgress]));
  const chapterRows = Object.entries(snapshot.stages)
    .filter(([id]) => ALL_CHAPTERS.some((c) => c.id === id))
    .map(([id, stage]) => {
      const prev = existing.get(id);
      const status = normalizeStatus(stage);
      const data: ChapterProgress = {
        topics: {},
        steps: {},
        revisions: [],
        confidence: null,
        ...prev,
        status,
        doneAt: isStudied(status) ? (prev?.doneAt ?? today) : null,
        updatedAt: now,
      };
      return { user_id: userId, chapter_id: id, data, updated_at: new Date(now).toISOString() };
    });
  if (chapterRows.length) {
    const { error } = await db.from("chapter_progress").upsert(chapterRows);
    if (error) throw new Error(error.message);
  }

  // Tests done: one imported row per test, numbered 1..n, no score (the Excel never had scores).
  // Test numbers the student already logged (with real scores) are kept and not duplicated.
  const { data: had } = await db.from("test_results").select("track_id, kind, test_no").eq("user_id", userId).eq("deleted", false);
  const taken = new Set((had ?? []).map((r) => `${r.track_id}|${r.kind}|${r.test_no}`));
  const testRows = Object.entries(snapshot.tests).flatMap(([trackId, done]) => {
    if (!TRACKS.some((t) => t.id === trackId)) return [];
    const make = (kind: "chapterwise" | "pyq", n: number) =>
      Array.from({ length: n }, (_, i) => i + 1)
        .filter((no) => !taken.has(`${trackId}|${kind}|${no}`))
        .map((no) => ({
          id: crypto.randomUUID(),
          user_id: userId,
          track_id: trackId,
          kind,
          test_no: no,
          imported: true,
          deleted: false,
          updated_at: new Date(now).toISOString(),
        }));
    return [...make("chapterwise", done.chapterwise), ...make("pyq", done.pyq)];
  });
  if (testRows.length) {
    const { error } = await db.from("test_results").insert(testRows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/u/${userId}`, "layout");
  revalidatePath("/admin");
}

// ── Quizrr ──────────────────────────────────────────────────────────────

/** Saves the dates a student should take each Quizrr test on. Only changed dates are written; empty = unscheduled. */
export async function adminSaveQuizrrDates(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const { data: rows, error: readError } = await db.from("quizrr_schedule").select("test_id, date").eq("user_id", userId);
  if (readError) throw new Error(readError.message);
  const current = fromScheduleRows(rows ?? []);
  const now = new Date().toISOString();
  const changed = ACTIVE_TESTS.flatMap((t) => {
    const raw = form.get(`date:${t.id}`);
    if (raw == null) return [];
    const date = String(raw).trim() || null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date for ${t.id}.`);
    return date === assignedDate(t, current) ? [] : [{ user_id: userId, test_id: t.id, date, updated_at: now }];
  });
  if (changed.length) {
    const { error } = await db.from("quizrr_schedule").upsert(changed);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/u/${userId}`, "layout");
}

/** Drops the admin's dates so the suggested schedule applies again. */
export async function adminResetQuizrrDates(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const { error } = await db.from("quizrr_schedule").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/u/${userId}`, "layout");
}

/** Logs or fixes a Quizrr score for a student (one live row per test). */
export async function adminSaveQuizrr(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const test = getQuizrrTest(String(form.get("testId")));
  if (!test) throw new Error("Unknown Quizrr test.");
  const score = num(form.get("score"));
  const maxScore = num(form.get("maxScore")) ?? test.marks;
  if (score == null || Number.isNaN(score) || score > maxScore || score < -maxScore / 4) throw new Error(`Marks must be between ${-maxScore / 4} and ${maxScore}.`);
  const { data: existing } = await db.from("quizrr_attempts").select("id").eq("user_id", userId).eq("test_id", test.id).eq("deleted", false).maybeSingle();
  const { error } = await db.from("quizrr_attempts").upsert({
    id: existing?.id ?? crypto.randomUUID(),
    user_id: userId,
    test_id: test.id,
    taken_on: (form.get("takenOn") as string) || new Date().toLocaleDateString("en-CA"),
    score,
    max_score: maxScore,
    physics: num(form.get("physics")),
    chemistry: num(form.get("chemistry")),
    maths: num(form.get("maths")),
    percentile: num(form.get("percentile")),
    rank: num(form.get("rank")),
    deleted: false,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/u/${userId}`, "layout");
}

export async function adminDeleteQuizrr(form: FormData) {
  const db = await guard();
  const userId = String(form.get("userId"));
  const { error } = await db.from("quizrr_attempts").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", String(form.get("id"))).eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/u/${userId}`, "layout");
}
