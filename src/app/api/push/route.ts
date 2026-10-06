import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

async function currentUser() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

/**
 * Saves this device's push subscription for the signed-in user. Written with the secret key so a device that
 * switches accounts moves its subscription to the new account (the endpoint is the key).
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const sub = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!sub.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys.auth) return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  const { error } = await createSupabaseAdmin()
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, user_id: user, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Forgets this device's subscription (only if it belongs to the signed-in user). */
export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { endpoint } = (await request.json()) as { endpoint?: string };
  if (endpoint) await createSupabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user);
  return NextResponse.json({ ok: true });
}
