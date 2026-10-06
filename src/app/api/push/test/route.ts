import { NextResponse } from "next/server";
import { sendToUser } from "@/lib/push-server";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Sends the signed-in user a test notification on every device they turned reminders on for. */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub as string | undefined;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  try {
    const sent = await sendToUser(user, { title: "lockin. reminders are on", body: "this is what your morning plan and evening nudge will look like.", url: "/today", tag: "lockin-test" });
    return NextResponse.json({ sent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
