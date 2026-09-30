import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  neutral: "bg-surface-2 text-secondary border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  warning: "bg-warning-bg text-warning-text border-warning-border",
} as const;

export function Badge({ variant = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", variants[variant], className)}
      {...props}
    />
  );
}
