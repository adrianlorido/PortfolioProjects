export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

/** Server action results: success data varies; failures always carry a message (extra fields are optional). */
type ResultLike = { ok: true } | { ok: false; error: string };

/**
 * Awaits a server action from client code. Actions report expected failures as
 * `{ ok: false, error }`, but the request itself can still reject (offline, a
 * deploy in progress); this folds that into the same shape so callers handle
 * one failure path instead of crashing into the error boundary.
 */
export async function callAction<R extends ResultLike>(pending: Promise<R>): Promise<R> {
  try {
    return await pending;
  } catch {
    return { ok: false, error: NETWORK_ERROR } as unknown as R;
  }
}
