import { CircleCheck, CircleX, Clock, History, RotateCcw, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DomainDot } from "@/components/common/domain-badge";
import { PageHeader } from "@/components/common/page-header";
import { ProgressRing } from "@/components/common/progress-ring";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireUser } from "@/lib/auth/session";
import { getDomain } from "@/lib/config/domains";
import { getRepository } from "@/lib/data";
import { formatDuration } from "@/lib/format";
import { getQuizSummary } from "@/lib/services/study-service";

export const metadata: Metadata = { title: "Session summary" };

export default async function QuizSummaryPage({ params }: PageProps<"/quiz/[sessionId]/summary">) {
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  const user = await requireUser();
  const summary = await getQuizSummary(user, await getRepository(), sessionId);
  if (!summary) notFound();

  const { session, items, correct, answered } = summary;
  const pct = answered ? correct / answered : 0;
  const missedIds = items.filter((i) => i.attempt && !i.attempt.isCorrect).map((i) => i.question.id);
  const unansweredIds = items.filter((i) => !i.attempt).map((i) => i.question.id);
  const avgSeconds = answered ? session.timeSpentMs / 1000 / answered : 0;
  const message =
    answered === 0
      ? "No answers yet. Jump back in whenever you're ready."
      : pct >= 0.9
        ? "Outstanding. You're locking this material in."
        : pct >= 0.75
          ? "Strong session. A little review and you'll own these topics."
          : pct >= 0.5
            ? "Solid effort. Your misses are now queued for spaced review."
            : "Tough set — that's how learning happens. Review the misses while they're fresh.";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Session complete" title={session.title} description={message} />

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
          <ProgressRing value={pct} size={140} stroke={12} label={`Score ${Math.round(pct * 100)} percent`}>
            <div>
              <p className="text-3xl font-semibold">{Math.round(pct * 100)}%</p>
              <p className="text-xs text-muted-foreground">score</p>
            </div>
          </ProgressRing>
          <dl className="grid w-full flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CircleCheck className="size-4 text-success" aria-hidden /> Correct
              </dt>
              <dd className="text-2xl font-semibold">{correct}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CircleX className="size-4 text-danger" aria-hidden /> Incorrect
              </dt>
              <dd className="text-2xl font-semibold">{answered - correct}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-4" aria-hidden /> Time
              </dt>
              <dd className="text-2xl font-semibold">{formatDuration(session.timeSpentMs / 1000)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Avg / question</dt>
              <dd className="text-2xl font-semibold">{formatDuration(avgSeconds)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {missedIds.length > 0 && (
          <StartQuizButton
            fields={{ mode: "retry", count: String(missedIds.length), questionIds: missedIds, title: `Retry: ${session.title}`.slice(0, 120) }}
            variant="default"
          >
            <RotateCcw /> Retry {missedIds.length} missed
          </StartQuizButton>
        )}
        {unansweredIds.length > 0 && (
          <Button variant="outline" asChild>
            <Link href={`/quiz/${session.id}`}>Resume ({unansweredIds.length} left)</Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href={`/review?session=${session.id}`}>
            <History /> Review answers
          </Link>
        </Button>
        <StartQuizButton fields={{ mode: "daily", count: "10" }} variant="outline">
          <Sparkles /> New session
        </StartQuizButton>
        <Button variant="ghost" asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>By domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.domainBreakdown.length === 0 && <p className="text-sm text-muted-foreground">Answer a question to see a breakdown.</p>}
            {summary.domainBreakdown.map((d) => (
              <div key={d.domainId}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <DomainDot domainId={d.domainId} />
                    <span className="truncate">{getDomain(d.domainId).shortName}</span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {d.correct}/{d.total} · {Math.round(d.percent)}%
                  </span>
                </div>
                <Progress value={d.percent} aria-label={`${getDomain(d.domainId).name}: ${Math.round(d.percent)}%`} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {items.map(({ question, attempt }, i) => (
                <li key={question.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{i + 1}.</span>
                  {attempt ? (
                    attempt.isCorrect ? (
                      <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-label="Correct" />
                    ) : (
                      <CircleX className="mt-0.5 size-5 shrink-0 text-danger" aria-label="Incorrect" />
                    )
                  ) : (
                    <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-dashed" aria-label="Not answered" />
                  )}
                  <Link href={`/questions/${question.id}`} className="line-clamp-2 flex-1 text-sm hover:underline">
                    {question.stem}
                  </Link>
                  {attempt?.confidence && (
                    <Badge variant="secondary" className="hidden capitalize sm:inline-flex">
                      {attempt.confidence}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
