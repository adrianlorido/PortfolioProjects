import {
  Bookmark,
  BookOpen,
  ChartColumn,
  Database,
  History,
  LayoutDashboard,
  Settings,
  Timer,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard },
  { href: "/study", label: "Study", icon: BookOpen },
  { href: "/exam", label: "Practice Exam", shortLabel: "Exam", icon: Timer },
  { href: "/review", label: "Review", icon: History },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/admin", label: "Question Bank", icon: Database, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/exam") return pathname === "/exam" || pathname.startsWith("/exam/");
  if (href === "/study") return pathname === "/study" || pathname.startsWith("/study/") || pathname.startsWith("/quiz/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
