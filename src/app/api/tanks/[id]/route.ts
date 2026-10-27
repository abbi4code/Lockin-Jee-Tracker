import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { decide, parseAction, seatOf, type TankGame } from "@/lib/tanks/rules";
import { newWorld, randomSeed } from "@/lib/tanks/world";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's clock, so a player's app counts the turn time the way the server does. */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "cache-control": "no-store" } });
}

/**
 * Plays one action in an online tank battle for the signed-in player: joining an open battle, a shot, a drive,
 * reporting a turn that ran out, resigning, cancelling an open battle, or asking for a rematch. Shots are simulated
 * here (lib/tanks/rules.ts). Answers with the battle as it now stands, also when the action is refused, so the app
 * can put its field back, and with the server's clock. A rematch answers with the new battle's id as `next`.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/tanks/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "no such battle." }, { status: 404 });
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
    return NextResponse.json({ error: "online tanks isn't set up on this server." }, { status: 503 });
  }

  // Another write can land between the read and ours (the other player resigning, say). The write only goes
  // through if the row is still at the step we read, so on a clash read again and decide afresh.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error: readError } = await db.from("tank_games").select("*").eq("id", id).maybeSingle();
    if (readError) return NextResponse.json({ error: "couldn't load the battle." }, { status: 500 });
    const game = row as TankGame | null;
    if (!game || (action.type !== "join" && seatOf(game, me) === null)) return NextResponse.json({ error: "no such battle." }, { status: 404 });

    const verdict = decide(game, me, action);
    if ("error" in verdict)
      return NextResponse.json(
        {
          error: verdict.error,
          game: seatOf(game, me) === null ? undefined : game,
          now: Date.now(),
        },
        { status: 409 },
      );

    if ("rematch" in verdict) {
      if (game.next) return NextResponse.json({ game, next: game.next, now: Date.now() });
      // Sides swap: whoever had the right tank now has the left one and shoots first.
      const { data: made, error } = await db
        .from("tank_games")
        .insert({
          p1: game.p2,
          p2: game.p1,
          p1_name: game.p2_name,
          p2_name: game.p1_name,
          status: "active",
          world: newWorld(randomSeed()),
        })
        .select("id")
        .single();
      if (error || !made)
        return NextResponse.json(
          {
            error: "couldn't start the rematch. try again.",
            game,
            now: Date.now(),
          },
          { status: 500 },
        );
      const { data: saved } = await db.from("tank_games").update({ next: made.id, updated_at: new Date().toISOString() }).eq("id", id).is("next", null).select("*").maybeSingle();
      if (saved)
        return NextResponse.json({
          game: saved,
          next: made.id,
          now: Date.now(),
        });
      // They asked at the same moment and theirs landed first: use theirs.
      await db.from("tank_games").delete().eq("id", made.id);
      continue;
    }

    if (!Object.keys(verdict.patch).length) return NextResponse.json({ game, now: Date.now() });
    const { data: saved, error } = await db
      .from("tank_games")
      .update({ ...verdict.patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("step", game.step)
      .select("*")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "couldn't save. try again.", game, now: Date.now() }, { status: 500 });
    if (saved) return NextResponse.json({ game: saved, now: Date.now() });
  }
  return NextResponse.json({ error: "the battle keeps changing. try again." }, { status: 409 });
}
