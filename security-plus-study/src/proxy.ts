import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/study",
  "/quiz",
  "/exam",
  "/review",
  "/bookmarks",
  "/analytics",
  "/search",
  "/questions",
  "/settings",
  "/admin",
];
const AUTH_PAGES = ["/login", "/signup"];
const DEMO_SESSION_COOKIE = "bastion_demo_session";

/**
 * Refreshes Supabase sessions and performs optimistic redirects. Real
 * authorization happens on the server (layouts, actions and RLS).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let response = NextResponse.next({ request });
  let isSignedIn: boolean;

  if (isSupabaseConfigured()) {
    const result = await updateSupabaseSession(request);
    response = result.response;
    isSignedIn = result.isSignedIn;
  } else {
    isSignedIn = Boolean(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !isSignedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (isSignedIn && (AUTH_PAGES.includes(pathname) || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
