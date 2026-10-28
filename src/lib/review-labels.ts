// User-facing wording for Phase 6 workflow states. Neutral and operational.
import type { Tone } from "@/components/shell/states";
import type { FollowUpTaskStatus, ReviewCaseStatus } from "./review-workflow";

export const CASE_STATUS_LABEL: Record<ReviewCaseStatus, { label: string; tone: Tone }> = {
  needs_review: { label: "Needs review", tone: "warning" },
  in_review: { label: "In review", tone: "info" },
  follow_up_required: { label: "Follow-up required", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

export const TASK_STATUS_LABEL: Record<FollowUpTaskStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
