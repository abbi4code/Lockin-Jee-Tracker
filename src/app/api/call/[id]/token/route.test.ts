import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Who gets a LiveKit token, and what it lets them do. Supabase is faked; the token is signed for real and decoded.

const state = vi.hoisted(() => ({
  me: null as string | null,
  /** What row-level security lets this user see. */
  call: null as { id: string; ended_at: string | null } | null,
  member: null as { name: string; state: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: state.me ? { claims: { sub: state.me } } : null }) },
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "calls" ? state.call : state.member }) };
      return q;
    },
  }),
}));

const { POST } = await import("./route");

const ID = "11111111-2222-3333-4444-555555555555";
const call = async (id = ID) => {
  const res = await POST({} as NextRequest, { params: Promise.resolve({ id }) } as RouteContext<"/api/call/[id]/token">);
  return { status: res.status, body: (await res.json()) as { url?: string; token?: string; error?: string } };
};
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as { sub: string; name: string; video: Record<string, unknown> };

beforeEach(() => {
  process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "key";
  process.env.LIVEKIT_API_SECRET = "a-secret-that-is-long-enough-for-hs256";
  state.me = "user-1";
  state.call = { id: ID, ended_at: null };
  state.member = { name: "anu", state: "joined" };
});

describe("POST /api/call/[id]/token", () => {
  it("a member in the call gets a token for that call's room only, as themselves", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("wss://test.livekit.cloud");
    const c = claims(r.body.token!);
    expect(c.sub).toBe("user-1");
    expect(c.name).toBe("anu");
    expect(c.video).toMatchObject({ roomJoin: true, room: `call-${ID}`, canPublish: true, canSubscribe: true });
    expect(c.video.roomCreate ?? false).toBe(false);
    expect(c.video.roomAdmin ?? false).toBe(false);
  });

  it("refuses: signed out, not a member (row-level security hides the call), not joined yet, or ended", async () => {
    state.me = null;
    expect((await call()).status).toBe(401);
    state.me = "user-1";
    state.call = null;
    expect((await call()).status).toBe(404);
    state.call = { id: ID, ended_at: null };
    state.member = { name: "anu", state: "ringing" };
    expect((await call()).status).toBe(403);
    state.member = { name: "anu", state: "joined" };
    state.call = { id: ID, ended_at: new Date().toISOString() };
    expect((await call()).status).toBe(410);
    expect((await call("not-a-uuid")).status).toBe(404);
  });

  it("says so when LiveKit isn't set up on the server", async () => {
    delete process.env.LIVEKIT_API_SECRET;
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/aren't set up/);
  });
});
