import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { AppUser } from "@/lib/types";

export const DEMO_SESSION_COOKIE = "bastion_demo_session";

/**
 * The verified current user, or null. Identity always comes from a verified
 * token (Supabase JWT claims or the signed demo cookie), never from input.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  if (isSupabaseConfigured()) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, display_name, role")
      .eq("id", claims.sub)
      .maybeSingle();
    const email = (profile?.email as string | undefined) || (claims.email as string | undefined) || "";
    return {
      id: claims.sub,
      email,
      displayName: (profile?.display_name as string | undefined) || email.split("@")[0] || "Learner",
      role: profile?.role === "admin" ? "admin" : "student",
    };
  }
  const { demoUserFromToken } = await import("@/lib/data/demo/demo-users");
  const token = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  return demoUserFromToken(token);
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  // A stale or invalid session cookie is cleared by /auth/expired before returning to /login.
  if (!user) redirect("/auth/expired");
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard?notice=admin-only");
  return user;
}

export class AuthError extends Error {
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "AuthError";
  }
}

/** For server actions: throws instead of redirecting. */
export async function assertUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export async function assertAdmin(): Promise<AppUser> {
  const user = await assertUser();
  if (user.role !== "admin") throw new AuthError("Admin access required.");
  return user;
}
