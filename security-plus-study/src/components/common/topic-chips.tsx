import Link from "next/link";

import { getTopicName } from "@/lib/config/topics";
import { cn } from "@/lib/utils";

export function TopicChips({ topics, linked = false, className, max }: { topics: string[]; linked?: boolean; className?: string; max?: number }) {
  const shown = max ? topics.slice(0, max) : topics;
  const hidden = topics.length - shown.length;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Topics">
      {shown.map((t) => (
        <li key={t}>
          {linked ? (
            <Link
              href={`/search?topic=${t}`}
              className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground transition-colors hover:bg-accent"
            >
              {getTopicName(t)}
            </Link>
          ) : (
            <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">{getTopicName(t)}</span>
          )}
        </li>
      ))}
      {hidden > 0 && <li className="text-xs text-muted-foreground">+{hidden}</li>}
    </ul>
  );
}
