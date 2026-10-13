import type { Metadata } from "next";
import { QuizrrScreen } from "@/screens/Quizrr";

export const metadata: Metadata = { title: "Quizrr tests" };

export default function Page() {
  return <QuizrrScreen />;
}
