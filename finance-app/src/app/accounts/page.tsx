import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ACCOUNT_TYPE_LABELS, displayBalance } from "@/modules/accounts/grouping";
import { getFinanceQueriesForCurrentUser } from "@/modules/analytics/server";
import { formatMoney } from "@/modules/finance";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const queries = await getFinanceQueriesForCurrentUser();
  const [groups, netWorth] = await Promise.all([queries.getAccountGroups(), queries.getNetWorth()]);

  return (
    <>
      <PageHeader title="Accounts" description="Balances as reported by each institution. Select an account to see its transactions." />

      <section aria-label="Totals" className="mb-6 grid gap-3 sm:grid-cols-3">
        <Summary label="Assets" value={formatMoney(netWorth.assets)} />
        <Summary label="Liabilities" value={formatMoney(netWorth.liabilities)} />
        <Summary label="Net worth" value={formatMoney(netWorth.netWorth)} emphasis />
      </section>

      <div className="space-y-6">
        {groups.map((group) => (
          <Card key={group.key}>
            <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">
                {group.label}
                <span className="ml-2 text-xs font-normal text-muted">{group.accountClass === "liability" ? "Liability" : "Asset"}</span>
              </h2>
              <span className="tabular text-sm font-semibold">
                {group.accountClass === "liability" ? <span className="mr-1 text-xs font-normal text-muted">owed</span> : null}
                {formatMoney(group.displayTotal)}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {group.accounts.map((account) => (
                <li key={account.id}>
                  <Link href={`/transactions?account=${account.id}`} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{account.name}</span>
                        <Badge>{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {account.institutionName} · ending {account.mask} · updated {account.balanceAsOf.slice(0, 10)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular font-semibold">{formatMoney(displayBalance(account))}</div>
                      <div className="text-xs text-muted">{group.accountClass === "liability" ? "balance owed" : "current balance"}</div>
                    </div>
                    <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        Investment balances are market values from balance snapshots; they are not derived from transactions.
      </p>
    </>
  );
}

function Summary({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={emphasis ? "tabular mt-0.5 text-2xl font-semibold tracking-tight" : "tabular mt-0.5 text-xl font-semibold"}>{value}</div>
    </Card>
  );
}
