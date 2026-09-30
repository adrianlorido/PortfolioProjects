"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/field";
import { formatMonthLabel } from "@/modules/finance/period";

export function MonthPicker({ months, value }: { months: string[]; value: string }) {
  const router = useRouter();
  return (
    <div className="w-52">
      <label htmlFor="month-picker" className="sr-only">Month</label>
      <Select id="month-picker" value={value} onChange={(e) => router.push(`/?month=${encodeURIComponent(e.target.value)}`)}>
        {[...months].reverse().map((m) => (
          <option key={m} value={m}>{formatMonthLabel(m)}</option>
        ))}
      </Select>
    </div>
  );
}
