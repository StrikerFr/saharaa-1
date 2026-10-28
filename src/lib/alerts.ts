// Alerts module rules. PURE: no I/O. An "alert" in Sahaara is a review case
// (review_cases) — the one alert system. This file only decides when a fresh
// assessment should raise or refresh one, and how alert statuses are worded.
// The database (open_review_case / transition_review_case) is the enforcer.
import type { QualityStatus, ReviewPriority } from "@/risk/engine";
import type { ReviewCaseStatus } from "@/lib/review-workflow";

/**
 * What a newly saved assessment does to the alerting workflow:
 * - "open": raise an alert, or attach this assessment to the senior's active
 *   alert (open_review_case is idempotent — one active alert per senior).
 * - "attach_if_active": refresh evidence on an existing active alert only;
 *   never create one and never close one.
 *
 * `unable_to_assess` opens an alert because missing/stale data is uncertainty
 * that needs a human, not reassurance. `no_signal_detected` never closes an
 * existing alert: only a coordinator can resolve or dismiss.
 */
export type AlertAction = "open" | "attach_if_active";

export function alertActionForPriority(priority: ReviewPriority): AlertAction {
  switch (priority) {
    case "prompt_review_recommended":
    case "review_recommended":
    case "review_suggested":
    case "unable_to_assess":
      return "open";
    case "no_signal_detected":
      return "attach_if_active";
  }
}

/** Coordinator-facing alert status wording, mapped onto review-case statuses. */
export const ALERT_STATUS_LABEL: Record<ReviewCaseStatus, string> = {
  needs_review: "Open",
  in_review: "Acknowledged",
  follow_up_required: "Escalated to follow-up",
  resolved: "Resolved",
  dismissed: "Dismissed after review",
};

/** The next step a coordinator should take, in plain words. */
export function nextAlertStep(status: ReviewCaseStatus, assigned: boolean): string {
  switch (status) {
    case "needs_review":
      return assigned
        ? "Acknowledge and start the review."
        : "Assign a coordinator or acknowledge.";
    case "in_review":
      return "Escalate to a follow-up, resolve with an outcome, or dismiss with a reason.";
    case "follow_up_required":
      return "Complete the follow-up, then resolve with an outcome.";
    case "resolved":
    case "dismissed":
      return "Closed. Reopen only if a newer assessment needs attention.";
  }
}

/** A concise, non-diagnostic explanation of why the alert exists. */
export function explainAlert(input: {
  priority: ReviewPriority;
  dataQuality: QualityStatus;
  changedDomains: readonly string[];
  domainLabel: (d: string) => string;
}): string {
  const parts: string[] = [];
  if (input.priority === "unable_to_assess") {
    parts.push("Too little recent data to assess reliably — this is not reassurance.");
  } else if (input.changedDomains.length > 0) {
    parts.push(`Change found in: ${input.changedDomains.map(input.domainLabel).join(", ")}.`);
  } else {
    parts.push("No change found in the evaluated scope.");
  }
  if (input.dataQuality === "limited") parts.push("Data limitations apply.");
  if (input.dataQuality === "insufficient" && input.priority !== "unable_to_assess")
    parts.push("Some areas had insufficient data.");
  return parts.join(" ");
}

export type AlertSort = "priority" | "newest" | "updated";
