import type { Metadata } from "next";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { MeScreen } from "@/screens/Me";

export const metadata: Metadata = { title: "Me" };

export default async function Page() {
  let isAdmin = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getClaims();
    isAdmin = isAdminEmail(data?.claims?.email as string | undefined);
  }
  return <MeScreen isAdmin={isAdmin} />;
}
