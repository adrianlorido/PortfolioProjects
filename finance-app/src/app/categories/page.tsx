import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CategoryKind } from "@/domain/models";
import { getFinanceQueriesForCurrentUser } from "@/modules/analytics/server";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<CategoryKind, { label: string; variant: "accent" | "neutral" | "warning" }> = {
  income: { label: "Income", variant: "accent" },
  expense: { label: "Spending", variant: "neutral" },
  transfer: { label: "Transfer · excluded from cash flow", variant: "warning" },
};

export default async function CategoriesPage() {
  const queries = await getFinanceQueriesForCurrentUser();
  const [{ groups, categories }, rules] = await Promise.all([queries.getCategories(), queries.getCategoryRules()]);
  const ruleCount = new Map<string, number>();
  for (const r of rules) ruleCount.set(r.categoryId, (ruleCount.get(r.categoryId) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Each category’s type decides how it counts in reports. Transfers (including card and loan payments) move money between your own accounts, so they are never income or spending."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.id}>
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{group.name}</h2>
            <ul className="divide-y divide-border">
              {categories
                .filter((c) => c.groupId === group.id)
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <Link href={`/transactions?category=${c.id}`} className="truncate hover:underline">{c.name}</Link>
                    <span className="flex shrink-0 items-center gap-2">
                      {ruleCount.get(c.id) ? <span className="text-xs text-muted">{ruleCount.get(c.id)} rule{ruleCount.get(c.id) === 1 ? "" : "s"}</span> : null}
                      <Badge variant={KIND_LABEL[c.kind].variant}>{KIND_LABEL[c.kind].label}</Badge>
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        {rules.length} categorization rules match bank descriptions when transactions are first imported. A category you set by hand is never overwritten by rules or re-syncs.
      </p>
    </>
  );
}
