import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service client using the secret key: bypasses row-level security. Server code only, admin pages only. */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set for the admin panel.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
