import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CODE } from "@/lib/skribbl/rules";
import { SkribblRoom } from "@/screens/Skribbl";

export const metadata: Metadata = { title: "Skribbl · room", robots: { index: false } };

/** A room. The proxy sends signed-out visitors to /login and back here afterwards. A code typed in lowercase works too. */
export default async function Page({ params }: PageProps<"/extras/skribbl/[code]">) {
  const code = (await params).code.toUpperCase();
  if (!CODE.test(code)) notFound();
  return <SkribblRoom code={code} />;
}
