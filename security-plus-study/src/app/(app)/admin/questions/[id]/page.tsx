import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuestionEditor } from "@/components/admin/question-editor";
import { requireAdmin } from "@/lib/auth/session";
import { getTopicName } from "@/lib/config/topics";
import { getRepository } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params }: PageProps<"/admin/questions/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const repo = await getRepository();
  const [question, topics] = await Promise.all([repo.getQuestion(id), repo.listTopics()]);
  if (!question) notFound();
  const names = new Map(topics.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Last updated {formatDate(question.updatedAt, { month: "short", day: "numeric", year: "numeric" })} ·{" "}
        <Link href={`/questions/${question.id}`} className="text-primary hover:underline">
          View as learner
        </Link>
      </p>
      <QuestionEditor
        key={question.updatedAt}
        topicOptions={topics}
        initial={{
          id: question.id,
          stem: question.stem,
          choices: question.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect, explanation: c.explanation ?? "" })),
          domainId: question.domainId,
          topics: question.topics.map((t) => names.get(t) ?? getTopicName(t)),
          difficulty: question.difficulty,
          explanation: question.explanation,
          examClue: question.examClue,
          memoryTip: question.memoryTip,
          isScenario: question.isScenario,
          status: question.status,
        }}
      />
    </div>
  );
}
