import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Who gets a "<name> is calling" push: only people still being rung, only when a member who's in the call asks.

const state = vi.hoisted(() => ({
  me: null as string | null,
  call: null as Record<string, unknown> | null,
  members: [] as Record<string, unknown>[],
  pushed: [] as { user: string; title: string; url?: string; tag?: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: state.me ? { claims: { sub: state.me } } : null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => (table === "calls" ? { maybeSingle: async () => ({ data: state.call }) } : Promise.resolve({ data: state.members })),
      }),
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: id === "coach" ? "coach@x.com" : `${id}@x.com` } } }) } },
  }),
}));
vi.mock("@/lib/admin", () => ({ isAdminEmail: (e: string) => e === "coach@x.com" }));
vi.mock("@/lib/push-server", () => ({
  pushConfigured: () => true,
  sendToUser: async (user: string, p: { title: string; url?: string; tag?: string }) => (state.pushed.push({ user, ...p }), 1),
}));

const { POST } = await import("./route");

const ID = "11111111-2222-3333-4444-555555555555";
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const member = (user_id: string, state: string, updated = 2) => ({ call: ID, user_id, name: user_id === "abhi" ? "Abhi Raj" : user_id, state, updated_at: ago(updated) });
const call = (body: unknown) => POST({ json: async () => body } as unknown as NextRequest).then(async (r) => ({ status: r.status, body: await r.json() }));

beforeEach(() => {
  state.me = "abhi";
  state.call = { id: ID, context: "chess:g", ended_at: null };
  state.members = [member("abhi", "joined"), member("anu", "ringing"), member("coach", "ringing"), member("old", "ringing", 120), member("x", "declined")];
  state.pushed = [];
});

describe("POST /api/call/notify", () => {
  it("pushes to everyone still being rung, and sends the coach to the admin panel", async () => {
    const r = await call({ call: ID });
    expect(r.body).toEqual({ sent: 2 });
    expect(state.pushed.map((p) => p.user).sort()).toEqual(["anu", "coach"]);
    expect(state.pushed[0]).toMatchObject({ title: "abhi is calling", tag: `lockin-call-${ID}` });
    expect(state.pushed.find((p) => p.user === "coach")?.url).toBe("/admin");
    expect(state.pushed.find((p) => p.user === "anu")?.url).toBe("/today");
  });

  it("only for a signed-in member who's in the call, of a call that's still on", async () => {
    state.me = null;
    expect((await call({ call: ID })).status).toBe(401);
    state.me = "anu"; // rung, not in
    expect((await call({ call: ID })).body).toEqual({ sent: 0 });
    state.me = "stranger";
    expect((await call({ call: ID })).body).toEqual({ sent: 0 });
    state.me = "abhi";
    state.call = { ...state.call!, ended_at: ago(1) };
    expect((await call({ call: ID })).body).toEqual({ sent: 0 });
    expect(state.pushed).toEqual([]);
  });

  it("rejects a malformed request", async () => {
    expect((await call({ call: "nope" })).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });
});
