import "server-only";

import { z } from "zod";

import { AuthError } from "@/lib/auth/session";
import { RepositoryError } from "@/lib/data/repository";
import { UserFacingError } from "@/lib/services/errors";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Runs an action body and converts known failures into messages safe for the UI. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export function toMessage(error: unknown): string {
  if (error instanceof UserFacingError || error instanceof AuthError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Invalid input.";
  if (error instanceof RepositoryError) {
    if (error.code === "forbidden") return "You don't have permission to do that.";
    if (error.code === "not_found") return "That item could not be found.";
    if (error.code === "conflict") return "That change conflicts with existing data. Refresh and try again.";
  }
  console.error("[action] Unexpected error:", error);
  return "Something went wrong. Please try again.";
}

export const uuid = z.string().uuid({ message: "Invalid id." });
