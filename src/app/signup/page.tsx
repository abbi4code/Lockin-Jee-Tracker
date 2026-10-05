import type { Metadata } from "next";
import { AuthScreen } from "@/screens/Auth";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return <AuthScreen mode="signup" />;
}
