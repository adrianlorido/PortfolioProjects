"use client";

import { Database, FileUp, MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Questions", icon: Database },
  { href: "/admin/import", label: "Import", icon: FileUp },
  { href: "/admin/reports", label: "Reports", icon: MessageSquareWarning },
];

export function AdminTabs({ openReports }: { openReports: number }) {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Question bank">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/questions") : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
            {t.href === "/admin/reports" && openReports > 0 && (
              <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold text-danger-foreground">{openReports}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
