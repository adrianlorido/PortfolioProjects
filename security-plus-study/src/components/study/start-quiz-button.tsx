"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { useEffect } from "react";

import { SubmitButton } from "@/components/common/submit-button";
import { startQuizAction, type StartQuizState } from "@/lib/actions/study";
import type { Button } from "@/components/ui/button";

/**
 * A one-click button that starts a study session with preset fields.
 * Array values become repeated form fields (e.g. topicIds=a&topicIds=b).
 */
export function StartQuizButton({
  fields,
  children,
  className,
  variant,
  size,
}: {
  fields: Record<string, string | string[] | undefined>;
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [state, action] = useActionState<StartQuizState, FormData>(startQuizAction, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} className="contents">
      {Object.entries(fields).flatMap(([name, value]) =>
        value === undefined
          ? []
          : (Array.isArray(value) ? value : [value]).map((v, i) => <input key={`${name}-${i}`} type="hidden" name={name} value={v} />),
      )}
      <SubmitButton className={className} variant={variant} size={size} pendingText="Building session…">
        {children}
      </SubmitButton>
    </form>
  );
}
