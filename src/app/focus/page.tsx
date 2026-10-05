import type { Metadata } from "next";
import { FocusScreen } from "@/screens/Focus";

export const metadata: Metadata = { title: "Focus" };

export default function Page() {
  return <FocusScreen />;
}
