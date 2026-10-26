import { NextResponse, type NextRequest } from "next/server";
import { CODE, decide, parseAction, type Player, type Room, type Secret, type State } from "@/lib/skribbl/rules";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

// The skribbl referee. Players can't write the game tables; this route reads the room with the secret key, runs
// the action through the rules (lib/skribbl/rules.ts) and saves the result with skribbl_apply, which only goes
// through if nothing else changed the room in between. Every answer carries the server's clock (`now`), so the
// apps can show the same countdown.

async function signedIn() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

function admin() {
  try {
    return createSupabaseAdmin();
  } catch {
    return null;
  }
}
type Db = NonNullable<ReturnType<typeof admin>>;

async function load(db: Db, code: string): Promise<State | null> {
  const { data: room } = await db.from("skribbl_rooms").select("*").eq("code", code).maybeSingle();
  if (!room) return null;
  const [{ data: players }, { data: secret }] = await Promise.all([
    db.from("skribbl_players").select("*").eq("room", room.id),
    db.from("skribbl_secrets").select("*").eq("room", room.id).maybeSingle(),
  ]);
  return { room: room as Room, players: (players ?? []) as Player[], secret: (secret as Secret | null) ?? null };
}

const fail = (error: string, status: number) => NextResponse.json({ error, now: Date.now() }, { status });

/** What only you may know: the words to pick from and the word (drawer), the custom words (host). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/skribbl/[code]">) {
  const { code } = await ctx.params;
  if (!CODE.test(code)) return fail("no such room.", 404);
  const me = await signedIn();
  if (!me) return fail("sign in to play.", 401);
  const db = admin();
  if (!db) return fail("skribbl isn't set up on this server.", 503);
  const s = await load(db, code);
  const self = s?.players.find((p) => p.user_id === me);
  if (!s || !self || self.kicked) return fail("no such room.", 404);
  const drawing = s.room.drawer === me && (s.room.status === "choosing" || s.room.status === "drawing");
  return NextResponse.json({
    now: Date.now(),
    step: s.room.step,
    choices: drawing && s.room.status === "choosing" ? (s.secret?.choices ?? []) : [],
    word: drawing && s.room.status === "drawing" ? (s.secret?.word ?? null) : null,
    custom: s.room.host === me ? (s.secret?.custom ?? []) : null,
  });
}

/** Plays one action for the signed-in user. Answers with the room as it now stands. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/skribbl/[code]">) {
  const { code } = await ctx.params;
  if (!CODE.test(code)) return fail("no such room.", 404);
  const me = await signedIn();
  if (!me) return fail("sign in to play.", 401);
  const action = parseAction(await request.json().catch(() => null));
  if (!action) return fail("bad request.", 400);
  const db = admin();
  if (!db) return fail("skribbl isn't set up on this server.", 503);

  // Many players act at once (everyone guessing, every app ticking): on a clash, read again and decide afresh.
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await load(db, code);
    if (!s) return fail("no such room.", 404);
    const verdict = decide(s, me, action);
    if ("error" in verdict) {
      // A player gets the room back (to put the screen right); someone turned away doesn't.
      const member = s.players.some((p) => p.user_id === me && !p.kicked);
      return NextResponse.json({ error: verdict.error, room: member ? s.room : undefined, now: Date.now() }, { status: 409 });
    }
    const e = verdict.effects;
    if (!e.room && !e.players && !e.secret && !e.messages) return NextResponse.json({ room: s.room, now: Date.now() });

    const { data: saved, error } = await db.rpc("skribbl_apply", {
      p_room: s.room.id,
      p_step: s.room.step,
      p_room_row: e.room ?? null,
      p_players: e.players ?? null,
      p_secret: e.secret ?? null,
      p_messages: e.messages ?? null,
    });
    if (error) {
      console.error("skribbl_apply failed", error.message);
      return fail("couldn't save. try again.", 500);
    }
    if (saved) {
      const room = e.room ? { ...e.room, step: s.room.step + 1 } : s.room;
      return NextResponse.json({ room, now: Date.now() });
    }
  }
  return fail("the room is busy. try again.", 409);
}
