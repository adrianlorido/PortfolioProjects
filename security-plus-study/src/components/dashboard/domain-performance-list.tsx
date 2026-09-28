import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { DomainDot } from "@/components/common/domain-badge";
import { Progress } from "@/components/ui/progress";
import type { DomainPerformance } from "@/lib/analytics/stats";
import { getDomain } from "@/lib/config/domains";
import { formatPercent } from "@/lib/format";

export function DomainPerformanceList({ domains }: { domains: DomainPerformance[] }) {
  return (
    <ul className="divide-y">
      {domains.map((d) => {
        const domain = getDomain(d.domainId);
        const coverage = d.totalQuestions ? (d.attempted / d.totalQuestions) * 100 : 0;
        return (
          <li key={d.domainId}>
            <Link
              href={`/study/domains/${domain.slug}`}
              className="group -mx-2 flex items-center gap-4 rounded-xl px-2 py-3.5 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 font-medium">
                    <DomainDot domainId={d.domainId} />
                    <span className="text-muted-foreground tabular-nums">{domain.code}</span>
                    <span className="truncate">{domain.name}</span>
                  </p>
                  <p className="shrink-0 text-lg font-semibold tabular-nums">{formatPercent(d.accuracy)}</p>
                </div>
                <Progress value={coverage} className="mt-2 h-1.5" aria-label={`${domain.name} coverage ${Math.round(coverage)}%`} />
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {d.attempted} / {d.totalQuestions} questions attempted
                  </span>
                  <span>Mastery: {d.masteryLabel}</span>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
