import type { Metadata } from "next";
import { SkribblHome } from "@/screens/Skribbl";

export const metadata: Metadata = { title: "Skribbl", robots: { index: false } };

export default function Page() {
  return <SkribblHome />;
}
