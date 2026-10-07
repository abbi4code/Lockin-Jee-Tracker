/**
 * Runs once when the server starts. The app's users are in India and every "day" (streaks, study time, plans,
 * the admin panel's charts) is an Indian day, but hosts like Vercel run in UTC: without this, anything studied
 * after 6:30 pm would count toward the next day on the server. Node applies a TZ change immediately.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") process.env.TZ ??= "Asia/Kolkata";
}
