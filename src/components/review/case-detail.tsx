import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";

import { ReviewActions } from "@/components/review/review-actions";
import { Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { CASE_STATUS_LABEL } from "@/lib/review-labels";
import { getReviewCaseDetail } from "@/lib/review.functions";
import { isAssessmentStale } from "@/lib/review-workflow";
import { formatInZone } from "@/lib/seniors";
import { PRIORITY_LABEL, QUALITY_LABEL } from "@/risk/labels";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The review workspace for a senior's active (or most recent) review case:
 * status, history, linked follow-up tasks, and actions. Assessment evidence
 * itself is rendered by the Phase 5 AssessmentPanel above this section.
 */
export function CaseDetail({ caseId, timeZone }: { caseId: string; timeZone: string }) {
  const run = useServerFn(getReviewCaseDetail);
  const query = useQuery({
    queryKey: ["review-case", caseId],
    queryFn: () => run({ data: { caseId } }),
  });

  if (query.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Loading the review case…
      </p>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="critical" title="Couldn't load the review case." />
        <button
          type="button"
          className="text-sm font-semibold underline underline-offset-2"
          onClick={() => query.refetch()}
        >
          Try again
        </button>
      </div>
    );

  if (!query.data || !query.data.case) {
    return <Notice tone="critical" title="Couldn't load the review case details." />;
  }

  const { case: c, assessment, superseded, events = [], tasks = [] } = query.data;
  const cs = CASE_STATUS_LABEL[c.status] ?? { label: c.status, tone: "neutral" as const };
  const stale = assessment ? isAssessmentStale(assessment.created_at) : false;
  const priorityMeta =
    PRIORITY_LABEL[c.priority_at_open] ?? {
      label: String(c.priority_at_open).replace(/_/g, " "),
      tone: "neutral" as const,
    };

  return (
    <Section
      title="Review case"
      description="The human review of this person's surfaced assessment. An algorithmic suggestion becomes a decision only when a coordinator acts."
    >
      <article className="surface flex flex-col gap-6 p-6" aria-label="Review case detail">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={cs.tone}>{cs.label}</StatusBadge>
            <StatusBadge tone={priorityMeta.tone}>
              Opened as: {priorityMeta.label}
            </StatusBadge>
            {stale && <StatusBadge tone="warning">Assessment over 7 days old</StatusBadge>}
            {superseded && <StatusBadge tone="warning">A newer assessment exists</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Opened {formatInZone(c.opened_at, timeZone)}
            {assessment
              ? ` · Current assessment run ${formatInZone(assessment.created_at, timeZone)} (${assessment.ruleset_version})`
              : " · The linked assessment is not available to your account"}
          </p>
          {assessment && (
            <p className="text-sm text-muted-foreground">
              Assessment category:{" "}
              {PRIORITY_LABEL[assessment.priority as keyof typeof PRIORITY_LABEL]?.label ??
                assessment.priority}{" "}
              ·{" "}
              {QUALITY_LABEL[assessment.data_quality as keyof typeof QUALITY_LABEL] ??
                assessment.data_quality}
            </p>
          )}
        </header>

        <ReviewActions caseId={c.id} status={c.status} />

        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">History</h3>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded events.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 py-2 text-sm">
                  <span>
                    <span className="font-semibold">
                      {e.from_status
                        ? `${CASE_STATUS_LABEL[e.from_status].label} → ${CASE_STATUS_LABEL[e.to_status].label}`
                        : `Opened as ${CASE_STATUS_LABEL[e.to_status].label}`}
                    </span>{" "}
                    <span className="text-muted-foreground">· {formatWhen(e.created_at)}</span>
                  </span>
                  {e.reason && <span className="text-muted-foreground">“{e.reason}”</span>}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Follow-up tasks</h3>
            <TaskForm seniorId={c.senior_id} caseId={c.id} />
          </div>
          {tasks.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No follow-up tasks">
              Create a task to track the next human action for this case.
            </EmptyState>
          ) : (
            <TaskList tasks={tasks} />
          )}
          <p className="text-sm text-muted-foreground">
            Completing a task records its outcome; it does not resolve this case. Resolving or
            dismissing the case is a separate decision above.
          </p>
        </div>
      </article>
    </Section>
  );
}
