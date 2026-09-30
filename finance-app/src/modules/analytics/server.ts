import "server-only";
import { getRepository } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { createFinanceQueries } from "./finance-queries";

/** Finance queries bound to the authenticated user. The user id never comes from the request. */
export async function getFinanceQueriesForCurrentUser() {
  const [user, repo] = await Promise.all([requireUser(), getRepository()]);
  return createFinanceQueries(repo, user.id);
}
