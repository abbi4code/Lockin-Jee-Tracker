import { NextResponse, type NextRequest } from "next/server";
import { livekitConfigured, livekitUrl, mintToken, roomFor } from "@/lib/call/livekit-server";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * A LiveKit token for joining call `id`'s media room. Only for a signed-in member who's in the call: the reads below
 * run as the user, and row-level security (call_active_member, 20261026180000_calls.sql) only shows a call to members
 * who are ringing or joined and still allowed in it. So the token rules are the calls rules, not a second copy.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/call/[id]/token">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail("no such call.", 404);
  if (!livekitConfigured()) return fail("calls aren't set up on this server yet.", 503);
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return fail("sign in first.", 401);

  const [{ data: call }, { data: member }] = await Promise.all([
    supabase.from("calls").select("id, ended_at").eq("id", id).maybeSingle(),
    supabase.from("call_members").select("name, state").eq("call", id).eq("user_id", me).maybeSingle(),
  ]);
  if (!call) return fail("no such call.", 404);
  if (call.ended_at) return fail("this call has ended.", 410);
  if (member?.state !== "joined") return fail("join the call first.", 403);

  const token = await mintToken({ room: roomFor(id), identity: me, name: (member.name as string) || "someone" });
  return NextResponse.json({ url: livekitUrl(), token }, { headers: { "cache-control": "no-store" } });
}
