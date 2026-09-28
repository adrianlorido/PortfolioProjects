"use client";

import { CircleAlert, MailCheck } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFormState } from "@/lib/actions/auth";

export interface AuthField {
  name: string;
  label: string;
  type: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  aside?: React.ReactNode;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  pendingLabel,
  hidden,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: AuthField[];
  submitLabel: string;
  pendingLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {state.error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.message && (
        <Alert variant="info">
          <MailCheck />
          <AlertDescription className="text-accent-foreground">{state.message}</AlertDescription>
        </Alert>
      )}
      {fields.map((f) => (
        <div key={f.name} className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={f.name}>{f.label}</Label>
            {f.aside}
          </div>
          <Input
            id={f.name}
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            defaultValue={f.type === "password" ? undefined : state.values?.[f.name]}
            aria-invalid={Boolean(state.error) || undefined}
            aria-describedby={f.hint ? `${f.name}-hint` : undefined}
            required
          />
          {f.hint && (
            <p id={`${f.name}-hint`} className="text-xs text-muted-foreground">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      <SubmitButton className="w-full" size="lg" pendingText={pendingLabel}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
