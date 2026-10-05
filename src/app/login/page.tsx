import type { Metadata } from "next";
import { AuthScreen } from "@/screens/Auth";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <AuthScreen mode="signin" />;
}
