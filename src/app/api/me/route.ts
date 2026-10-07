import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Whether the signed-in account is an admin (ADMIN_EMAILS stays server-side; the app only learns yes/no). */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ admin: false });
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return NextResponse.json({ admin: isAdminEmail(data?.claims?.email as string | undefined) }, { headers: { "Cache-Control": "private, no-store" } });
}
