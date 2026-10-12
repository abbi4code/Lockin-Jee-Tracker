import type { StudySession } from "../store/progress";

// Study sessions: logged by the focus timer, or added / fixed by hand on the focus page. Synced per row
// (public.study_sessions); deletions are soft (deleted = true) so they reach every device, and the newest
// copy of a row wins (updated_at).

/** Longest a single session can be (a stopwatch left running overnight gets trimmed to at most this). */
export const MAX_SESSION_MIN = 12 * 60;
/** A stopwatch session longer than this opens the editor when it's stopped: was it really all study? */
export const LONG_SESSION_MIN = 120;
/** How many days back the log can be edited or added to (today included). */
export const EDITABLE_DAYS = 7;

/** A removed session, kept until the server has the deletion. */
export type Removed = StudySession & { updatedAt: number };

export interface SessionRow {
  id: string;
  user_id?: string;
  chapter_id: string | null;
  subject: string | null;
  mode: "stopwatch" | "pomodoro";
  started_at: string;
  minutes: number;
  // Added by the 20261012120000_session_edits migration; absent on older databases.
  updated_at?: string | null;
  deleted?: boolean | null;
  source?: string | null;
  edited?: boolean | null;
}

export const clampMinutes = (m: number) => Math.min(MAX_SESSION_MIN, Math.max(1, Math.round(m)));

export const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
export const endOf = (s: Pick<StudySession, "startedAt" | "minutes">) => new Date(new Date(s.startedAt).getTime() + s.minutes * 60_000);

export function fromSessionRow(r: SessionRow): StudySession & { deleted: boolean } {
  return {
    id: r.id,
    chapterId: r.chapter_id,
    subject: r.subject,
    mode: r.mode,
    // Postgres returns "+00:00" offsets; normalise so start times compare and sort as plain strings.
    startedAt: new Date(r.started_at).toISOString(),
    minutes: r.minutes,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
    source: r.source === "manual" ? "manual" : "timer",
    edited: !!r.edited,
    deleted: !!r.deleted,
  };
}

export function toSessionRow(s: StudySession, userId: string, deleted = false): SessionRow {
  return {
    id: s.id,
    user_id: userId,
    chapter_id: s.chapterId,
    subject: s.subject,
    mode: s.mode,
    started_at: s.startedAt,
    minutes: s.minutes,
    updated_at: new Date(s.updatedAt || Date.now()).toISOString(),
    deleted,
    source: s.source ?? "timer",
    edited: !!s.edited,
  };
}

/** The row without the columns older databases don't have. */
export const legacyRow = (r: SessionRow): SessionRow => ({ id: r.id, user_id: r.user_id, chapter_id: r.chapter_id, subject: r.subject, mode: r.mode, started_at: r.started_at, minutes: r.minutes });

/** A row's session without the deleted flag. */
const live = (r: StudySession & { deleted: boolean }): StudySession => ({
  id: r.id,
  chapterId: r.chapterId,
  subject: r.subject,
  mode: r.mode,
  startedAt: r.startedAt,
  minutes: r.minutes,
  updatedAt: r.updatedAt,
  source: r.source,
  edited: r.edited,
});

/** Live sessions only, from rows that may include soft-deleted ones (the admin panel). */
export const liveSessionRows = (rows: SessionRow[]) => rows.filter((r) => !r.deleted).map((r) => live(fromSessionRow(r)));

/** Sessions overlapping [start, start + minutes), other than `exceptId`. */
export function overlaps(sessions: StudySession[], start: Date, minutes: number, exceptId?: string) {
  const a = start.getTime();
  const b = a + minutes * 60_000;
  return sessions.filter((s) => s.id !== exceptId && new Date(s.startedAt).getTime() < b && endOf(s).getTime() > a);
}

/**
 * Merges the server's rows into this device's sessions: per id, the newest copy wins (an older device's copy has
 * updatedAt 0). A deletion counts as a copy too, on either side. Returns the merged sessions (sorted by start),
 * the deletions still waiting for the server, and the ids this device must upload (newer here, or missing there).
 * `since`: rows older than this weren't fetched, so local sessions before it aren't "missing" from the server.
 */
export function mergeSessions(local: StudySession[], removed: Record<string, Removed>, rows: SessionRow[], since: string) {
  const byId = new Map(local.map((s) => [s.id, s]));
  const gone = { ...removed };
  const push = new Set<string>();
  const seen = new Set<string>();

  for (const row of rows) {
    const r = fromSessionRow(row);
    const ru = r.updatedAt ?? 0;
    seen.add(r.id);
    const tomb = gone[r.id];
    const mine = byId.get(r.id);
    if (tomb) {
      if (ru > tomb.updatedAt && !r.deleted) {
        // Changed on another device after it was deleted here: the later change wins.
        delete gone[r.id];
        byId.set(r.id, live(r));
      } else if (r.deleted) delete gone[r.id]; // the server has the deletion
      else push.add(r.id);
    } else if (mine) {
      const mu = mine.updatedAt ?? 0;
      if (r.deleted) {
        if (ru >= mu) byId.delete(r.id);
        else push.add(r.id);
      } else if (ru > mu) {
        byId.set(r.id, live(r));
      } else if (mu > ru) push.add(r.id);
    } else if (!r.deleted) byId.set(r.id, live(r));
  }
  // Logged here but not on the server (e.g. an upload that failed).
  for (const s of local) if (!seen.has(s.id) && !gone[s.id] && s.startedAt >= since) push.add(s.id);
  for (const id of Object.keys(gone)) if (!seen.has(id) && gone[id].startedAt >= since) push.add(id);

  return { sessions: [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)), removed: gone, push: [...push] };
}
