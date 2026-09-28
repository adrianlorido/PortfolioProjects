import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { SubmitButton } from "@/components/common/submit-button";
import { Separator } from "@/components/ui/separator";
import { demoSignInAction, signInAction } from "@/lib/actions/auth";
import { DEMO_ACCOUNT } from "@/lib/data/demo/operations";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const demo = !isSupabaseConfigured();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Sign in to continue your Security+ prep.</p>
      {params.error === "link-expired" && (
        <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">That link has expired. Request a new one.</p>
      )}

      {demo && (
        <div className="mb-6 rounded-2xl border bg-accent/60 p-4">
          <p className="text-sm font-medium">Demo mode</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Supabase isn&apos;t configured, so accounts are stored locally. Explore with a pre-filled study history:
          </p>
          <form action={demoSignInAction} className="mt-3">
            <SubmitButton variant="brand" className="w-full" pendingText="Opening demo…">
              <Sparkles /> Continue with demo account
            </SubmitButton>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {DEMO_ACCOUNT.email} · {DEMO_ACCOUNT.password}
          </p>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" /> or sign in <Separator className="flex-1" />
          </div>
        </div>
      )}

      <AuthForm
        action={signInAction}
        hidden={{ next }}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", placeholder: "you@example.com" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
            aside: (
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            ),
          },
        ]}
      />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Bastion?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
