import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { newWorld, randomSeed } from "@/lib/tanks/world";

/** Opens a new tank battle with the signed-in user on the left tank. Answers with its id (the link is /extras/tanks/<id>). */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return NextResponse.json({ error: "sign in to play online." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };

  let db: ReturnType<typeof createSupabaseAdmin>;
  try {
    db = createSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "online tanks isn't set up on this server." }, { status: 503 });
  }
  const name = typeof body.name === "string" ? body.name.slice(0, 40) : "";
  const { data, error } = await db
    .from("tank_games")
    .insert({ p1: me, p1_name: name, world: newWorld(randomSeed()) })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "couldn't open a battle. try again." }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
