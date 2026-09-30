import type { ReactNode } from "react";

export function TooltipCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-text">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({ swatch, label, value }: { swatch?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-secondary">
        {swatch ? <span aria-hidden className="size-2 rounded-sm" style={{ background: swatch }} /> : null}
        {label}
      </span>
      <span className="tabular font-medium text-text">{value}</span>
    </div>
  );
}
