"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";

const PRIMARY = ["/dashboard", "/study", "/exam", "/review"];

export function MobileNav({ user }: { user: AppUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || user.role === "admin");
  const primary = items.filter((i) => PRIMARY.includes(i.href));
  const more = items.filter((i) => !PRIMARY.includes(i.href));
  const moreActive = more.some((i) => isActive(pathname, i.href));

  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur-lg lg:hidden"
      aria-label="Main"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors",
                  active && "text-primary",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {item.shortLabel ?? item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className={cn(
                "flex w-full flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground",
                moreActive && "text-primary",
              )}
            >
              <Ellipsis className="size-5" aria-hidden />
              More
            </SheetTrigger>
            <SheetContent side="bottom" className="pb-safe">
              <SheetHeader>
                <SheetTitle>More</SheetTitle>
              </SheetHeader>
              <ul className="grid grid-cols-2 gap-2 px-4 pb-6">
                {more.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm font-medium",
                        isActive(pathname, item.href) && "border-primary text-primary",
                      )}
                    >
                      <item.icon className="size-5" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
