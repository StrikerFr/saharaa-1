// Phase 9 — Family portal domain models, contracts, and pure helpers.
// PURE: No direct database or network I/O.
import { z } from "zod";

export const FAMILY_PERMISSIONS = [
  "view_updates",
  "view_observations",
  "submit_reports",
  "view_tasks",
] as const;
export type FamilyPermission = (typeof FAMILY_PERMISSIONS)[number];

export const RELATIONSHIP_LABELS = [
  "Daughter",
  "Son",
  "Spouse / Partner",
  "Daughter-in-law",
  "Son-in-law",
  "Grandchild",
  "Sibling",
  "Primary Caregiver",
  "Legal Guardian",
  "Other Family Member",
] as const;
export type RelationshipLabel = (typeof RELATIONSHIP_LABELS)[number];

export interface SeniorFamilyMemberRow {
  id: string;
  senior_id: string;
  user_id: string;
  org_id: string;
  relationship_label: string;
  can_view_updates: boolean;
  can_view_observations: boolean;
  can_submit_reports: boolean;
  can_view_tasks: boolean;
  status: "active" | "revoked" | "expired";
  granted_by: string;
  granted_at: string;
  revoked_by?: string | null;
  revoked_at?: string | null;
  revocation_reason?: string | null;
  expires_at?: string | null;
}

export interface FamilyInvitationRow {
  id: string;
  senior_id: string;
  org_id: string;
  invited_email: string;
  relationship_label: string;
  token_hash: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_by?: string | null;
  accepted_at?: string | null;
}

export interface FamilySeniorProfile {
  id: string;
  displayName: string;
  recordCode: string;
  timeZone: string;
  preferredLanguage: string;
  careStatus: string;
  relationshipLabel: string;
  canViewUpdates: boolean;
  canViewObservations: boolean;
  canSubmitReports: boolean;
  canViewTasks: boolean;
}

export interface FamilyCareUpdateItem {
  id: string;
  type: "observation" | "reviewed_report" | "task_completed" | "routine_note";
  title: string;
  detail: string;
  timestamp: string;
  category?: string | null;
  valueFormatted?: string | null;
  source: string;
  isReviewed: boolean;
}

export interface FamilyFollowUpItem {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: "open" | "in_progress" | "completed";
  familyResponse: string | null;
  familyRespondedAt: string | null;
  createdAt: string;
}

export const createFamilyInviteInput = z.object({
  seniorId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  relationship: z.enum(RELATIONSHIP_LABELS),
});

export const acceptFamilyInviteInput = z.object({
  token: z.string().trim().min(16).max(128),
});

export const respondFamilyTaskInput = z.object({
  taskId: z.string().uuid(),
  response: z.string().trim().min(2, "Response must be at least 2 characters.").max(1000),
});

export const submitFamilyReportInput = z.object({
  seniorId: z.string().uuid(),
  text: z.string().trim().min(3, "Please write at least 3 characters.").max(4000),
  eventTime: z.string().datetime({ offset: true }).nullable().default(null),
  clientRequestId: z.string().uuid(),
  rawTranscript: z.string().optional(),
  durationSeconds: z.number().int().min(0).max(600).optional(),
});

/** Formats a relative date or absolute timestamp for family members in plain language */
export function formatFamilyDate(iso: string | null | undefined, timeZone = "Asia/Kolkata"): string {
  if (!iso) return "Recently";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "Recently";
    const now = new Date();
    const diffHours = (now.getTime() - d.getTime()) / (3600 * 1000);

    if (diffHours >= 0 && diffHours < 1) {
      const mins = Math.max(1, Math.round(diffHours * 60));
      return `${mins}m ago`;
    }
    if (diffHours >= 1 && diffHours < 24) {
      return `${Math.round(diffHours)}h ago`;
    }
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(d);
  } catch {
    return "Recently";
  }
}
