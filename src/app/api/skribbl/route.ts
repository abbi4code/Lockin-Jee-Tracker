import { NextResponse, type NextRequest } from "next/server";
import { cleanName, cleanSettings, DEFAULT_SETTINGS, roomCode } from "@/lib/skribbl/rules";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Opens a new skribbl room with the signed-in user as host (and its first player). Answers with the room code. */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return NextResponse.json({ error: "sign in to play." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };

  let db: ReturnType<typeof createSupabaseAdmin>;
  try {
    db = createSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "skribbl isn't set up on this server." }, { status: 503 });
  }

  // Codes are random: on the rare clash with an existing room, draw another.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    const { data: room, error } = await db
      .from("skribbl_rooms")
      .insert({ code, host: me, settings: cleanSettings(DEFAULT_SETTINGS) })
      .select("id, code")
      .single();
    if (error?.code === "23505") continue;
    if (error || !room) return NextResponse.json({ error: "couldn't open a room. try again." }, { status: 500 });
    const [{ error: playerError }, { error: secretError }] = await Promise.all([
      db.from("skribbl_players").insert({ room: room.id, user_id: me, name: cleanName(body.name) || "player" }),
      db.from("skribbl_secrets").insert({ room: room.id }),
    ]);
    if (playerError || secretError) {
      await db.from("skribbl_rooms").delete().eq("id", room.id);
      return NextResponse.json({ error: "couldn't open a room. try again." }, { status: 500 });
    }
    return NextResponse.json({ code: room.code });
  }
  return NextResponse.json({ error: "couldn't open a room. try again." }, { status: 500 });
}
