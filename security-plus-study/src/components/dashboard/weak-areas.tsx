import { Crosshair } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { formatPercent } from "@/lib/format";
import type { WeakTopicView } from "@/lib/services/insights-service";

export function WeakAreas({ topics }: { topics: WeakTopicView[] }) {
  if (topics.length === 0) {
    return (
      <EmptyState
        icon={Crosshair}
        title="No weak areas yet"
        description="Answer more questions to generate weak-topic recommendations."
        className="py-8"
      />
    );
  }
  return (
    <ol className="space-y-2">
      {topics.map((t, i) => (
        <li key={t.topicId} className="flex items-center gap-3 rounded-xl border bg-background/50 px-3 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-xs font-semibold tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatPercent(t.accuracy)} accuracy · {t.attempts} answers
            </p>
          </div>
          <StartQuizButton
            fields={{ mode: "topic", count: "10", topicIds: t.topicId }}
            variant="outline"
            size="sm"
          >
            Practice
          </StartQuizButton>
        </li>
      ))}
    </ol>
  );
}
