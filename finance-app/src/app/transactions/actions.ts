"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { updateTransactionFromInput } from "@/modules/transactions/service";

export interface UpdateTransactionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Increments per submission so the client can react to repeated results. */
  nonce: number;
}

/**
 * Server actions are public HTTP endpoints: everything in `formData` is untrusted.
 * Only the whitelisted fields are read, the user comes from the server session, and the
 * service validates with a strict schema before touching the repository.
 */
export async function updateTransactionAction(prev: UpdateTransactionState, formData: FormData): Promise<UpdateTransactionState> {
  const user = await requireUser();
  const repo = await getRepository();
  const categoryId = formData.get("categoryId");
  const input = {
    transactionId: formData.get("transactionId"),
    categoryId: categoryId === "" ? null : categoryId,
    notes: formData.get("notes") ?? null,
    excludedFromReports: formData.get("excludedFromReports") === "on",
  };
  try {
    await updateTransactionFromInput(repo, user.id, input, new Date().toISOString());
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      return { status: "error", message: error instanceof NotFoundError ? "Transaction not found." : "Please check the values and try again.", nonce: prev.nonce + 1 };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return { status: "success", nonce: prev.nonce + 1 };
}
