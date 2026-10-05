"use server";

import { requireAdmin } from "@/lib/admin-data";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface ThreadSummary {
  studentId: string;
  name: string;
  email: string;
  lastBody: string | null;
  lastAt: string | null;
  lastFromStudent: boolean;
  unread: number;
}

/** Admin inbox: every student with their latest message and unread count. */
export async function listThreads(): Promise<ThreadSummary[]> {
  if (!(await requireAdmin())) throw new Error("Not an admin.");
  const db = createSupabaseAdmin();
  const [users, admins, states, msgs] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 500 }),
    db.from("admins").select("email"),
    db.from("user_state").select("user_id, data"),
    db.from("messages").select("student_id, sender_id, body, created_at, read_at").order("created_at", { ascending: false }).limit(2000),
  ]);
  const adminEmails = new Set((admins.data ?? []).map((a) => a.email.toLowerCase()));
  const names = new Map((states.data ?? []).map((r) => [r.user_id, (r.data as { settings?: { name?: string } })?.settings?.name]));

  return (users.data?.users ?? [])
    .filter((u) => !adminEmails.has((u.email ?? "").toLowerCase()))
    .map((u) => {
      const thread = (msgs.data ?? []).filter((m) => m.student_id === u.id);
      const last = thread[0];
      return {
        studentId: u.id,
        name: names.get(u.id) || (u.user_metadata?.name as string | undefined) || u.email?.split("@")[0] || "student",
        email: u.email ?? "",
        lastBody: last?.body ?? null,
        lastAt: last?.created_at ?? null,
        lastFromStudent: last ? last.sender_id === u.id : false,
        unread: thread.filter((m) => m.sender_id === u.id && !m.read_at).length,
      };
    })
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** The coach's display name, for the student's chat header. Any signed-in user may ask. */
export async function coachName(): Promise<string> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return "coach";
  const db = createSupabaseAdmin();
  const { data: admins } = await db.from("admins").select("email").limit(1);
  const email = admins?.[0]?.email;
  if (!email) return "coach";
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 500 });
  const u = users?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  return ((u?.user_metadata?.name as string | undefined) || email.split("@")[0]).split(" ")[0].toLowerCase();
}
