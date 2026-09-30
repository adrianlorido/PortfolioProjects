"use client";

import { EyeOff, NotebookPen, Pencil } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/field";
import type { CategoryKind } from "@/domain/models";
import type { Money } from "@/modules/finance/money";
import { NOTES_MAX_LENGTH } from "@/modules/transactions/schemas";
import { type UpdateTransactionState, updateTransactionAction } from "./actions";

export interface TransactionRow {
  id: string;
  date: string;
  merchantName: string;
  originalDescription: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** > 0 when the transaction is split across categories (reports use the split lines). */
  splitCount: number;
  amount: Money;
  pending: boolean;
  notes: string | null;
  excludedFromReports: boolean;
}

export interface CategoryOptionGroup {
  groupName: string;
  options: { id: string; name: string; kind: CategoryKind }[];
}

export function TransactionTable({ rows, categoryOptions }: { rows: TransactionRow[]; categoryOptions: CategoryOptionGroup[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = rows.find((r) => r.id === editingId) ?? null;

  if (rows.length === 0) {
    return (
      <Card className="py-16 text-center text-sm text-muted">No transactions match these filters.</Card>
    );
  }

  return (
    <>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Merchant</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Account</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className={row.excludedFromReports ? "bg-surface-2/60" : "hover:bg-surface-2/60"}>
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-secondary">{row.date}</td>
                <td className="max-w-[280px] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{row.merchantName}</span>
                    {row.pending ? <Badge variant="warning">Pending</Badge> : null}
                    {row.excludedFromReports ? (
                      <Badge title="Excluded from reports"><EyeOff className="size-3" aria-hidden />Excluded</Badge>
                    ) : null}
                    {row.notes ? <NotebookPen className="size-3.5 shrink-0 text-muted" aria-label="Has note" /> : null}
                  </div>
                  <div className="truncate text-xs text-muted" title={row.originalDescription}>{row.notes ?? row.originalDescription}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-secondary">{row.accountName}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {row.splitCount > 0 ? (
                    <Badge variant="accent">Split · {row.splitCount} categories</Badge>
                  ) : row.categoryName ? (
                    row.categoryName
                  ) : (
                    <span className="text-muted">Uncategorized</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-medium">
                  <Amount value={row.amount} muted={row.excludedFromReports} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <Button variant="ghost" size="sm" className="px-2" onClick={() => setEditingId(row.id)} aria-label={`Edit ${row.merchantName} on ${row.date}`}>
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing ? (
        <EditTransactionDialog key={editing.id} row={editing} categoryOptions={categoryOptions} onClose={() => setEditingId(null)} />
      ) : null}
    </>
  );
}

const initialState: UpdateTransactionState = { status: "idle", nonce: 0 };

function EditTransactionDialog({ row, categoryOptions, onClose }: { row: TransactionRow; categoryOptions: CategoryOptionGroup[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, isPending] = useActionState(updateTransactionAction, initialState);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="edit-transaction-title"
      className="m-auto w-[min(92vw,460px)] rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/40"
    >
      <form action={formAction} className="p-5">
        <input type="hidden" name="transactionId" value={row.id} />
        <h2 id="edit-transaction-title" className="text-base font-semibold">Edit transaction</h2>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-2 p-3 text-xs">
          <dt className="text-muted">Merchant</dt><dd className="font-medium">{row.merchantName}</dd>
          <dt className="text-muted">Date</dt><dd className="tabular">{row.date}{row.pending ? " · pending" : ""}</dd>
          <dt className="text-muted">Account</dt><dd>{row.accountName}</dd>
          <dt className="text-muted">Amount</dt><dd><Amount value={row.amount} /></dd>
          <dt className="text-muted">Bank description</dt><dd className="break-all font-mono text-[11px]">{row.originalDescription}</dd>
        </dl>
        <p className="mt-1.5 text-[11px] text-muted">Amount, date, account and bank description come from the institution and can’t be edited.</p>

        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="edit-category">Category</Label>
            {row.splitCount > 0 ? (
              <p className="mb-1.5 text-xs text-muted">This transaction is split; reports use its {row.splitCount} split lines, not this category.</p>
            ) : null}
            <Select id="edit-category" name="categoryId" defaultValue={row.categoryId ?? ""}>
              <option value="">Uncategorized</option>
              {categoryOptions.map((g) => (
                <optgroup key={g.groupName} label={g.groupName}>
                  {g.options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.kind === "transfer" ? " (not income/spending)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" name="notes" defaultValue={row.notes ?? ""} maxLength={NOTES_MAX_LENGTH} rows={3} placeholder="Add a note" />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="excludedFromReports" defaultChecked={row.excludedFromReports} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Exclude from reports
              <span className="block text-xs text-muted">Won’t count toward income or spending. Account balances are unaffected.</span>
            </span>
          </label>
        </div>

        {state.status === "error" ? (
          <p role="alert" className="mt-3 text-sm text-negative">{state.message}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </dialog>
  );
}
