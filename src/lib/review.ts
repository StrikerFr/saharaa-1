// Phase 6 row shapes for the review-case and follow-up-task tables. The
// generated Database types predate these tables, so queries cast to these
// interfaces; the shapes mirror supabase/full_schema.sql exactly.
import type { ReviewPriority, QualityStatus } from "@/risk/engine";
import type { FollowUpTaskStatus, ReviewCaseStatus } from "./review-workflow";

export interface ReviewCaseRow {
  id: string;
  senior_id: string;
  org_id: string;
  status: ReviewCaseStatus;
  priority_at_open: ReviewPriority;
  opened_by_assessment_id: string;
  latest_assessment_id: string;
  assigned_to: string | null;
  opened_by: string;
  opened_at: string;
  updated_at: string;
  version: number;
}

export interface ReviewCaseEventRow {
  id: string;
  case_id: string;
  org_id: string;
  from_status: ReviewCaseStatus | null;
  to_status: ReviewCaseStatus;
  actor_id: string;
  reason: string | null;
  created_at: string;
}

export interface FollowUpTaskRow {
  id: string;
  senior_id: string;
  org_id: string;
  review_case_id: string | null;
  title: string;
  notes: string | null;
  assigned_to: string | null;
  due_at: string | null;
  status: FollowUpTaskStatus;
  outcome_note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
}

export interface FollowUpTaskEventRow {
  id: string;
  task_id: string;
  org_id: string;
  from_status: FollowUpTaskStatus | null;
  to_status: FollowUpTaskStatus;
  actor_id: string;
  note: string | null;
  created_at: string;
}

/** Queue row: an active review case joined to its senior and current assessment. */
export interface QueueRow {
  caseId: string;
  seniorId: string;
  seniorName: string;
  recordCode: string;
  isSynthetic: boolean;
  status: ReviewCaseStatus;
  assignedTo: string | null;
  assigneeName: string | null;
  priority: ReviewPriority;
  dataQuality: QualityStatus;
  changedDomains: string[];
  assessedAt: string;
  openedAt: string;
  nextTaskDueAt: string | null;
  openTaskCount: number;
}

export interface OperationsSummary {
  awaitingReview: number;
  inReview: number;
  followUpRequired: number;
  overdueTasks: number;
  dueSoonTasks: number;
  insufficientOrStale: number;
}
