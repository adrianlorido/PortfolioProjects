"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DEMO_SESSION_COOKIE, getCurrentUser } from "@/lib/auth/session";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/supabase/env";

export interface AuthFormState {
  error?: string;
  message?: string;
  /** Non-secret fields echoed back so the form keeps them after React resets it. Never includes passwords. */
  values?: Record<string, string>;
}

function keep(formData: FormData, ...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, String(formData.get(n) ?? "")]));
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters.").max(128, "Password is too long.");

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only allow same-site relative paths to prevent open redirects.
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

async function setDemoCookie(token: string) {
  (await cookies()).set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

async function origin(): Promise<string> {
  const h = await headers();
  return getSiteUrl(h.get("origin") ?? (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : null));
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.") }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = keep(formData, "email");
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const { email, password } = parsed.data;

  if (isSupabaseConfigured()) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message === "Email not confirmed" ? "Please confirm your email address first." : "Incorrect email or password.", values };
  } else {
    const { demoSignIn } = await import("@/lib/data/demo/demo-users");
    const session = demoSignIn(email, password);
    if (!session) return { error: "Incorrect email or password.", values };
    await setDemoCookie(session.token);
  }
  redirect(safeNext(formData.get("next")));
}

export async function demoSignInAction(): Promise<void> {
  if (isSupabaseConfigured()) redirect("/login");
  const { demoSignIn } = await import("@/lib/data/demo/demo-users");
  const { DEMO_ACCOUNT } = await import("@/lib/data/demo/operations");
  const session = demoSignIn(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
  if (session) await setDemoCookie(session.token);
  redirect("/dashboard");
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z
    .object({
      displayName: z.string().trim().min(1, "Enter your name.").max(80, "Name is too long."),
      email: emailSchema,
      password: passwordSchema,
    })
    .safeParse({ displayName: formData.get("displayName"), email: formData.get("email"), password: formData.get("password") });
  const values = keep(formData, "displayName", "email");
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const { displayName, email, password } = parsed.data;

  if (isSupabaseConfigured()) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: `${await origin()}/auth/callback?next=/dashboard` },
    });
    if (error) return { error: error.message, values };
    if (!data.session) return { message: "Check your email to confirm your account, then sign in." };
  } else {
    const { demoSignUp } = await import("@/lib/data/demo/demo-users");
    const result = demoSignUp(email, password, displayName);
    if ("error" in result) return { error: result.error, values };
    await setDemoCookie(result.token);
  }
  redirect("/dashboard?welcome=1");
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } else {
    (await cookies()).delete(DEMO_SESSION_COOKIE);
  }
  redirect("/");
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: keep(formData, "email") };
  if (!isSupabaseConfigured()) {
    return {
      message: "Demo mode doesn't send email. Sign in, then change your password from the reset page, or use the demo account.",
    };
  }
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${await origin()}/auth/callback?next=/reset-password` });
  // Same response whether or not the account exists, to avoid account enumeration.
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z
    .object({ password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await getCurrentUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };

  if (isSupabaseConfigured()) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return { error: error.message };
  } else {
    const { demoSetPassword } = await import("@/lib/data/demo/demo-users");
    demoSetPassword(user.id, parsed.data.password);
  }
  redirect("/dashboard?notice=password-updated");
}
