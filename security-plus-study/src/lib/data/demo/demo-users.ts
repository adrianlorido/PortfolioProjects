import "server-only";

import type { AppUser } from "@/lib/types";
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from "./demo-auth";
import { createDemoUser } from "./operations";
import { getDemoStore } from "./store";

function toAppUser(u: { id: string; email: string; displayName: string; role: AppUser["role"] }): AppUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
}

export function demoUserFromToken(token: string | undefined): AppUser | null {
  return getDemoStore().read((d) => {
    const userId = verifySessionToken(token, d.authSecret);
    const user = userId ? d.users.find((u) => u.id === userId) : undefined;
    return user ? toAppUser(user) : null;
  });
}

export function demoSignIn(email: string, password: string): { token: string } | null {
  return getDemoStore().read((d) => {
    const user = d.users.find((u) => u.email === email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    return { token: createSessionToken(user.id, d.authSecret) };
  });
}

export function demoSignUp(email: string, password: string, displayName: string): { token: string } | { error: string } {
  return getDemoStore().mutate((d) => {
    if (d.users.some((u) => u.email === email.trim().toLowerCase())) {
      return { error: "An account with this email already exists." };
    }
    const user = createDemoUser(d, { email, password, displayName });
    return { token: createSessionToken(user.id, d.authSecret) };
  });
}

export function demoSetPassword(userId: string, password: string): void {
  getDemoStore().mutate((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (user) user.passwordHash = hashPassword(password);
  });
}
