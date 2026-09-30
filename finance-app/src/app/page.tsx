import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { MonthPicker } from "@/components/month-picker";
import { PageHeader } from "@/components/layout/page-header";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { displayBalance } from "@/modules/accounts/grouping";
import { getFinanceQueriesForCurrentUser } from "@/modules/analytics/server";
import { getDashboard } from "@/modules/dashboard/get-dashboard";
import { type Money, formatBasisPoints, formatMoney, formatMonthLabel, monthPeriod, subtract, sum } from "@/modules/finance";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = typeof params.month === "string" ? params.month : undefined;
  const d = await getDashboard(await getFinanceQueriesForCurrentUser(), requested);
  const monthLabel = d.month ? formatMonthLabel(d.month) : "—";
  const cf = d.cashFlow;
  const prev = d.previousCashFlow;
  const otherTotal = sum(d.otherCategories.map((c) => c.amount));
  const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  // A month-to-date figure compared against a full month must say so.
  const vsCaption = prev ? `vs ${formatMonthLabel(prev.month, "short").split(" ")[0]}${d.isPartialMonth ? " (full month)" : ""}` : "";
  const maxCategory = Math.max(1, ...d.topCategories.map((c) => c.amount), otherTotal);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Cash flow for <span className="font-medium text-secondary">{monthLabel}</span>
            {d.isPartialMonth ? ` (month to date, through ${d.latestDate})` : ""}. Pending transactions are not counted.
          </>
        }
        actions={d.month ? <MonthPicker months={d.months} value={d.month} /> : null}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Net worth"
          value={formatMoney(d.netWorth.netWorth)}
          className="col-span-2 lg:col-span-1"
          delta={d.netWorthChange ? { amount: d.netWorthChange.amount, caption: `since ${shortDate(d.netWorthChange.since)}`, goodWhenUp: true } : undefined}
        />
        <StatTile label="Income" value={cf ? formatMoney(cf.income) : "—"} delta={cf && prev ? { amount: subtract(cf.income, prev.income), caption: vsCaption, goodWhenUp: true } : undefined} />
        <StatTile label="Spending" value={cf ? formatMoney(cf.spending) : "—"} delta={cf && prev ? { amount: subtract(cf.spending, prev.spending), caption: vsCaption, goodWhenUp: false } : undefined} />
        <StatTile label="Savings" value={cf ? formatMoney(cf.savings) : "—"} delta={cf && prev ? { amount: subtract(cf.savings, prev.savings), caption: vsCaption, goodWhenUp: true } : undefined} />
        <StatTile label="Savings rate" value={cf ? formatBasisPoints(cf.savingsRate) : "—"} footnote="Savings ÷ income" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Net worth"
            description={`Assets ${formatMoney(d.netWorth.assets)} · Liabilities ${formatMoney(d.netWorth.liabilities)}`}
          />
          <CardBody>
            <NetWorthChart points={d.history} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Accounts" action={<Link href="/accounts" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
          <CardBody className="space-y-4">
            {d.accountGroups.map((group) => (
              <div key={group.key}>
                <div className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-muted">
                  <span>{group.label}</span>
                  <span className="tabular">{group.accountClass === "liability" ? "owed " : ""}{formatMoney(group.displayTotal)}</span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {group.accounts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/transactions?account=${a.id}`} className="-mx-2 flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-surface-2">
                        <span className="truncate">{a.name} <span className="text-muted">··{a.mask}</span></span>
                        <span className="tabular">{formatMoney(displayBalance(a))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Cash flow" description="Income vs. spending by month. Transfers, card and loan payments excluded." />
          <CardBody>
            <CashFlowChart series={d.cashFlowSeries} selectedMonth={d.month} />
            <table className="mt-4 w-full text-xs">
              <caption className="sr-only">Monthly cash flow</caption>
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 font-medium">Month</th>
                  <th scope="col" className="py-1 text-right font-medium">Income</th>
                  <th scope="col" className="py-1 text-right font-medium">Spending</th>
                  <th scope="col" className="py-1 text-right font-medium">Savings</th>
                  <th scope="col" className="py-1 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...d.cashFlowSeries].reverse().map((m) => (
                  <tr key={m.month} className={cn("border-t border-border", m.month === d.month && "font-semibold")}>
                    <th scope="row" className="py-1.5 text-left font-[inherit]">
                      <Link href={`/?month=${m.month}`} className="hover:underline">{formatMonthLabel(m.month, "short")}</Link>
                    </th>
                    <td className="py-1.5 text-right">{formatMoney(m.income)}</td>
                    <td className="py-1.5 text-right">{formatMoney(m.spending)}</td>
                    <td className={cn("py-1.5 text-right", m.savings < 0 && "text-negative")}>{formatMoney(m.savings)}</td>
                    <td className="py-1.5 text-right">{formatBasisPoints(m.savingsRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Spending by category" description={`${monthLabel}${d.isPartialMonth ? " to date" : ""} · net of refunds`} />
          <CardBody>
            {d.topCategories.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No spending this month.</p>
            ) : (
              <ul className="space-y-2.5">
                {d.topCategories.map((c) => (
                  <CategoryBar key={c.categoryId ?? "uncategorized"} name={c.categoryName} group={c.groupName} amount={c.amount} share={formatBasisPoints(c.share)} max={maxCategory}
                    href={d.month ? `/transactions?category=${c.categoryId ?? "uncategorized"}&from=${monthPeriod(d.month).start}&to=${monthPeriod(d.month).end}` : undefined} />
                ))}
                {d.otherCategories.length > 0 ? (
                  <CategoryBar name={`${d.otherCategories.length} other categories`} group="" amount={otherTotal} share="" max={maxCategory} muted />
                ) : null}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent transactions" action={<Link href="/transactions" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
        <CardBody className="pt-2">
          <ul className="divide-y divide-border">
            {d.recentTransactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.merchantName}</span>
                    {t.pending ? <Badge variant="warning">Pending</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted">{t.date} · {t.accountName} · {t.categoryName ?? "Uncategorized"}</div>
                </div>
                <Amount value={t.amount} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}

function StatTile({ label, value, delta, footnote, className }: { label: string; value: string; delta?: { amount: Money; caption: string; goodWhenUp: boolean }; footnote?: string; className?: string }) {
  const up = delta ? delta.amount > 0 : false;
  const good = delta ? (delta.amount === 0 ? null : up === delta.goodWhenUp) : null;
  return (
    <Card className={cn("px-4 py-4", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold tracking-tight md:text-2xl">{value}</div>
      {delta ? (
        <div className="mt-1 text-xs">
          <div className={cn("flex items-center gap-1", good === null ? "text-muted" : good ? "text-positive" : "text-negative")}>
            {delta.amount > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : delta.amount < 0 ? <ArrowDownRight className="size-3.5" aria-hidden /> : null}
            <span className="tabular">{formatMoney(delta.amount, { showPlus: true })}</span>
          </div>
          <div className="text-muted">{delta.caption}</div>
        </div>
      ) : footnote ? (
        <div className="mt-1 text-xs text-muted">{footnote}<br />&nbsp;</div>
      ) : null}
    </Card>
  );
}

function CategoryBar({ name, group, amount, share, max, href, muted = false }: { name: string; group: string; amount: Money; share: string; max: number; href?: string; muted?: boolean }) {
  const width = amount > 0 ? Math.max(1.5, (amount / max) * 100) : 0;
  const content = (
    <>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">
          {name}
          {group ? <span className="ml-1.5 text-xs text-muted">{group}</span> : null}
        </span>
        <span className="tabular shrink-0">
          {formatMoney(amount)}
          {share ? <span className="ml-2 inline-block w-12 text-right text-xs text-muted">{share}</span> : null}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-surface-2">
        <div className={cn("h-1.5 rounded-full", muted ? "bg-muted" : "bg-series-1")} style={{ width: `${width}%` }} />
      </div>
    </>
  );
  return <li>{href ? <Link href={href} className="-mx-2 block rounded-md px-2 py-1 hover:bg-surface-2">{content}</Link> : <div className="py-1">{content}</div>}</li>;
}
