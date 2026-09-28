import type { Metadata } from "next";

import { QuestionEditor } from "@/components/admin/question-editor";
import { requireAdmin } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  await requireAdmin();
  const topics = await (await getRepository()).listTopics();
  return <QuestionEditor topicOptions={topics} />;
}
