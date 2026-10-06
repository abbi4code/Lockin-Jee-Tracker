import "server-only";
import webpush from "web-push";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Sends web-push notifications. Keys: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (see .env.example).

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

let configured = false;
export function pushConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://github.com/abbi4code/Lockin-Jee-Tracker", pub, priv);
  configured = true;
  return true;
}

/** Sends to every device the user turned reminders on for; drops subscriptions the browser has revoked. Returns how many got it. */
export async function sendToUser(userId: string, payload: PushPayload) {
  if (!pushConfigured()) throw new Error("Push isn't configured: set the VAPID keys.");
  const admin = createSupabaseAdmin();
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw error;
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "normal" });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the subscription is gone (app uninstalled, permission revoked).
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push failed", status, (e as Error).message);
      }
    }),
  );
  return sent;
}
