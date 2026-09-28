"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand } from "@/components/brand";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";
import { UserMenu } from "./user-menu";

export function AppSidebar({ user, isDemo }: { user: AppUser; isDemo: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || user.role === "admin");
  return (
    <div className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
    <aside className="sticky top-0 flex h-dvh flex-col">
      <div className="px-5 pt-5 pb-4">
        <Brand href="/dashboard" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Main">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active && "bg-card text-foreground shadow-sm ring-1 ring-border",
                  )}
                >
                  {active && <span className="absolute top-2 bottom-2 left-0 w-1 rounded-full brand-gradient" aria-hidden />}
                  <item.icon className={cn("size-[18px] text-muted-foreground group-hover:text-foreground", active && "text-primary")} aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-sidebar-border p-3">
        {isDemo && (
          <div className="mb-3 rounded-xl bg-accent px-3 py-2 text-xs text-accent-foreground">
            <span className="font-semibold">Demo mode.</span> Data is stored locally. Add Supabase keys to enable accounts.
          </div>
        )}
        <UserMenu user={user} showName className="w-full" />
      </div>
    </aside>
    </div>
  );
}
