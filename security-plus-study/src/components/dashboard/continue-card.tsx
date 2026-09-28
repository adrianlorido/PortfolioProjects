import { ArrowRight, CalendarClock, Target, TrendingDown } from "lucide-react";

import { ProgressRing } from "@/components/common/progress-ring";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { getDomain } from "@/lib/config/domains";
import { formatPercent } from "@/lib/format";
import type { Recommendation } from "@/lib/services/insights-service";

export function ContinueCard({
  recommendation,
  dailyGoal,
  answeredToday,
  defaultDifficulty,
}: {
  recommendation: Recommendation;
  dailyGoal: number;
  answeredToday: number;
  defaultDifficulty: string;
}) {
  const goalProgress = Math.min(1, answeredToday / Math.max(1, dailyGoal));
  const goalMet = answeredToday >= dailyGoal;
  const weakest = recommendation.weakestDomainId ? getDomain(recommendation.weakestDomainId) : null;

  return (
    <section
      aria-labelledby="continue-title"
      className="relative overflow-hidden rounded-3xl border bg-card p-5 shadow-sm sm:p-7"
    >
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
      <div aria-hidden className="brand-gradient pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-20 blur-3xl" />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-primary">Today&apos;s study</p>
          <h2 id="continue-title" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Continue studying
          </h2>
          <p className="mt-2 text-muted-foreground">{recommendation.reason}</p>

          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border bg-background/60 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Target className="size-3.5" aria-hidden /> Recommended
              </dt>
              <dd className="mt-0.5 text-lg font-semibold">{recommendation.count} questions</dd>
            </div>
            <div className="rounded-2xl border bg-background/60 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TrendingDown className="size-3.5" aria-hidden /> Weakest domain
              </dt>
              <dd className="mt-0.5 truncate text-lg font-semibold" title={weakest?.name}>
                {weakest ? (
                  <>
                    {weakest.shortName}{" "}
                    <span className="text-sm font-normal text-muted-foreground">{formatPercent(recommendation.weakestDomainAccuracy)}</span>
                  </>
                ) : (
                  <span className="text-base font-normal text-muted-foreground">Not enough data</span>
                )}
              </dd>
            </div>
            <div className="rounded-2xl border bg-background/60 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5" aria-hidden /> Due for review
              </dt>
              <dd className="mt-0.5 text-lg font-semibold">{recommendation.dueCount}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <StartQuizButton
              fields={{
                mode: "daily",
                count: String(recommendation.count),
                difficulties: defaultDifficulty === "any" ? undefined : defaultDifficulty,
              }}
              variant="brand"
              size="lg"
              className="w-full sm:w-auto"
            >
              Start study session <ArrowRight aria-hidden />
            </StartQuizButton>
          </div>
        </div>

        <div className="flex items-center gap-4 self-center md:flex-col md:gap-2 md:text-center">
          <ProgressRing
            value={goalProgress}
            size={132}
            stroke={11}
            label={`Daily goal: ${answeredToday} of ${dailyGoal} questions`}
            indicatorClassName={goalMet ? "stroke-success" : "stroke-primary"}
          >
            <div>
              <p className="text-3xl font-semibold tabular-nums">{answeredToday}</p>
              <p className="text-xs text-muted-foreground">of {dailyGoal}</p>
            </div>
          </ProgressRing>
          <p className="text-sm text-muted-foreground">{goalMet ? "Daily goal complete ✓" : "Daily goal"}</p>
        </div>
      </div>
    </section>
  );
}
