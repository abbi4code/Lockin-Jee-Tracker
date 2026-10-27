import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TanksScreen } from "@/screens/Tanks";

export const metadata: Metadata = {
  title: "Tanks · online",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An online battle. The proxy sends signed-out visitors to /login and back here afterwards. */
export default async function Page({ params }: PageProps<"/extras/tanks/[gameId]">) {
  const { gameId } = await params;
  if (!UUID.test(gameId)) notFound();
  // Keyed by the battle, so a rematch (a new id) starts with a fresh screen.
  return <TanksScreen key={gameId} gameId={gameId} />;
}
