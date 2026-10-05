import type { Metadata } from "next";
import { Home } from "@/screens/Home";

export const metadata: Metadata = { title: "Today" };

export default function Page() {
  return <Home />;
}
