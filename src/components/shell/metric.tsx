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
  const isNumber = typeof value === "number";
  const isZero = isNumber && value === 0;

  const body = (
    <div className="flex w-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            emphasis
              ? "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              : isZero
                ? "bg-muted text-muted-foreground"
                : "bg-primary-soft text-primary",
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        {link && (
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden="true"
          />
        )}
      </div>

      <div>
        <div className="text-2xl font-bold tracking-tight text-foreground font-display tabular-nums sm:text-3xl">
          {value}
        </div>
        <div className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {hint && (
          <div className="mt-1 text-xs text-muted-foreground/80 leading-snug">
            {hint}
          </div>
        )}
      </div>
    </div>
  );

  const cardStyle = cn(
    "group relative flex min-w-0 flex-col rounded-2xl border p-4 transition-all duration-200",
    emphasis
      ? "border-rose-400/50 bg-rose-500/[0.04] shadow-xs hover:border-rose-500/70 hover:shadow-sm dark:bg-rose-500/[0.08]"
      : "border-border/80 bg-card shadow-xs hover:border-primary/40 hover:bg-card/90 hover:shadow-sm",
  );

  return link ? (
    <Link {...link} className={cardStyle}>
      {body}
    </Link>
  ) : (
    <div className={cardStyle}>{body}</div>
  );
}

export function MetricGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="list"
      aria-label={label}
      className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {children}
    </div>
  );
}
