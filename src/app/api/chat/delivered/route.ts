import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Marks the signed-in user's incoming messages as delivered (✓✓ for the sender). Called by the service worker
 * when a chat push lands on the phone, so delivery counts even if the app is never opened.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { data: n, error } = await supabase.rpc("mark_delivered");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ delivered: n ?? 0 });
}
