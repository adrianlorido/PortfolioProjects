import { Bookmark, CalendarClock, ChevronRight, Crosshair, RotateCcw, Timer, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DomainDot } from "@/components/common/domain-badge";
import { PageHeader } from "@/components/common/page-header";
import { MissedQuizForm } from "@/components/study/missed-quiz-form";
import { QuickQuizForm } from "@/components/study/quick-quiz-form";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getDomain } from "@/lib/config/domains";
import { getExamPreset, EXAM_CONFIG } from "@/lib/config/exam";
import { getRepository } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { getStudyHubData } from "@/lib/services/insights-service";

export const metadata: Metadata = { title: "Study" };

function ModeCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Zap;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="mb-2 grid size-10 place-items-center rounded-xl bg-accent text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">{children}</CardContent>
    </Card>
  );
}

export default async function StudyPage() {
  const user = await requireUser();
  const data = await getStudyHubData(user, await getRepository());
  const fullExam = getExamPreset(EXAM_CONFIG.defaultPresetId);

  return (
    <div className="space-y-6">
      <PageHeader title="Study" description="Pick a mode, or build a custom quiz. Every answer updates your mastery and review schedule." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="size-5 text-primary" aria-hidden /> Quick quiz
          </CardTitle>
          <CardDescription>Randomized questions from the sources you choose.</CardDescription>
        </CardHeader>
        <CardContent>
          <QuickQuizForm
            defaultSize={data.settings.defaultQuizSize}
            defaultDifficulty={data.settings.defaultDifficulty}
            topics={data.topics}
            counts={{
              weak: data.weakTopics.length,
              unanswered: data.unansweredCount,
              missed: data.missedCount,
              bookmarked: data.bookmarkCount,
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ModeCard icon={Crosshair} title="Domain practice" description="Focus on one SY0-701 domain at a time.">
          <ul className="-mx-2">
            {data.domains.map((d) => {
              const domain = getDomain(d.domainId);
              return (
                <li key={d.domainId}>
                  <Link
                    href={`/study/domains/${domain.slug}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-accent/60"
                  >
                    <DomainDot domainId={d.domainId} />
                    <span className="min-w-0 flex-1 truncate">{domain.name}</span>
                    <span className="text-muted-foreground tabular-nums">{formatPercent(d.accuracy)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </ModeCard>

        <ModeCard
          icon={Crosshair}
          title="Weakest topics"
          description="Auto-built from your lowest-accuracy topics, repeated misses and questions you haven't seen lately."
        >
          {data.weakTopics.length ? (
            <>
              <ul className="mb-4 space-y-1.5 text-sm">
                {data.weakTopics.map((t) => (
                  <li key={t.topicId} className="flex justify-between gap-2">
                    <span className="truncate">{t.name}</span>
                    <span className="text-muted-foreground tabular-nums">{formatPercent(t.accuracy)}</span>
                  </li>
                ))}
              </ul>
              <StartQuizButton fields={{ mode: "weak", count: "20" }} className="w-full">
                Start weak-area quiz
              </StartQuizButton>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Answer more questions to generate weak-topic recommendations.</p>
          )}
        </ModeCard>

        <ModeCard icon={RotateCcw} title="Missed questions" description={`${data.missedCount} question${data.missedCount === 1 ? "" : "s"} still need work. Mastered ones step aside automatically.`}>
          {data.missedCount ? <MissedQuizForm available={data.missedCount} /> : <p className="text-sm text-muted-foreground">No missed questions yet.</p>}
        </ModeCard>

        <ModeCard icon={CalendarClock} title="Spaced review" description="Questions whose review date has arrived, most overdue first.">
          <p className="mb-4 text-3xl font-semibold">
            {data.dueCount} <span className="text-sm font-normal text-muted-foreground">due now</span>
          </p>
          {data.dueCount ? (
            <StartQuizButton fields={{ mode: "review", count: String(Math.min(30, data.dueCount)) }} variant="outline" className="w-full">
              Review {Math.min(30, data.dueCount)} due
            </StartQuizButton>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is due right now. Nice work!</p>
          )}
        </ModeCard>

        <ModeCard icon={Bookmark} title="Bookmarked questions" description="Questions you starred as tricky or worth revisiting.">
          <p className="mb-4 text-3xl font-semibold">
            {data.bookmarkCount} <span className="text-sm font-normal text-muted-foreground">saved</span>
          </p>
          <div className="flex gap-2">
            {data.bookmarkCount > 0 && (
              <StartQuizButton fields={{ mode: "bookmarked", count: String(Math.min(50, data.bookmarkCount)) }} variant="outline" className="flex-1">
                Quiz bookmarks
              </StartQuizButton>
            )}
            <Button variant="ghost" asChild className="flex-1">
              <Link href="/bookmarks">View list</Link>
            </Button>
          </div>
        </ModeCard>

        <ModeCard icon={Timer} title="Exam simulator" description={`${fullExam.questionCount} questions in ${fullExam.timeLimitMinutes} minutes, no feedback until you submit.`}>
          <Button asChild className="w-full">
            <Link href="/exam">Set up practice exam</Link>
          </Button>
        </ModeCard>
      </div>
    </div>
  );
}
