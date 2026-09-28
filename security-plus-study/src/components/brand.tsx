import Link from "next/link";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="bastion-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--brand-cyan)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#bastion-mark)" />
      <path
        d="M32 15.5l13 4.9v9.8c0 8.8-5.6 15.6-13 18.6-7.4-3-13-9.8-13-18.6v-9.8l13-4.9z"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M25.5 31.5l4.6 4.6 8.9-9.3" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ href = "/", className, compact = false }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}>
      <BrandMark className="transition-transform group-hover:scale-105" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">Bastion</span>
          <span className="text-[11px] font-medium text-muted-foreground">Security+ SY0-701</span>
        </span>
      )}
    </Link>
  );
}
