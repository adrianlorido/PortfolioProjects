import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated once. Only NEXT_PUBLIC_* values may ever reach the
 * browser; everything read here stays on the server (this module is `server-only`).
 */
const envSchema = z.object({
  DATA_MODE: z.enum(["sample", "supabase"]).default("sample"),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cached) {
    const parsed = envSchema.safeParse({ DATA_MODE: process.env.DATA_MODE || undefined });
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isSampleMode(): boolean {
  return getServerEnv().DATA_MODE === "sample";
}
