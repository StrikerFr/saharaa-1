import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  CalendarCheck,
  FileBarChart,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Palette,
  UserRound,
  Users,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

/**
 * Navigation destinations. Only `available` items link anywhere; the rest are
 * honest, non-interactive markers for modules planned in later phases.
 * `requiresRole` only hides the link — access is enforced by the database.
 */
export type NavItem =
  | {
      label: string;
      icon: LucideIcon;
      status: "available";
      to:
        | "/"
        | "/design-system"
        | "/account"
        | "/admin"
        | "/seniors"
        | "/follow-ups"
        | "/alerts"
        | "/messages"
        | "/reports";
      requiresRole?: AppRole;
    }
  | { label: string; icon: LucideIcon; status: "planned"; phase: number };

export const primaryNav: NavItem[] = [
  { label: "Overview", icon: LayoutDashboard, status: "available", to: "/" },
  { label: "Seniors", icon: Users, status: "available", to: "/seniors" },
  { label: "Alerts", icon: BellRing, status: "available", to: "/alerts" },
  { label: "Follow-ups", icon: CalendarCheck, status: "available", to: "/follow-ups" },
  { label: "Messages", icon: MessagesSquare, status: "available", to: "/messages" },
  { label: "Reports", icon: FileBarChart, status: "available", to: "/reports" },
];

export const secondaryNav: NavItem[] = [
  { label: "Account", icon: UserRound, status: "available", to: "/account" },
  {
    label: "Administration",
    icon: KeyRound,
    status: "available",
    to: "/admin",
    requiresRole: "admin",
  },
  { label: "Design system", icon: Palette, status: "available", to: "/design-system" },
];

export function visibleNav(items: NavItem[], roles: readonly AppRole[]): NavItem[] {
  return items.filter(
    (i) => i.status !== "available" || !i.requiresRole || roles.includes(i.requiresRole),
  );
}

export function isNavActive(itemTo: string, pathname: string): boolean {
  if (itemTo === "/") return pathname === "/";
  return pathname === itemTo || pathname.startsWith(`${itemTo}/`);
}
