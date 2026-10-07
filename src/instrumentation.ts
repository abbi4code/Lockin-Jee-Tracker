/**
 * Runs once when the server starts. The app's users are in India and every "day" (streaks, study time, plans,
 * the admin panel's charts) is an Indian day, but hosts like Vercel run in UTC: without this, anything studied
 * after 6:30 pm would count toward the next day on the server. Node applies a TZ change immediately.
 * Always assigned: Vercel/Lambda pre-set TZ to UTC, so "only if unset" never took effect. APP_TZ overrides it.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") process.env.TZ = process.env.APP_TZ || "Asia/Kolkata";
}
