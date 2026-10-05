import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSubject, SUBJECTS } from "@/data";
import { SubjectScreen } from "@/screens/Subject";

export const dynamicParams = false;
export const generateStaticParams = () => SUBJECTS.map((s) => ({ subjectId: s.id }));

export async function generateMetadata({ params }: PageProps<"/s/[subjectId]">): Promise<Metadata> {
  const { subjectId } = await params;
  return { title: getSubject(subjectId)?.name };
}

export default async function Page({ params }: PageProps<"/s/[subjectId]">) {
  const { subjectId } = await params;
  if (!getSubject(subjectId)) notFound();
  return <SubjectScreen subjectId={subjectId} />;
}
