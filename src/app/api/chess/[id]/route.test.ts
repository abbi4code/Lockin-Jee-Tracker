import { Chess } from "chess.js";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineGame } from "@/lib/chess/rules";

// A tiny stand-in for the two Supabase clients: who's signed in, and one chess_games table.
const state = vi.hoisted(() => ({
  me: null as string | null,
  rows: new Map<string, Record<string, unknown>>(),
  /** Columns the table doesn't have yet (the migration isn't applied). */
  missing: new Set<string>(),
  /** Runs once just before the next update, to simulate the other player writing first. */
  beforeUpdate: null as null | (() => void),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: state.me ? { claims: { sub: state.me } } : null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    from: () => {
      const filters: [string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        maybeSingle: async () => {
          const match = () => [...state.rows.values()].find((r) => filters.every(([k, v]) => r[k] === v)) ?? null;
          if (!patch) return { data: match(), error: null };
          const bad = Object.keys(patch).find((k) => state.missing.has(k));
          if (bad) return { data: null, error: { code: "PGRST204", message: `no column ${bad}` } };
          state.beforeUpdate?.();
          state.beforeUpdate = null;
          const row = match();
          if (!row) return { data: null, error: null };
          // A fresh timestamp each write, as Postgres would give.
          Object.assign(row, patch, { updated_at: new Date(Date.parse(row.updated_at as string) + 1).toISOString() });
          return { data: { ...row }, error: null };
        },
      };
      return q;
    },
  }),
}));

const { POST } = await import("./route");

const ID = "11111111-2222-3333-4444-555555555555";
const W = "white-user";
const B = "black-user";
const T0 = "2026-10-26T10:00:00.000Z";

function seed(over: Partial<OnlineGame> = {}) {
  const row: OnlineGame = { id: ID, white: W, black: B, white_name: "a", black_name: "b", pgn: "", ply: 0, status: "active", result: null, reason: null, draw_offer: null, moved_at: T0, updated_at: T0, ...over };
  for (const k of state.missing) delete (row as unknown as Record<string, unknown>)[k];
  state.rows.set(ID, row as unknown as Record<string, unknown>);
}
async function call(body: unknown, id = ID) {
  const res = await POST({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ id }) } as RouteContext<"/api/chess/[id]">);
  return { status: res.status, body: (await res.json()) as { game?: OnlineGame; error?: string } };
}

beforeEach(() => {
  state.me = W;
  state.rows.clear();
  state.missing.clear();
  state.beforeUpdate = null;
});

describe("POST /api/chess/[id]", () => {
  it("needs a signed-in player of this game", async () => {
    seed();
    state.me = null;
    expect((await call({ type: "resign" })).status).toBe(401);
    state.me = "stranger";
    expect((await call({ type: "resign" })).status).toBe(404);
    state.me = W;
    expect((await call({ type: "resign" }, "not-a-uuid")).status).toBe(404);
    expect((await call({ type: "win" })).status).toBe(400);
  });

  it("plays a legal move and returns the saved game", async () => {
    seed();
    const r = await call({ type: "move", ply: 0, from: "e2", to: "e4" });
    expect(r.status).toBe(200);
    expect(r.body.game).toMatchObject({ ply: 1 });
    expect(state.rows.get(ID)!.pgn).toContain("e4");
  });

  it("refuses an illegal move and sends the real game back", async () => {
    seed();
    const r = await call({ type: "move", ply: 0, from: "e2", to: "e5" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/legal/);
    expect(r.body.game).toMatchObject({ ply: 0 });
    expect(state.rows.get(ID)!.pgn).toBe("");
  });

  it("when the other player writes first, decides again on the new state", async () => {
    seed();
    // Black resigns between our read and our write: our move is then refused, not written over the result.
    state.beforeUpdate = () => Object.assign(state.rows.get(ID)!, { status: "over", result: "1-0", reason: "resignation", updated_at: "2026-10-26T10:00:05.000Z" });
    const r = await call({ type: "move", ply: 0, from: "e2", to: "e4" });
    expect(r.status).toBe(409);
    expect(r.body.game).toMatchObject({ status: "over", reason: "resignation" });
    expect(state.rows.get(ID)!.pgn).toBe("");
  });

  it("a resignation still lands if a move slipped in first", async () => {
    const c = new Chess();
    c.move("e4");
    seed({ pgn: c.pgn(), ply: 1 });
    state.me = W;
    state.beforeUpdate = () => {
      c.move("e5");
      Object.assign(state.rows.get(ID)!, { pgn: c.pgn(), ply: 2, updated_at: "2026-10-26T10:00:05.000Z" });
    };
    const r = await call({ type: "resign" });
    expect(r.status).toBe(200);
    expect(state.rows.get(ID)).toMatchObject({ status: "over", result: "0-1", ply: 2 });
  });

  it("works before the migration: moves save without the new columns", async () => {
    state.missing = new Set(["draw_offer", "moved_at"]);
    seed();
    const r = await call({ type: "move", ply: 0, from: "e2", to: "e4" });
    expect(r.status).toBe(200);
    expect(state.rows.get(ID)!.ply).toBe(1);
    expect("moved_at" in state.rows.get(ID)!).toBe(false);
  });
});
