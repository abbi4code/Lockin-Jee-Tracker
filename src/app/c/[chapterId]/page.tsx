import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ALL_CHAPTERS, getChapter } from "@/data";
import { ChapterScreen } from "@/screens/Chapter";

export const dynamicParams = false;
export const generateStaticParams = () => ALL_CHAPTERS.map((c) => ({ chapterId: c.id }));

export async function generateMetadata({ params }: PageProps<"/c/[chapterId]">): Promise<Metadata> {
  const { chapterId } = await params;
  return { title: getChapter(chapterId)?.name };
}

export default async function Page({ params }: PageProps<"/c/[chapterId]">) {
  const { chapterId } = await params;
  if (!getChapter(chapterId)) notFound();
  return <ChapterScreen chapterId={chapterId} />;
}
