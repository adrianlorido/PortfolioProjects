import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ExamRunner } from "@/components/exam/exam-runner";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { loadExam } from "@/lib/services/exam-service";

export const metadata: Metadata = { title: "Practice exam" };

export default async function ExamRunnerPage({ params }: PageProps<"/exam/[examId]">) {
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) notFound();
  const user = await requireUser();
  const loaded = await loadExam(user, await getRepository(), examId);
  if (!loaded) notFound();
  if (loaded.exam.status === "submitted") redirect(`/exam/${examId}/results`);

  return (
    <ExamRunner
      examId={loaded.exam.id}
      title={loaded.exam.title}
      questions={loaded.questions}
      initialResponses={loaded.exam.responses}
      expiresAt={loaded.exam.expiresAt}
      serverNow={loaded.serverNow}
    />
  );
}
