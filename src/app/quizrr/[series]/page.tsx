import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ACTIVE_SERIES, getActiveSeries } from "@/lib/quizrr";
import { QuizrrSeriesScreen } from "@/screens/Quizrr";

export const dynamicParams = false;
export const generateStaticParams = () => ACTIVE_SERIES.map((s) => ({ series: s.id }));

export async function generateMetadata({ params }: PageProps<"/quizrr/[series]">): Promise<Metadata> {
  const { series } = await params;
  const s = getActiveSeries(series);
  return { title: s ? `${s.name} · ${s.title}` : undefined };
}

export default async function Page({ params }: PageProps<"/quizrr/[series]">) {
  const { series } = await params;
  const s = getActiveSeries(series);
  if (!s) notFound();
  return <QuizrrSeriesScreen seriesId={s.id} />;
}
