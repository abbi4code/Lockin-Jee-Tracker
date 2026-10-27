import { NextResponse, type NextRequest } from "next/server";
import { decide, parseAction, type OnlineGame, type Patch } from "@/lib/chess/rules";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missingColumn = (e: { code?: string } | null) => e?.code === "PGRST204" || e?.code === "42703";

/** The server's clock, so a player's app can show the chess clocks the way the server counts them. */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "cache-control": "no-store" } });
}

/**
 * Plays one action in an online chess game (a move, resign, a draw offer and its answer, claiming an abandoned
 * game, reporting a clock that ran out, cancelling an open one) for the signed-in player. Players can't update public.chess_games directly; this
 * replays the game with chess.js (lib/chess/rules.ts) and writes with the secret key. Answers with the game as it
 * now stands, also when the action is refused, so the client can put its board back, and with the server's clock.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chess/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "no such game." }, { status: 404 });
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return NextResponse.json({ error: "sign in to play online." }, { status: 401 });
  const action = parseAction(await request.json().catch(() => null));
  if (!action) return NextResponse.json({ error: "bad request." }, { status: 400 });

  let db: ReturnType<typeof createSupabaseAdmin>;
  try {
    db = createSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "online chess isn't set up on this server." }, { status: 503 });
  }

  // Another write can land between the read and ours (the other player resigning, say). The write only goes
  // through if the row is as we read it, so on a clash read again and decide afresh.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error: readError } = await db.from("chess_games").select("*").eq("id", id).maybeSingle();
    if (readError) return NextResponse.json({ error: "couldn't load the game." }, { status: 500 });
    const game = row as OnlineGame | null;
    if (!game || (game.white !== me && game.black !== me)) return NextResponse.json({ error: "no such game." }, { status: 404 });

    const verdict = decide(game, me, action);
    if ("error" in verdict) return NextResponse.json({ error: verdict.error, game, now: Date.now() }, { status: 409 });

    let patch: Patch = verdict.patch;
    const write = () =>
      db
        .from("chess_games")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("ply", game.ply)
        .eq("status", game.status)
        .eq("updated_at", game.updated_at)
        .select("*")
        .maybeSingle();
    let { data: saved, error } = await write();
    if (missingColumn(error)) {
      // The chess_server migration isn't applied yet: play on without draw offers and abandonment times.
      const { draw_offer: _offer, moved_at: _moved, ...rest } = patch;
      patch = rest;
      ({ data: saved, error } = await write());
    }
    if (error) return NextResponse.json({ error: "couldn't save. try again.", game, now: Date.now() }, { status: 500 });
    if (saved) return NextResponse.json({ game: saved, now: Date.now() });
  }
  return NextResponse.json({ error: "the game keeps changing. try again." }, { status: 409 });
}
