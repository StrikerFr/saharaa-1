import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact metric: icon, prominent value, label and optional hint. When `link`
 * is given the whole card navigates to the matching screen.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  emphasis,
  link,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Draws attention (non-zero overdue etc.); paired with the label, never color alone. */
  emphasis?: boolean;
  link?: LinkProps;
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          emphasis ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
        )}
      >
        <Icon className="size-[1.125rem]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-muted-foreground">{label}</span>
        <span className="text-data block text-2xl leading-tight tabular-nums">{value}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {link && (
        <ChevronRight
          className="size-4 shrink-0 self-center text-subtle-foreground"
          aria-hidden="true"
        />
      )}
    </>
  );
  const cls = "surface flex min-w-0 items-start gap-3 p-4";
  return link ? (
    <Link
      {...link}
      className={cn(
        cls,
        "transition-standard hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function MetricGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="list"
      aria-label={label}
      className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
    >
      {children}
    </div>
  );
}
