import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { ACCOUNT_TYPE_LABELS, displayBalance } from "@/modules/accounts/grouping";
import { getFinanceQueriesForCurrentUser } from "@/modules/analytics/server";
import { formatMoney } from "@/modules/finance";
import { UNCATEGORIZED } from "@/modules/transactions/filters";
import { TRANSACTIONS_PAGE_SIZE, paginate } from "@/modules/transactions/pagination";
import { parseTransactionFilters } from "@/modules/transactions/schemas";
import { TransactionTable, type CategoryOptionGroup } from "./transaction-table";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = parseTransactionFilters(params);
  const queries = await getFinanceQueriesForCurrentUser();
  const [transactions, accounts, { groups, categories }] = await Promise.all([
    queries.getTransactions(filters),
    queries.getAccounts(),
    queries.getCategories(),
  ]);

  const selectedAccount = filters.accountId ? accounts.find((a) => a.id === filters.accountId) : undefined;
  const categoryOptions: CategoryOptionGroup[] = groups.map((g) => ({
    groupName: g.name,
    options: categories.filter((c) => c.groupId === g.id).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  }));
  const hasFilters = Object.values(filters).some((v) => v !== undefined);
  const page = paginate(transactions, params.page);
  const pageHref = (n: number) => {
    const query = new URLSearchParams();
    if (filters.search) query.set("q", filters.search);
    if (filters.accountId) query.set("account", filters.accountId);
    if (filters.categoryId) query.set("category", filters.categoryId);
    if (filters.startDate) query.set("from", filters.startDate);
    if (filters.endDate) query.set("to", filters.endDate);
    if (n > 1) query.set("page", String(n));
    const qs = query.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  };

  return (
    <>
      <PageHeader
        title={selectedAccount ? selectedAccount.name : "Transactions"}
        description={
          selectedAccount ? (
            <>
              {ACCOUNT_TYPE_LABELS[selectedAccount.type]} · {selectedAccount.institutionName} ·{" "}
              {selectedAccount.accountClass === "liability" ? "balance owed" : "current balance"}{" "}
              <span className="tabular font-medium text-secondary">{formatMoney(displayBalance(selectedAccount))}</span>
            </>
          ) : (
            "Search, filter and annotate. Amounts: + money in, − money out."
          )
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[1.6fr_1.4fr_1.4fr_1fr_1fr_auto]" role="search">
          <div>
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" type="search" placeholder="Merchant, description or note" defaultValue={filters.search ?? ""} maxLength={100} />
          </div>
          <div>
            <Label htmlFor="account">Account</Label>
            <Select id="account" name="account" defaultValue={filters.accountId ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ··{a.mask}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Select id="category" name="category" defaultValue={filters.categoryId ?? ""}>
              <option value="">All categories</option>
              <option value={UNCATEGORIZED}>Uncategorized</option>
              {categoryOptions.map((g) => (
                <optgroup key={g.groupName} label={g.groupName}>
                  {g.options.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={filters.startDate ?? ""} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={filters.endDate ?? ""} />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className={buttonVariants({ variant: "primary" })}>Apply</button>
            {hasFilters ? (
              <Link href="/transactions" className={buttonVariants({ variant: "ghost" })} aria-label="Clear filters">
                <X className="size-4" aria-hidden /> Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      <p className="mb-2 text-xs text-muted" aria-live="polite">
        {page.total} transaction{page.total === 1 ? "" : "s"}
        {page.pageCount > 1 ? ` · showing ${(page.page - 1) * TRANSACTIONS_PAGE_SIZE + 1}–${(page.page - 1) * TRANSACTIONS_PAGE_SIZE + page.items.length}` : ""}
      </p>
      <TransactionTable
        rows={page.items.map((t) => ({
          id: t.id,
          date: t.date,
          merchantName: t.merchantName,
          originalDescription: t.originalDescription,
          accountName: t.accountName,
          categoryId: t.categoryId,
          categoryName: t.categoryName,
          splitCount: t.splits.length,
          amount: t.amount,
          pending: t.pending,
          notes: t.notes,
          excludedFromReports: t.excludedFromReports,
        }))}
        categoryOptions={categoryOptions}
      />
      {page.pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          {page.page > 1 ? <Link href={pageHref(page.page - 1)} className={buttonVariants({ size: "sm" })}>← Newer</Link> : <span />}
          <span className="text-muted">Page {page.page} of {page.pageCount}</span>
          {page.page < page.pageCount ? <Link href={pageHref(page.page + 1)} className={buttonVariants({ size: "sm" })}>Older →</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
