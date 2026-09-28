/**
 * Supabase is enabled when the URL and a public (anon/publishable) key are set.
 * Without them the app runs in demo mode backed by a local file store.
 */
export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export function getSiteUrl(fallbackOrigin?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return (configured || fallbackOrigin || "http://localhost:3000").replace(/\/$/, "");
}
