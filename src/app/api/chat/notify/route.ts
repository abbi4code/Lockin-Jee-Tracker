import { NextResponse, type NextRequest } from "next/server";
import { getChapter } from "@/data";
import { pushConfigured, sendToUser } from "@/lib/push-server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Only messages this fresh can be pushed: a replayed request can't re-ping old ones. */
const FRESH_MS = 2 * 60_000;

const firstName = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();

/**
 * Pushes a chat message the signed-in user just sent to the other side's devices (every device that turned
 * notifications on). Student → every admin; admin → the student. Called by the sender's app right after the insert.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const me = data?.claims?.sub as string | undefined;
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string") return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!pushConfigured()) return NextResponse.json({ sent: 0 });

  const db = createSupabaseAdmin();
  const { data: m } = await db.from("messages").select("student_id, sender_id, body, chapter_id, created_at").eq("id", id).maybeSingle();
  if (!m || m.sender_id !== me || Date.now() - new Date(m.created_at).getTime() > FRESH_MS) return NextResponse.json({ sent: 0 });

  const fromStudent = m.sender_id === m.student_id;
  const { data: sender } = await db.auth.admin.getUserById(me);
  let title: string;
  let recipients: string[];
  if (fromStudent) {
    const [{ data: state }, { data: admins }, { data: users }] = await Promise.all([
      db.from("user_state").select("data").eq("user_id", me).maybeSingle(),
      db.from("admins").select("email"),
      db.auth.admin.listUsers({ page: 1, perPage: 500 }),
    ]);
    const emails = new Set((admins ?? []).map((a) => (a.email as string).toLowerCase()));
    recipients = (users?.users ?? []).filter((u) => u.email && emails.has(u.email.toLowerCase())).map((u) => u.id);
    const name = (state?.data as { settings?: { name?: string } } | undefined)?.settings?.name || (sender?.user?.user_metadata?.name as string | undefined) || sender?.user?.email?.split("@")[0] || "student";
    title = firstName(name);
  } else {
    recipients = [m.student_id];
    title = firstName((sender?.user?.user_metadata?.name as string | undefined) || sender?.user?.email?.split("@")[0] || "coach");
  }

  const chapter = m.chapter_id ? getChapter(m.chapter_id) : null;
  const text = m.body.length > 180 ? `${m.body.slice(0, 179)}…` : m.body;
  let sent = 0;
  await Promise.all(
    recipients
      .filter((r) => r !== me)
      .map(async (r) => {
        try {
          sent += await sendToUser(r, {
            title,
            body: chapter ? `${chapter.name} · ${text}` : text,
            // Opens the chat: the student's app, or this student's page in the admin panel.
            url: fromStudent ? `/admin/u/${m.student_id}?chat=1` : "/today?chat=1",
            // One notification per thread, replaced by the newest message (and still buzzing each time).
            tag: `lockin-chat-${m.student_id}`,
            renotify: true,
            deliver: true,
          });
        } catch (e) {
          console.error("chat push failed", (e as Error).message);
        }
      }),
  );
  return NextResponse.json({ sent });
}
