import "server-only";
import { getChapter, type Exam } from "@/data";
import { fromPlanRow, type PlanRow } from "@/lib/plan";
import { sendToUser, type PushPayload } from "@/lib/push-server";
import { normalizeStatus } from "@/lib/stages";
import { revisionsDue } from "@/lib/stats";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChapterProgress, Reminders, Settings } from "@/store/progress";

// The reminder job (GET /api/cron/reminders, every 15 min). For each user with push turned on, when their
// morning or evening time has just passed in their time zone, it sends one notification about today's plan.
// reminder_log makes it idempotent: overlapping or repeated runs never send the same reminder twice.

type Slot = "morning" | "evening";
/** A reminder still goes out if the job runs up to this long after its time (missed or delayed runs). */
const GRACE_MIN = 60;

/** Local date (YYYY-MM-DD) and minutes since midnight in a time zone. */
function localNow(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const names = (ids: string[]) => {
  const list = ids.map((id) => getChapter(id)?.name ?? id);
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3} more` : list.join(", ");
};

/** What to say, or null if there's nothing worth a notification. */
async function compose(userId: string, slot: Slot, day: string, exam: Exam): Promise<PushPayload | null> {
  const admin = createSupabaseAdmin();
  const [{ data: rows }, { data: progress }] = await Promise.all([
    admin.from("plan_items").select("id, chapter_id, date, kind, done_at, deleted, updated_at").eq("user_id", userId).eq("deleted", false).is("done_at", null).lte("date", day),
    admin.from("chapter_progress").select("chapter_id, data").eq("user_id", userId),
  ]);
  const items = ((rows ?? []) as PlanRow[]).map(fromPlanRow);
  const todays = items.filter((i) => i.date === day);
  const late = items.filter((i) => i.date < day);
  const chapters: Record<string, ChapterProgress> = {};
  for (const r of progress ?? []) chapters[r.chapter_id] = { ...(r.data as ChapterProgress), status: normalizeStatus((r.data as ChapterProgress).status) };
  const planned = new Set(items.map((i) => i.chapterId));
  const unplanned = revisionsDue(chapters, exam, day).filter((d) => !planned.has(d.chapter.id));
  const lateLine = late.length ? ` · ${late.length} overdue` : "";

  if (slot === "morning") {
    if (todays.length) return { title: `today: ${todays.length} planned${lateLine}`, body: names(todays.map((i) => i.chapterId)), url: "/today", tag: "lockin-morning" };
    if (late.length) return { title: `${late.length} overdue from your plan`, body: `${names(late.map((i) => i.chapterId))}. move them to today or tick them off.`, url: "/plan", tag: "lockin-morning" };
    if (unplanned.length) return { title: `${unplanned.length} revision${unplanned.length === 1 ? "" : "s"} due`, body: `${names(unplanned.map((d) => d.chapter.id))}. plan them for today?`, url: "/plan", tag: "lockin-morning" };
    return null;
  }
  // Evening: only a nudge if something planned is still open.
  const open = [...todays, ...late];
  if (!open.length) return null;
  return { title: `still to do: ${open.length}`, body: `${names(open.map((i) => i.chapterId))}. even one before bed keeps the streak alive.`, url: "/today", tag: "lockin-evening" };
}

export async function runReminders(now = new Date()) {
  const admin = createSupabaseAdmin();
  const { data: subs, error } = await admin.from("push_subscriptions").select("user_id");
  if (error) throw error;
  const users = [...new Set((subs ?? []).map((s) => s.user_id as string))];
  if (!users.length) return { users: 0, sent: 0, skipped: 0 };
  const { data: states } = await admin.from("user_state").select("user_id, data").in("user_id", users);

  let sent = 0;
  let skipped = 0;
  for (const st of states ?? []) {
    const settings = (st.data as { settings?: Settings })?.settings;
    const r: Reminders | undefined = settings?.reminders;
    if (!r) continue;
    const { day, minutes } = localNow(r.tz || "Asia/Kolkata", now);
    for (const slot of ["morning", "evening"] as const) {
      const at = r[slot];
      if (!at) continue;
      const since = minutes - toMinutes(at);
      if (since < 0 || since > GRACE_MIN) continue;
      // Claim this (user, day, slot) first; if another run already did, skip.
      const { error: claimed } = await admin.from("reminder_log").insert({ user_id: st.user_id, day, slot });
      if (claimed) continue;
      const payload = await compose(st.user_id, slot, day, settings?.exam ?? "advanced");
      if (!payload) {
        skipped++;
        continue;
      }
      sent += await sendToUser(st.user_id, payload);
    }
  }
  return { users: users.length, sent, skipped };
}
