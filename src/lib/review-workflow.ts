// Phase 6 review-case and follow-up task workflow rules. PURE: no I/O, no clock
// access except through explicit `now` parameters. The transition maps here are
// mirrored by the SECURITY DEFINER functions in supabase/full_schema.sql — the
// database is the enforcer; these exist so the UI can offer only valid actions
// and so the rules are unit-testable.
import type { ReviewPriority } from "@/risk/engine";

/* ---------- Review cases ---------- */

export const REVIEW_CASE_STATUSES = [
  "needs_review",
  "in_review",
  "follow_up_required",
  "resolved",
  "dismissed",
] as const;
export type ReviewCaseStatus = (typeof REVIEW_CASE_STATUSES)[number];

/** Statuses in which a case still needs coordinator attention. */
export const ACTIVE_CASE_STATUSES: readonly ReviewCaseStatus[] = [
  "needs_review",
  "in_review",
  "follow_up_required",
];

const CASE_TRANSITIONS: Record<ReviewCaseStatus, readonly ReviewCaseStatus[]> = {
  needs_review: ["in_review", "dismissed"],
  in_review: ["follow_up_required", "resolved", "dismissed"],
  follow_up_required: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

export function canTransitionCase(from: ReviewCaseStatus, to: ReviewCaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function isCaseClosed(status: ReviewCaseStatus): boolean {
  return status === "resolved" || status === "dismissed";
}

/** Dismissal and resolution both require a written reason/outcome. */
export function caseTransitionNeedsReason(to: ReviewCaseStatus): boolean {
  return to === "dismissed" || to === "resolved";
}

/* ---------- Follow-up tasks ---------- */

export const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type FollowUpTaskStatus = (typeof TASK_STATUSES)[number];

const TASK_TRANSITIONS: Record<FollowUpTaskStatus, readonly FollowUpTaskStatus[]> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled", "open"],
  completed: [],
  cancelled: [],
};

export function canTransitionTask(from: FollowUpTaskStatus, to: FollowUpTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function isTaskClosed(status: FollowUpTaskStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function taskTransitionNeedsNote(to: FollowUpTaskStatus): boolean {
  return to === "completed";
}

/**
 * Overdue is always derived, never stored: a task with a due time in the past
 * that is still open or in progress. `now` is injected for testability.
 */
export function isTaskOverdue(
  dueAt: string | null,
  status: FollowUpTaskStatus,
  now: Date = new Date(),
): boolean {
  if (!dueAt || isTaskClosed(status)) return false;
  return Date.parse(dueAt) < now.getTime();
}

/** Due within the next `withinHours` (and not already overdue). */
export function isTaskDueSoon(
  dueAt: string | null,
  status: FollowUpTaskStatus,
  now: Date = new Date(),
  withinHours = 48,
): boolean {
  if (!dueAt || isTaskClosed(status)) return false;
  const due = Date.parse(dueAt);
  return due >= now.getTime() && due <= now.getTime() + withinHours * 3_600_000;
}

/* ---------- Queue ordering ---------- */

/**
 * Operational urgency rank for queue ordering. Lower sorts first. This is an
 * operational ordering signal only — it does not modify the engine's result.
 * "Unable to assess" ranks above "no signal" because missing data must never
 * look reassuring; genuine signals still outrank both.
 */
export const PRIORITY_RANK: Record<ReviewPriority, number> = {
  prompt_review_recommended: 0,
  review_recommended: 1,
  review_suggested: 2,
  unable_to_assess: 3,
  no_signal_detected: 4,
};

export function compareQueueRows(
  a: { priority: ReviewPriority; assessedAt: string; id: string },
  b: { priority: ReviewPriority; assessedAt: string; id: string },
): number {
  const r = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (r !== 0) return r;
  // Newer assessment first, then a stable id tie-breaker.
  const t = Date.parse(b.assessedAt) - Date.parse(a.assessedAt);
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ---------- Current vs superseded assessments ---------- */

export interface AssessmentRef {
  id: string;
  created_at: string;
}

/**
 * The current assessment for a senior is the most recently created record;
 * ties break on id for determinism. All earlier records are superseded but
 * preserved for traceability.
 */
export function selectCurrentAssessment<T extends AssessmentRef>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  for (const r of rows) {
    const t = Date.parse(r.created_at) - Date.parse(best.created_at);
    if (t > 0 || (t === 0 && r.id > best.id)) best = r;
  }
  return best;
}

/** An assessment is stale when newer input could exist: older than `staleDays`. */
export function isAssessmentStale(
  createdAt: string,
  now: Date = new Date(),
  staleDays = 7,
): boolean {
  return now.getTime() - Date.parse(createdAt) > staleDays * 86_400_000;
}
