import { CalendarDays, Clock, Flame, Gauge, ListChecks, Target, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActivityHeatmap } from "@/components/analytics/activity-heatmap";
import { DifficultyChart, DomainAccuracyChart } from "@/components/analytics/breakdown-charts";
import { MasteryDistribution } from "@/components/analytics/mastery-distribution";
import { TopicTable } from "@/components/analytics/topic-table";
import { TrendsSection } from "@/components/analytics/trends-section";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatTile } from "@/components/common/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { getAnalyticsData } from "@/lib/services/insights-service";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = await requireUser();
  const data = await getAnalyticsData(user, await getRepository());

  if (data.overview.answered === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description="Your performance trends, strengths and weak spots." />
        <EmptyState
          icon={ListChecks}
          title="No data yet"
          description="Answer a few questions and your charts will appear here."
          action={
            <Button asChild>
              <Link href="/study">Start studying</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" description="Your performance trends, strengths and weak spots." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Accuracy" value={formatPercent(data.overview.accuracy)} icon={Target} hint="All-time" />
        <StatTile label="Answered" value={formatNumber(data.overview.answered)} icon={ListChecks} hint={`${data.overview.questionsSeen} unique`} />
        <StatTile label="Study time" value={formatDuration(data.totalStudySeconds)} icon={Clock} hint="Time on questions" />
        <StatTile label="Active days" value={data.activeDays} icon={CalendarDays} hint="Last 90 days" />
        <StatTile label="Streak" value={`${data.streak.current}d`} icon={Flame} hint={`Best ${data.streak.longest}d`} />
        <StatTile label="Readiness" value={`${data.readiness}%`} icon={Gauge} hint="Estimated" />
      </div>

      <TrendsSection timeline={data.timeline} dailyGoal={data.settings.dailyGoal} />

      <div className="grid gap-4 xl:grid-cols-2">
        <DomainAccuracyChart domains={data.domains} />
        <DifficultyChart difficulty={data.difficulty} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Study activity</CardTitle>
            <CardDescription>
              Current streak {data.streak.current} days · longest {data.streak.longest} days · today {data.streak.answeredToday}/{data.settings.dailyGoal}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap days={data.heatmap} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Question mastery</CardTitle>
            <CardDescription>Where every question in the bank sits in your spaced-repetition schedule.</CardDescription>
          </CardHeader>
          <CardContent>
            <MasteryDistribution counts={data.mastery} />
          </CardContent>
        </Card>
      </div>

      {data.examScores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4 text-muted-foreground" aria-hidden /> Practice exam history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-3">
              {data.examScores.map((e) => (
                <li key={e.id}>
                  <Link href={`/exam/${e.id}/results`} className="block rounded-xl border px-4 py-3 hover:bg-accent/50">
                    <span className="block text-xs text-muted-foreground">{formatDate(e.date)}</span>
                    <span className="block text-lg font-semibold tabular-nums">{e.scaledScore}</span>
                    <span className="block text-xs text-muted-foreground">
                      {Math.round(e.percent)}% · {e.passed ? "Pass" : "Below passing"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Topic performance</CardTitle>
          <CardDescription>Sort by any column. Weakest topics first by default.</CardDescription>
        </CardHeader>
        <CardContent>
          <TopicTable rows={data.topics} />
        </CardContent>
      </Card>
    </div>
  );
}
