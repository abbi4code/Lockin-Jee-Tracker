import { NextResponse, type NextRequest } from "next/server";
import { runReminders } from "@/lib/reminders";

/**
 * Sends due push reminders. Called every 15 minutes by a Supabase pg_cron job (see
 * supabase/migrations/20261006000000_plan_reminders.sql) with `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runReminders());
  } catch (e) {
    console.error("reminders failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
