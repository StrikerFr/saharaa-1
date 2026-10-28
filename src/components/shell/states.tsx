import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "info" | "success" | "warning" | "critical" | "neutral";

const toneClass: Record<Tone, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  neutral: "bg-secondary text-secondary-foreground",
};

const toneIcon: Record<Tone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: OctagonAlert,
  neutral: Info,
};

/** Status pill: always icon + text, never color alone. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold",
        toneClass[tone],
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: Exclude<Tone, "neutral">;
  title: string;
  children?: ReactNode;
}) {
  const Icon = toneIcon[tone];
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border border-current/20 p-4", toneClass[tone])}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-14 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h3 className="text-card-title">{title}</h3>
      {children && <p className="mt-2 max-w-md text-muted-foreground">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
