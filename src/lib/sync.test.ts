import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRow } from "./sessions";

// A fake Supabase client that records writes to study_sessions; `upsertError` simulates the database.
const calls: { op: string; rows?: SessionRow[]; ids?: string[] }[] = [];
let upsertError: (rows: SessionRow[]) => { code: string; message: string } | null = () => null;
vi.mock("./supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (rows: SessionRow[]) => {
        calls.push({ op: "upsert", rows });
        return { error: upsertError(rows) };
      },
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          calls.push({ op: "delete", ids });
          return { error: null };
        },
      }),
    }),
  },
}));

const { pushSessions } = await import("./sync");
const { useProgress } = await import("../store/progress");

const row = (id: string, deleted = false): SessionRow => ({
  id,
  user_id: "u",
  chapter_id: null,
  subject: null,
  mode: "stopwatch",
  started_at: "2026-10-10T10:00:00.000Z",
  minutes: 30,
  updated_at: "2026-10-10T11:00:00.000Z",
  deleted,
  source: "manual",
  edited: false,
});

beforeEach(() => {
  calls.length = 0;
  upsertError = () => null;
});

describe("pushSessions", () => {
  it("upserts live and soft-deleted rows together on a migrated database", async () => {
    await pushSessions([row("a"), row("b", true)]);
    expect(calls).toHaveLength(1);
    expect(calls[0].rows!.map((r) => [r.id, r.deleted])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("falls back to the old table shape and hard deletes before the migration is applied", async () => {
    useProgress.setState({ removedSessions: { b: { id: "b", chapterId: null, subject: null, mode: "stopwatch", startedAt: "2026-10-10T10:00:00.000Z", minutes: 30, updatedAt: 1 } } });
    // The old table has no updated_at column: PostgREST answers PGRST204.
    upsertError = (rows) => ("updated_at" in rows[0] ? { code: "PGRST204", message: "Could not find the 'deleted' column" } : null);
    await pushSessions([row("a"), row("b", true)]);
    expect(calls.map((c) => c.op)).toEqual(["upsert", "upsert", "delete"]);
    expect(Object.keys(calls[1].rows![0]).sort()).toEqual(["chapter_id", "id", "minutes", "mode", "started_at", "subject", "user_id"]);
    expect(calls[1].rows!.map((r) => r.id)).toEqual(["a"]);
    expect(calls[2].ids).toEqual(["b"]);
    // Hard-deleted: the tombstone is gone, nothing left to sync.
    expect(useProgress.getState().removedSessions).toEqual({});
  });

  it("surfaces other database errors", async () => {
    // A fresh module instance, so the fallback flag from the previous test doesn't apply.
    vi.resetModules();
    const fresh = await import("./sync");
    upsertError = () => ({ code: "42501", message: "permission denied" });
    await expect(fresh.pushSessions([row("a")])).rejects.toMatchObject({ code: "42501" });
  });
});
