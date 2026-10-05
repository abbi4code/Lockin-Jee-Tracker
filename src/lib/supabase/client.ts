import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Browser client (session kept in cookies so server code can read it). null until .env is filled in. */
export const supabase = url && key && typeof window !== "undefined" ? createBrowserClient(url, key) : null;
