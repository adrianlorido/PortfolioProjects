import "server-only";
import type { User } from "@/domain/models";
import { SAMPLE_USER } from "@/db/sample-bootstrap";
import { isSampleMode } from "@/lib/env";

/**
 * Authorization boundary: the current user id is resolved ONLY on the server, from the
 * session, and passed to every repository call. It is never accepted from request input.
 *
 * Phase 1 (sample mode) has a single fixed demo user. Phase 2 replaces this with the
 * Supabase Auth session (cookies via @supabase/ssr); callers don't change.
 */
export async function requireUser(): Promise<User> {
  if (isSampleMode()) return SAMPLE_USER;
  throw new Error("Authentication is not implemented in Phase 1");
}
