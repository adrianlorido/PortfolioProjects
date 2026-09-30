import type { Money } from "@/modules/finance/money";
import { formatMoney } from "@/modules/finance/money";
import { cn } from "@/lib/utils";

/**
 * Signed transaction amount. Inflows are green with a "+", outflows use normal ink with "−",
 * so meaning never relies on color alone.
 */
export function Amount({ value, className, muted = false }: { value: Money; className?: string; muted?: boolean }) {
  return (
    <span className={cn("tabular whitespace-nowrap", value > 0 && !muted && "text-positive", muted && "text-muted", className)}>
      {formatMoney(value, { showPlus: true })}
    </span>
  );
}
