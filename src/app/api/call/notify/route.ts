import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { RING_MS, type CallRow, type MemberRow } from "@/lib/call/calls";
import { pushConfigured, sendToUser } from "@/lib/push-server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstName = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() || "someone";
const WHERE: Record<string, string> = { chess: "from your chess game", skribbl: "from skribbl" };

/**
 * Pushes "<name> is calling" to the devices of everyone a call is ringing, so a ring reaches someone whose app is
 * closed. Called by the caller's app right after start_call. Only a member who's in the call can trigger it, and
 * only rings still fresh are pushed, so a replayed request can't re-ping anyone.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const me = data?.claims?.sub as string | undefined;
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { call: id } = ((await request.json().catch(() => null)) ?? {}) as { call?: unknown };
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!pushConfigured()) return NextResponse.json({ sent: 0 });

  const db = createSupabaseAdmin();
  const [{ data: call }, { data: members }] = await Promise.all([
    db.from("calls").select("*").eq("id", id).maybeSingle(),
    db.from("call_members").select("*").eq("call", id),
  ]);
  const rows = (members ?? []) as MemberRow[];
  const caller = rows.find((m) => m.user_id === me);
  if (!call || (call as CallRow).ended_at || caller?.state !== "joined") return NextResponse.json({ sent: 0 });

  const fresh = rows.filter((m) => m.user_id !== me && m.state === "ringing" && Date.now() - Date.parse(m.updated_at) < RING_MS);
  const where = WHERE[(call as CallRow).context.split(":")[0]] ?? "";
  let sent = 0;
  await Promise.all(
    fresh.map(async (m) => {
      try {
        // The coach lives in the admin panel; everyone else in the app. The call window shows on either.
        const { data: u } = await db.auth.admin.getUserById(m.user_id);
        const n = await sendToUser(m.user_id, {
          title: `${firstName(caller.name)} is calling`,
          body: where ? `video call ${where} · tap to answer` : "video call · tap to answer",
          url: isAdminEmail(u?.user?.email) ? "/admin" : "/today",
          tag: `lockin-call-${id}`,
          renotify: true,
        });
        // Added after the await: `sent += await …` would read `sent` before the other sends finished.
        sent += n;
      } catch (e) {
        console.error("call push failed", (e as Error).message);
      }
    }),
  );
  return NextResponse.json({ sent });
}
