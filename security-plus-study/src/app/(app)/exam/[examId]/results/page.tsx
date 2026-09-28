import { CircleCheck, CircleMinus, CircleX, Clock, Flag, History, RotateCcw, Timer, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DomainDot } from "@/components/common/domain-badge";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getDomain } from "@/lib/config/domains";
import { EXAM_CONFIG } from "@/lib/config/exam";
import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getTopicName } from "@/lib/config/topics";
import { getRepository } from "@/lib/data";
import { formatDate, formatDuration } from "@/lib/format";
import { getExamReport } from "@/lib/services/exam-service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exam results" };

function Stat({ icon: Icon, label, value, className }: { icon: typeof Clock; label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className={cn("size-4", className)} aria-hidden /> {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default async function ExamResultsPage({ params }: PageProps<"/exam/[examId]/results">) {
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) notFound();
  const user = await requireUser();
  const report = await getExamReport(user, await getRepository(), examId);
  if (!report) notFound();
  const { exam } = report;
  if (exam.status !== "submitted" || !exam.result) redirect(`/exam/${examId}`);
  const r = exam.result;
  const scalePct = ((r.scaledScore - EXAM_CONFIG.scaleMin) / (EXAM_CONFIG.scaleMax - EXAM_CONFIG.scaleMin)) * 100;
  const passPct = ((r.passingScore - EXAM_CONFIG.scaleMin) / (EXAM_CONFIG.scaleMax - EXAM_CONFIG.scaleMin)) * 100;
  const retryIds = r.questions.filter((q) => !q.isCorrect).map((q) => q.questionId).slice(0, MAX_SESSION_QUESTIONS);

  return (
    <div className="space-y-6">
      <section
        className={cn(
          "relative overflow-hidden rounded-3xl border-2 p-6 sm:p-8",
          r.passed ? "border-success/50 bg-success-soft" : "border-danger/40 bg-danger-soft",
        )}
        aria-labelledby="result-title"
      >
        <p className="text-sm text-muted-foreground">
          {exam.title} · {formatDate(exam.submittedAt ?? exam.startedAt, { month: "long", day: "numeric", year: "numeric" })}
        </p>
        <div className="mt-2 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 id="result-title" className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {r.passed ? <CircleCheck className="size-9 text-success" aria-hidden /> : <CircleX className="size-9 text-danger" aria-hidden />}
              {r.passed ? "Passing score" : "Below passing"}
            </h1>
            <p className="mt-2 max-w-xl text-foreground/80">
              {r.passed
                ? "Great work. Keep your edge by reviewing the questions you missed and tightening your weakest domain."
                : "You're building the foundation. Review the misses below, then retry them while the explanations are fresh."}
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-5xl font-semibold tracking-tight">{r.scaledScore}</p>
            <p className="text-sm text-muted-foreground">
              Estimated scaled score · {Math.round(r.percent)}% correct · {r.passingScore} to pass
            </p>
          </div>
        </div>
        <div className="mt-6" aria-hidden>
          <div className="relative h-2.5 rounded-full bg-background/70">
            <div className={cn("h-full rounded-full", r.passed ? "bg-success" : "bg-danger")} style={{ width: `${scalePct}%` }} />
            <div className="absolute -top-1.5 h-5.5 w-0.5 bg-foreground/70" style={{ left: `${passPct}%` }} />
          </div>
          <div className="relative mt-1.5 h-4 text-xs text-muted-foreground">
            <span className="absolute left-0">{EXAM_CONFIG.scaleMin}</span>
            <span className="absolute -translate-x-1/2 font-medium text-foreground" style={{ left: `${passPct}%` }}>
              Pass {r.passingScore}
            </span>
            <span className="absolute right-0">{EXAM_CONFIG.scaleMax}</span>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat icon={CircleCheck} label="Correct" value={r.correct} className="text-success" />
        <Stat icon={CircleX} label="Incorrect" value={r.incorrect} className="text-danger" />
        <Stat icon={CircleMinus} label="Unanswered" value={r.unanswered} />
        <Stat icon={Timer} label="Percentage" value={`${Math.round(r.percent)}%`} />
        <Stat icon={Clock} label="Time used" value={formatDuration(r.timeUsedSeconds)} />
        <Stat icon={Clock} label="Avg / question" value={formatDuration(r.avgSecondsPerQuestion)} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/review?exam=${exam.id}&result=incorrect`}>
            <History /> Review incorrect answers
          </Link>
        </Button>
        {retryIds.length > 0 && (
          <StartQuizButton fields={{ mode: "retry", count: String(retryIds.length), questionIds: retryIds, title: "Retry missed exam questions" }} variant="outline">
            <RotateCcw /> Retry missed questions
          </StartQuizButton>
        )}
        <Button variant="outline" asChild>
          <Link href="/exam">
            <Timer /> Take another exam
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Domain breakdown</CardTitle>
            <CardDescription>How you scored in each SY0-701 domain.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {r.domainBreakdown.map((d) => {
              const domain = getDomain(d.domainId);
              return (
                <div key={d.domainId}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <DomainDot domainId={d.domainId} />
                      <span className="truncate">{domain.name}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {Math.round(d.percent)}% <span className="font-normal text-muted-foreground">({d.correct}/{d.total})</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-primary/10">
                    <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${d.percent}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="size-4 text-muted-foreground" aria-hidden /> Weakest topics
            </CardTitle>
            <CardDescription>Topics where you dropped the most points.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.weakestTopics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No weak topics on this exam. Excellent!</p>
            ) : (
              <ol className="space-y-2.5">
                {r.weakestTopics.map((t, i) => (
                  <li key={t.topicId} className="flex items-center gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{getTopicName(t.topicId)}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {Math.round(t.percent)}% <span className="text-muted-foreground">({t.correct}/{t.total})</span>
                    </span>
                    <StartQuizButton fields={{ mode: "topic", count: "10", topicIds: t.topicId }} variant="ghost" size="sm">
                      Drill
                    </StartQuizButton>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Question overview</CardTitle>
          <CardDescription>Select a question to see its explanation.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-15">
            {r.questions.map((q, i) => (
              <li key={q.questionId}>
                <Link
                  href={`/questions/${q.questionId}`}
                  aria-label={`Question ${i + 1}: ${!q.answered ? "unanswered" : q.isCorrect ? "correct" : "incorrect"}${q.flagged ? ", flagged" : ""}`}
                  className={cn(
                    "relative flex h-10 flex-col items-center justify-center rounded-lg border text-xs font-semibold tabular-nums",
                    q.isCorrect && "border-success/50 bg-success-soft",
                    q.answered && !q.isCorrect && "border-danger/40 bg-danger-soft",
                    !q.answered && "border-dashed text-muted-foreground",
                  )}
                >
                  {i + 1}
                  {q.isCorrect ? (
                    <CircleCheck className="size-3 text-success" aria-hidden />
                  ) : q.answered ? (
                    <CircleX className="size-3 text-danger" aria-hidden />
                  ) : (
                    <CircleMinus className="size-3" aria-hidden />
                  )}
                  {q.flagged && <Flag className="absolute -top-1 -right-1 size-3 fill-warning" aria-hidden />}
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
