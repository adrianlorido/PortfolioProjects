import "server-only";

import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Repository } from "./repository";

/**
 * Returns the storage adapter for this request: Supabase when configured,
 * otherwise the local demo store. Cached per request.
 */
export const getRepository = cache(async (): Promise<Repository> => {
  if (isSupabaseConfigured()) {
    const [{ createSupabaseServerClient }, { SupabaseRepository }] = await Promise.all([
      import("@/lib/supabase/server"),
      import("./supabase/supabase-repository"),
    ]);
    return new SupabaseRepository(await createSupabaseServerClient());
  }
  const { DemoRepository } = await import("./demo/demo-repository");
  return new DemoRepository();
});

export { RepositoryError } from "./repository";
export type { Repository } from "./repository";
