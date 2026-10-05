import type { Metadata } from "next";
import { ExtrasScreen } from "@/screens/Extras";

export const metadata: Metadata = { title: "Extras", robots: { index: false } };

export default function Page() {
  return <ExtrasScreen />;
}
