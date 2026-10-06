import type { Metadata } from "next";
import { PlanScreen } from "@/screens/Plan";

export const metadata: Metadata = { title: "Planner" };

export default function Page() {
  return <PlanScreen />;
}
