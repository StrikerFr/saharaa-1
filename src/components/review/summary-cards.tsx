import { MetricCard, MetricGrid } from "@/components/shell/metric";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Eye,
  FileWarning,
  SearchCheck,
} from "lucide-react";

import type { OperationsSummary } from "@/lib/review";

const CARDS = [
  {
    key: "awaitingReview",
    label: "Awaiting review",
    help: "Cases no coordinator has started reviewing",
    icon: ClipboardList,
  },
  {
    key: "inReview",
    label: "In review",
    help: "Cases a coordinator is actively reviewing",
    icon: Eye,
  },
  {
    key: "followUpRequired",
    label: "Follow-up required",
    help: "Reviewed cases waiting on a follow-up outcome",
    icon: SearchCheck,
  },
  {
    key: "overdueTasks",
    label: "Overdue follow-ups",
    help: "Open tasks past their due time",
    icon: AlertTriangle,
  },
  {
    key: "dueSoonTasks",
    label: "Due in 48 hours",
    help: "Open tasks due within the next two days",
    icon: CalendarClock,
  },
  {
    key: "insufficientOrStale",
    label: "Insufficient or stale data",
    help: "Active cases whose latest assessment is over 7 days old or had insufficient data",
    icon: FileWarning,
  },
] as const;

/** Workload summary. Every count is computed from persisted, org-scoped records. */
export function SummaryCards({ summary }: { summary: OperationsSummary }) {
  return (
    <MetricGrid label="Workload summary">
      {CARDS.map((c) => {
        const value = summary[c.key];
        const attention = (c.key === "overdueTasks" || c.key === "awaitingReview") && value > 0;
        const link =
          c.key === "overdueTasks" || c.key === "dueSoonTasks"
            ? ({ to: "/follow-ups" } as const)
            : ({ to: "/alerts" } as const);
        return (
          <div role="listitem" key={c.key} title={c.help}>
            <MetricCard
              icon={c.icon}
              label={c.label}
              value={value}
              hint={c.help}
              emphasis={attention}
              link={link}
            />
          </div>
        );
      })}
    </MetricGrid>
  );
}
