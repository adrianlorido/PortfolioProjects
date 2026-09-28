import { CircleCheck, CircleX, Flag, History, Hourglass, Info, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ExamSetupForm } from "@/components/exam/exam-setup-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { EXAM_CONFIG } from "@/lib/config/exam";
import { getRepository } from "@/lib/data";
import { formatDate, formatDuration } from "@/lib/format";
import { getExamOverview } from "@/lib/services/exam-service";

export const metadata: Metadata = { title: "Practice exam" };

const RULES = [
  { icon: Hourglass, text: "The timer runs on the server. When it hits zero, your exam is submitted automatically." },
  { icon: Info, text: "No feedback during the exam. You'll get a full report with explanations after you submit." },
  { icon: Flag, text: "Flag questions to revisit and use the navigator to jump anywhere. Unanswered questions count as incorrect." },
  {
    icon: ShieldCheck,
    text: `Scores are shown on a ${EXAM_CONFIG.scaleMin}–${EXAM_CONFIG.scaleMax} scale with ${EXAM_CONFIG.passingScaledScore} to pass. The scaled score is an estimate; the real exam's scaling isn't public.`,
  },
];

export default async function ExamSetupPage() {
  const user = await requireUser();
  const { bankSize, exams, inProgress } = await getExamOverview(user, await getRepository());

  return (
    <div className="space-y-6">
      <PageHeader title="Practice exam" description={`Simulate the ${EXAM_CONFIG.examCode} exam: mixed domains weighted like the real blueprint, a timer, and no hints.`} />

      {inProgress && (
        <Card className="border-primary/40 bg-accent/40">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">You have an exam in progress</p>
              <p className="text-sm text-muted-foreground">
                {inProgress.title} · started {formatDate(inProgress.startedAt, { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            <Button asChild>
              <Link href={`/exam/${inProgress.id}`}>Resume exam</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Choose your exam</CardTitle>
            <CardDescription>Length and time limits are configured in the exam settings file.</CardDescription>
          </CardHeader>
          <CardContent>
            <ExamSetupForm presets={EXAM_CONFIG.presets} defaultPresetId={EXAM_CONFIG.defaultPresetId} bankSize={bankSize} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exam rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {RULES.map((r) => (
                <li key={r.text} className="flex gap-3 text-sm">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="text-muted-foreground">{r.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exam history</CardTitle>
        </CardHeader>
        <CardContent>
          {exams.length === 0 ? (
            <EmptyState icon={History} title="No exams yet" description="Your practice exam results will appear here." className="py-8" />
          ) : (
            <ul className="divide-y">
              {exams.map((e) => (
                <li key={e.id}>
                  <Link
                    href={e.status === "submitted" ? `/exam/${e.id}/results` : `/exam/${e.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(e.startedAt, { month: "short", day: "numeric", year: "numeric" })} · {e.questionIds.length} questions
                        {e.result ? ` · ${formatDuration(e.result.timeUsedSeconds)}` : ""}
                      </p>
                    </div>
                    {e.result ? (
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums">{e.result.scaledScore}</span>
                          <span className="block text-xs text-muted-foreground">{Math.round(e.result.percent)}%</span>
                        </span>
                        {e.result.passed ? (
                          <Badge variant="success">
                            <CircleCheck aria-hidden /> Pass
                          </Badge>
                        ) : (
                          <Badge variant="danger">
                            <CircleX aria-hidden /> Below
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="soft">In progress</Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
