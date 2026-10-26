import { NextResponse } from "next/server";
import { STUN } from "@/lib/call/stun";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * The ICE servers for a call: public STUN, plus a TURN relay when TURN_URLS is set. TURN credentials
 * cost money if strangers use them, so they're only given to signed-in users and never built into the page.
 */
export async function GET() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const urls = (process.env.TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const turn: RTCIceServer[] = urls.length ? [{ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }] : [];
  return NextResponse.json({ iceServers: [...STUN, ...turn] }, { headers: { "cache-control": "no-store" } });
}
