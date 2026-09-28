import { getDomain } from "@/lib/config/domains";
import type { DomainId } from "@/lib/types";
import { cn } from "@/lib/utils";

export const DOMAIN_COLOR_VAR: Record<DomainId, string> = {
  1: "var(--chart-1)",
  2: "var(--chart-2)",
  3: "var(--chart-3)",
  4: "var(--chart-4)",
  5: "var(--chart-5)",
};

export function DomainDot({ domainId, className }: { domainId: DomainId; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: DOMAIN_COLOR_VAR[domainId] }}
    />
  );
}

export function DomainBadge({ domainId, short = true, className }: { domainId: DomainId; short?: boolean; className?: string }) {
  const domain = getDomain(domainId);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
      title={`Domain ${domain.code} ${domain.name}`}
    >
      <DomainDot domainId={domainId} />
      <span className="text-foreground/80">{domain.code}</span>
      <span className="truncate">{short ? domain.shortName : domain.name}</span>
    </span>
  );
}
