import { Award, CalendarClock, ChartColumn, Flame, Gauge, Info, ListChecks, Target, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatTile } from "@/components/common/stat-tile";
import { ContinueCard } from "@/components/dashboard/continue-card";
import { DomainPerformanceList } from "@/components/dashboard/domain-performance-list";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { WeakAreas } from "@/components/dashboard/weak-areas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { firstName, formatNumber, formatPercent, greeting } from "@/lib/format";
import { getDashboardData } from "@/lib/services/insights-service";

export const metadata: Metadata = { title: "Dashboard" };

const NOTICES: Record<string, { title: string; body: string }> = {
  "admin-only": { title: "Admins only", body: "The question bank is only available to admin accounts." },
  "password-updated": { title: "Password updated", body: "Your new password is active." },
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const user = await requireUser();
  const data = await getDashboardData(user, await getRepository());
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const isNew = data.overview.answered === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting(new Date(), data.settings.timezone)},</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{firstName(user.displayName)}</h1>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="At a glance">
          <li className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm">
            <Flame className={data.streak.current > 0 ? "size-4 text-orange-500" : "size-4 text-muted-foreground"} aria-hidden />
            <span className="font-semibold">{data.streak.current}</span> day streak
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm">
            <ListChecks className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{formatNumber(data.overview.answered)}</span> answered
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm">
            <Target className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{formatPercent(data.overview.accuracy)}</span> accuracy
          </li>
        </ul>
      </header>

      {params.welcome && (
        <Alert variant="info">
          <Info />
          <AlertTitle>Welcome to Bastion</AlertTitle>
          <AlertDescription>
            Start with a mixed study session so we can learn your strengths. Weak-area detection and spaced review kick in as you answer.
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <Info />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.body}</AlertDescription>
        </Alert>
      )}

      <ContinueCard
        recommendation={data.recommendation}
        dailyGoal={data.settings.dailyGoal}
        answeredToday={data.streak.answeredToday}
        defaultDifficulty={data.settings.defaultDifficulty}
      />

      <section aria-labelledby="overview-title">
        <h2 id="overview-title" className="sr-only">
          Performance overview
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Overall accuracy" value={formatPercent(data.overview.accuracy)} icon={Target} hint={isNew ? "No answers yet" : "All-time"} />
          <StatTile label="Questions answered" value={formatNumber(data.overview.answered)} icon={ListChecks} hint={`${data.overview.questionsSeen} unique of ${data.bankTotal}`} />
          <StatTile label="Mastered" value={formatNumber(data.overview.mastered)} icon={Award} hint="Long-term retention" />
          <StatTile label="Needs review" value={formatNumber(data.overview.needsReview)} icon={CalendarClock} hint="Due now" />
          <StatTile label="Current streak" value={`${data.streak.current}d`} icon={Flame} hint={data.streak.studiedToday ? "Studied today" : "Study today to extend"} />
          <StatTile label="Best streak" value={`${data.streak.longest}d`} icon={Trophy} hint="Personal record" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Domain performance</CardTitle>
            <CardDescription>Accuracy, coverage and mastery for each SY0-701 domain.</CardDescription>
            <CardAction>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground" title="Estimated from accuracy and coverage, weighted by the exam blueprint">
                <Gauge className="size-3.5" aria-hidden /> Readiness {data.readiness}%
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <DomainPerformanceList domains={data.domains} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weak areas</CardTitle>
            <CardDescription>Your lowest-scoring topics. Tap one for a focused quiz.</CardDescription>
          </CardHeader>
          <CardContent>
            <WeakAreas topics={data.weakTopics} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Your latest study sessions and practice exams.</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/analytics">
                <ChartColumn /> View analytics
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <RecentActivity items={data.recent} />
        </CardContent>
      </Card>
    </div>
  );
}
