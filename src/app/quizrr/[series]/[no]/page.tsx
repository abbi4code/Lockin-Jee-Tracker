import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ACTIVE_TESTS, findTest, testName } from "@/lib/quizrr";
import { QuizrrTestScreen } from "@/screens/Quizrr";

export const dynamicParams = false;
export const generateStaticParams = () => ACTIVE_TESTS.map((t) => ({ series: t.series, no: String(t.no) }));

export async function generateMetadata({ params }: PageProps<"/quizrr/[series]/[no]">): Promise<Metadata> {
  const { series, no } = await params;
  const t = findTest(series, no);
  return { title: t ? testName(t) : undefined };
}

export default async function Page({ params }: PageProps<"/quizrr/[series]/[no]">) {
  const { series, no } = await params;
  const t = findTest(series, no);
  if (!t) notFound();
  return <QuizrrTestScreen series={t.series} no={t.no} />;
}
