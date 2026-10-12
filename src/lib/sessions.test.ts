import { describe, expect, it } from "vitest";
import type { StudySession } from "../store/progress";
import { fromSessionRow, legacyRow, liveSessionRows, mergeSessions, overlaps, toSessionRow, type Removed, type SessionRow } from "./sessions";

const SINCE = "2026-06-01T00:00:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();

const session = (id: string, patch: Partial<StudySession> = {}): StudySession => ({
  id,
  chapterId: null,
  subject: null,
  mode: "stopwatch",
  startedAt: "2026-10-10T10:00:00.000Z",
  minutes: 60,
  updatedAt: 1000,
  source: "timer",
  ...patch,
});
const row = (id: string, patch: Partial<SessionRow> = {}): SessionRow => ({
  id,
  chapter_id: null,
  subject: null,
  mode: "stopwatch",
  started_at: "2026-10-10T10:00:00+00:00",
  minutes: 60,
  updated_at: iso(1000),
  deleted: false,
  source: "timer",
  edited: false,
  ...patch,
});

describe("mergeSessions", () => {
  it("adds sessions only the server has", () => {
    const m = mergeSessions([], {}, [row("a")], SINCE);
    expect(m.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(m.push).toEqual([]);
  });

  it("takes the server copy when it's newer (edited on another device)", () => {
    const m = mergeSessions([session("a", { minutes: 60, updatedAt: 1000 })], {}, [row("a", { minutes: 45, updated_at: iso(2000), edited: true })], SINCE);
    expect(m.sessions[0].minutes).toBe(45);
    expect(m.sessions[0].edited).toBe(true);
    expect(m.push).toEqual([]);
  });

  it("uploads the local copy when it's newer", () => {
    const m = mergeSessions([session("a", { minutes: 30, updatedAt: 3000 })], {}, [row("a", { minutes: 60, updated_at: iso(1000) })], SINCE);
    expect(m.sessions[0].minutes).toBe(30);
    expect(m.push).toEqual(["a"]);
  });

  it("drops a session deleted on another device after this copy", () => {
    const m = mergeSessions([session("a", { updatedAt: 1000 })], {}, [row("a", { deleted: true, updated_at: iso(2000) })], SINCE);
    expect(m.sessions).toEqual([]);
    expect(m.push).toEqual([]);
  });

  it("keeps (and re-uploads) a local edit made after a remote delete", () => {
    const m = mergeSessions([session("a", { updatedAt: 5000 })], {}, [row("a", { deleted: true, updated_at: iso(2000) })], SINCE);
    expect(m.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(m.push).toEqual(["a"]);
  });

  it("keeps a local deletion and uploads it when the server still has an older live copy", () => {
    const removed: Record<string, Removed> = { a: session("a", { updatedAt: 3000 }) as Removed };
    const m = mergeSessions([], removed, [row("a", { updated_at: iso(1000) })], SINCE);
    expect(m.sessions).toEqual([]);
    expect(m.removed.a).toBeDefined();
    expect(m.push).toEqual(["a"]);
  });

  it("forgets a deletion once the server has it", () => {
    const removed: Record<string, Removed> = { a: session("a", { updatedAt: 3000 }) as Removed };
    const m = mergeSessions([], removed, [row("a", { deleted: true, updated_at: iso(3000) })], SINCE);
    expect(m.removed).toEqual({});
    expect(m.push).toEqual([]);
  });

  it("lets a later edit on another device win over an earlier local deletion", () => {
    const removed: Record<string, Removed> = { a: session("a", { updatedAt: 3000 }) as Removed };
    const m = mergeSessions([], removed, [row("a", { minutes: 20, updated_at: iso(9000) })], SINCE);
    expect(m.sessions.map((s) => s.minutes)).toEqual([20]);
    expect(m.removed).toEqual({});
  });

  it("uploads recent local sessions and deletions the server doesn't have, but not old ones it never fetched", () => {
    const recent = session("new", { startedAt: "2026-10-11T08:00:00.000Z" });
    const old = session("old", { startedAt: "2026-01-01T08:00:00.000Z" });
    const removed: Record<string, Removed> = { gone: session("gone", { startedAt: "2026-10-11T09:00:00.000Z", updatedAt: 4000 }) as Removed };
    const m = mergeSessions([old, recent], removed, [], SINCE);
    expect(m.push.sort()).toEqual(["gone", "new"]);
  });

  it("does nothing for sessions from before editing existed (no updated_at on either side)", () => {
    const legacyLocal = session("a", { updatedAt: undefined, source: undefined });
    const legacyRemote: SessionRow = { id: "a", chapter_id: null, subject: null, mode: "pomodoro", started_at: "2026-10-10T10:00:00+00:00", minutes: 60 };
    const m = mergeSessions([legacyLocal], {}, [legacyRemote], SINCE);
    expect(m.push).toEqual([]);
    expect(m.sessions).toHaveLength(1);
  });

  it("returns sessions sorted by start, whatever the timestamp format", () => {
    const m = mergeSessions([session("late", { startedAt: "2026-10-10T12:00:00.000Z" })], {}, [row("early", { started_at: "2026-10-10T09:00:00+00:00" })], SINCE);
    expect(m.sessions.map((s) => s.id)).toEqual(["early", "late"]);
  });
});

describe("rows", () => {
  it("normalises Postgres timestamps and defaults", () => {
    const s = fromSessionRow({ id: "a", chapter_id: "phy-motion-1d", subject: "physics", mode: "pomodoro", started_at: "2026-10-10T10:00:00+00:00", minutes: 25 });
    expect(s.startedAt).toBe("2026-10-10T10:00:00.000Z");
    expect(s.source).toBe("timer");
    expect(s.updatedAt).toBe(0);
    expect(s.deleted).toBe(false);
  });

  it("round-trips a manual session, and the legacy shape has no new columns", () => {
    const r = toSessionRow(session("a", { source: "manual", updatedAt: 5000 }), "user-1", true);
    expect(r).toMatchObject({ user_id: "user-1", source: "manual", deleted: true, updated_at: iso(5000) });
    expect(Object.keys(legacyRow(r)).sort()).toEqual(["chapter_id", "id", "minutes", "mode", "started_at", "subject", "user_id"]);
  });

  it("liveSessionRows hides soft-deleted rows (admin panel)", () => {
    expect(liveSessionRows([row("a"), row("b", { deleted: true })]).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("overlaps", () => {
  const list = [session("a", { startedAt: "2026-10-10T10:00:00.000Z", minutes: 60 })];
  it("finds a clash", () => {
    expect(overlaps(list, new Date("2026-10-10T10:30:00.000Z"), 60).map((s) => s.id)).toEqual(["a"]);
  });
  it("allows back-to-back sessions", () => {
    expect(overlaps(list, new Date("2026-10-10T11:00:00.000Z"), 30)).toEqual([]);
    expect(overlaps(list, new Date("2026-10-10T09:30:00.000Z"), 30)).toEqual([]);
  });
  it("ignores the session being edited", () => {
    expect(overlaps(list, new Date("2026-10-10T10:15:00.000Z"), 30, "a")).toEqual([]);
  });
});
