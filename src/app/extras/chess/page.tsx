import type { Metadata } from "next";
import { ChessScreen } from "@/screens/Chess";

export const metadata: Metadata = { title: "Chess", robots: { index: false } };

export default function Page() {
  return <ChessScreen />;
}
