import { Suspense } from "react";

import { Brand } from "@/components/brand";
import type { AppUser, UserSettings } from "@/lib/types";
import { AppSidebar } from "./app-sidebar";
import { MobileNav } from "./mobile-nav";
import { SearchBox } from "./search-box";
import { SessionSync } from "./session-sync";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function AppShell({
  user,
  settings,
  isDemo,
  children,
}: {
  user: AppUser;
  settings: UserSettings;
  isDemo: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SessionSync theme={settings.theme} timezone={settings.timezone} />
      <AppSidebar user={user} isDemo={isDemo} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-lg">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <div className="lg:hidden">
              <Brand href="/dashboard" compact />
            </div>
            <Suspense fallback={<div className="h-10 flex-1" />}>
              <SearchBox className="max-w-md flex-1" />
            </Suspense>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <div className="lg:hidden">
                <UserMenu user={user} />
              </div>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>
      <MobileNav user={user} />
    </div>
  );
}
