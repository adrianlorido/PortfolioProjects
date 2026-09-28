import { NextResponse, type NextRequest } from "next/server";

/** Clears a stale demo session cookie, then sends the user to sign in. */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete("bastion_demo_session");
  return response;
}
