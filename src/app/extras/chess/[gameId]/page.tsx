import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChessScreen } from "@/screens/Chess";

export const metadata: Metadata = { title: "Chess · online", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An online game. The proxy sends signed-out visitors to /login and back here afterwards. */
export default async function Page({ params }: PageProps<"/extras/chess/[gameId]">) {
  const { gameId } = await params;
  if (!UUID.test(gameId)) notFound();
  return <ChessScreen gameId={gameId} />;
}
