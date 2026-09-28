"use client";

import { RotateCcw } from "lucide-react";
import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/common/submit-button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startQuizAction, type StartQuizState } from "@/lib/actions/study";
import type { MissedOrder } from "@/lib/types";

export function MissedQuizForm({ available }: { available: number }) {
  const [state, action] = useActionState<StartQuizState, FormData>(startQuizAction, {});
  const [order, setOrder] = useState<MissedOrder>("random");
  const [count, setCount] = useState("10");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="mode" value="missed" />
      <input type="hidden" name="missedOrder" value={order} />
      <input type="hidden" name="count" value={count} />
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Order</legend>
        <ToggleGroup type="single" value={order} onValueChange={(v) => v && setOrder(v as MissedOrder)} aria-label="Order">
          <ToggleGroupItem value="random" className="h-8 text-xs">
            Random
          </ToggleGroupItem>
          <ToggleGroupItem value="oldest" className="h-8 text-xs">
            Oldest first
          </ToggleGroupItem>
          <ToggleGroupItem value="most" className="h-8 text-xs">
            Most missed
          </ToggleGroupItem>
        </ToggleGroup>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Questions</legend>
        <ToggleGroup type="single" value={count} onValueChange={(v) => v && setCount(v)} aria-label="Questions">
          {["10", "20", "50"].map((n) => (
            <ToggleGroupItem key={n} value={n} className="h-8 text-xs">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </fieldset>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <SubmitButton variant="outline" className="w-full" disabled={available === 0} pendingText="Building…">
        <RotateCcw /> Review missed
      </SubmitButton>
    </form>
  );
}
