import { ArrowLeft, CalendarClock, Crosshair, Gauge, ListChecks, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DomainDot } from "@/components/common/domain-badge";
import { PageHeader } from "@/components/common/page-header";
import { StatTile } from "@/components/common/stat-tile";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireUser } from "@/lib/auth/session";
import { getDomainBySlug } from "@/lib/config/domains";
import { DOMAIN_PRACTICE_SIZES, MASTERY_LABELS, MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getRepository } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { getDomainDetail } from "@/lib/services/insights-service";
import type { MasteryLevel } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/study/domains/[slug]">): Promise<Metadata> {
  const domain = getDomainBySlug((await params).slug);
  return { title: domain ? domain.name : "Domain" };
}

export default async function DomainPage({ params }: PageProps<"/study/domains/[slug]">) {
  const domain = getDomainBySlug((await params).slug);
  if (!domain) notFound();
  const user = await requireUser();
  const detail = await getDomainDetail(user, await getRepository(), domain.id);
  const p = detail.performance;
  const allCount = Math.min(MAX_SESSION_QUESTIONS, p.totalQuestions);
  const weakest = detail.topics.filter((t) => t.accuracy !== null).slice(0, 3);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/study">
          <ArrowLeft /> Study modes
        </Link>
      </Button>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <DomainDot domainId={domain.id} /> Domain {domain.code} · {domain.weight}% of the exam
          </span>
        }
        title={domain.name}
        description={domain.description}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Accuracy" value={formatPercent(p.accuracy)} icon={Target} hint={`${p.correct} of ${p.answers} answers`} />
        <StatTile label="Mastery" value={p.masteryLabel} icon={Gauge} hint={`${Math.round(p.mastery * 100)}% of max`} />
        <StatTile label="Attempted" value={`${p.attempted}/${p.totalQuestions}`} icon={ListChecks} hint="Unique questions" />
        <StatTile label="Due for review" value={p.due} icon={CalendarClock} hint="In this domain" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start domain practice</CardTitle>
          <CardDescription>Questions are drawn only from {domain.shortName}, favoring due and unseen items.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {DOMAIN_PRACTICE_SIZES.filter((n) => n < p.totalQuestions).map((n) => (
            <StartQuizButton key={n} fields={{ mode: "domain", count: String(n), domainIds: String(domain.id) }} variant="outline" size="lg">
              {n} questions
            </StartQuizButton>
          ))}
          <StartQuizButton fields={{ mode: "domain", count: String(allCount), domainIds: String(domain.id) }} size="lg">
            All {allCount} questions
          </StartQuizButton>
          <StartQuizButton
            fields={{ mode: "domain", count: "20", domainIds: String(domain.id), hardMode: "true", title: `${domain.shortName} · Hard mode` }}
            variant="ghost"
            size="lg"
          >
            Hard mode
          </StartQuizButton>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Topics in this domain</CardTitle>
            <CardDescription>Weakest first. Start a focused quiz on any topic.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {detail.topics.map((t) => (
                <li key={t.topicId} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{t.name}</span>
                      <span className="shrink-0 tabular-nums">{formatPercent(t.accuracy)}</span>
                    </div>
                    <Progress value={(t.attempted / t.questions) * 100} className="mt-2 h-1.5" aria-label={`${t.name} coverage`} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.attempted}/{t.questions} attempted
                    </p>
                  </div>
                  <StartQuizButton fields={{ mode: "topic", count: "10", topicIds: t.topicId }} variant="outline" size="sm">
                    Practice
                  </StartQuizButton>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crosshair className="size-4 text-muted-foreground" aria-hidden /> Weakest topics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {weakest.length ? (
                <ol className="space-y-2 text-sm">
                  {weakest.map((t, i) => (
                    <li key={t.topicId} className="flex justify-between gap-2">
                      <span>
                        {i + 1}. {t.name}
                      </span>
                      <span className="font-medium tabular-nums">{formatPercent(t.accuracy)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Answer questions in this domain to see weak topics.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Accuracy by difficulty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.difficulty.map((d) => (
                <div key={d.difficulty}>
                  <div className="mb-1 flex justify-between text-sm capitalize">
                    <span>{d.difficulty}</span>
                    <span className="tabular-nums">
                      {formatPercent(d.accuracy)} <span className="text-muted-foreground">({d.answers})</span>
                    </span>
                  </div>
                  <Progress value={(d.accuracy ?? 0) * 100} className="h-1.5" aria-label={`${d.difficulty} accuracy`} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Question mastery</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {([4, 3, 2, 1, 0] as MasteryLevel[]).map((level) => (
                  <li key={level} className="flex justify-between">
                    <span>{MASTERY_LABELS[level]}</span>
                    <span className="font-medium tabular-nums">{detail.masteryCounts[level]}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
