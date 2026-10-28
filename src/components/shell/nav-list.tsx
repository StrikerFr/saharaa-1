import { Link, useRouterState } from "@tanstack/react-router";

import { isNavActive, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const itemBase =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] transition-standard";

export function NavList({
  items,
  label,
  onNavigate,
}: {
  items: NavItem[];
  label: string;
  onNavigate?: (() => void) | undefined;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div>
      <p className="text-eyebrow px-3 pb-2 text-subtle-foreground" id={`nav-${label}`}>
        {label}
      </p>
      <ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${label}`}>
        {items.map((item) => {
          const Icon = item.icon;
          if (item.status === "planned") {
            return (
              <li key={item.label}>
                <span
                  className={cn(itemBase, "cursor-default text-subtle-foreground")}
                  aria-disabled="true"
                >
                  <Icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  <span className="sr-only">(not available yet)</span>
                </span>
              </li>
            );
          }
          const active = isNavActive(item.to, pathname);
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  itemBase,
                  "relative font-semibold",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-full before:bg-primary"
                    : "text-sidebar-foreground hover:bg-secondary",
                )}
              >
                <Icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
