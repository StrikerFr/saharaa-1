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
    label: "Needs review",
    shortHelp: "Unassigned alerts",
    help: "Cases waiting for coordinator review",
    icon: ClipboardList,
  },
  {
    key: "inReview",
    label: "In review",
    shortHelp: "Being handled",
    help: "Cases currently under coordinator review",
    icon: Eye,
  },
  {
    key: "followUpRequired",
    label: "Follow-up needed",
    shortHelp: "Action pending",
    help: "Reviewed cases waiting on care actions",
    icon: SearchCheck,
  },
  {
    key: "overdueTasks",
    label: "Overdue tasks",
    shortHelp: "Past deadline",
    help: "Open follow-up tasks past their due time",
    icon: AlertTriangle,
  },
  {
    key: "dueSoonTasks",
    label: "Due in 48 hours",
    shortHelp: "Upcoming tasks",
    help: "Open tasks due within the next two days",
    icon: CalendarClock,
  },
  {
    key: "insufficientOrStale",
    label: "Stale / low data",
    shortHelp: "Need fresh vitals",
    help: "Active cases whose latest assessment is over 7 days old or has low data",
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
              hint={c.shortHelp}
              emphasis={attention}
              link={link}
            />
          </div>
        );
      })}
    </MetricGrid>
  );
}
