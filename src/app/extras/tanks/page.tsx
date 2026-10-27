import type { Metadata } from "next";
import { TanksScreen } from "@/screens/Tanks";

export const metadata: Metadata = { title: "Tanks", robots: { index: false } };

export default function Page() {
  return <TanksScreen />;
}
