import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MasteryMeter } from "@/components/common/mastery-badge";
import { TopicChips } from "@/components/common/topic-chips";
import { BookmarkButton } from "@/components/library/bookmark-button";
import { QuestionExplorer } from "@/components/library/question-explorer";
import { NoteEditor } from "@/components/quiz/note-editor";
import { ReportDialog } from "@/components/quiz/report-dialog";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { formatRelative } from "@/lib/format";
import { getQuestionDetail } from "@/lib/services/review-service";

export const metadata: Metadata = { title: "Question" };

export default async function QuestionPage({ params }: PageProps<"/questions/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const detail = await getQuestionDetail(user, await getRepository(), id);
  if (!detail) notFound();
  const { question, state } = detail;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href="/search">
            <ArrowLeft /> Search
          </Link>
        </Button>
        <Card>
          <CardContent>
            <QuestionExplorer question={question} />
          </CardContent>
        </Card>
        <NoteEditor questionId={question.id} initialNote={detail.note} defaultOpen />
      </div>
      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Your history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {state ? (
              <>
                <MasteryMeter level={state.mastery} />
                <dl className="grid grid-cols-2 gap-2">
                  <dt className="text-muted-foreground">Answered</dt>
                  <dd className="text-right font-medium">{state.timesSeen}×</dd>
                  <dt className="text-muted-foreground">Correct</dt>
                  <dd className="text-right font-medium">{state.timesCorrect}×</dd>
                  <dt className="text-muted-foreground">Last seen</dt>
                  <dd className="text-right font-medium">{formatRelative(state.lastAnsweredAt)}</dd>
                  <dt className="text-muted-foreground">Next review</dt>
                  <dd className="text-right font-medium">{detail.due ? "Due now" : formatRelative(state.dueAt)}</dd>
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground">You haven&apos;t answered this question yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Topics</CardTitle>
          </CardHeader>
          <CardContent>
            <TopicChips topics={question.topics} linked />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2">
          <StartQuizButton fields={{ mode: "custom", count: "1", questionIds: question.id, title: "Single question practice" }} className="w-full">
            Practice this question
          </StartQuizButton>
          <BookmarkButton questionId={question.id} initial={detail.bookmarked} size="default" />
          <ReportDialog questionId={question.id} />
          {user.role === "admin" && (
            <Button variant="ghost" asChild>
              <Link href={`/admin/questions/${question.id}`}>
                <Pencil /> Edit question
              </Link>
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
