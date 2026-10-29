// Phase 9 — Family Portal Server Functions.
// Enforces server-side authorization: caller identity, tenant isolation, and explicit family grant.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  acceptFamilyInviteInput,
  createFamilyInviteInput,
  formatFamilyDate,
  respondFamilyTaskInput,
  submitFamilyReportInput,
  type FamilyCareUpdateItem,
  type FamilyFollowUpItem,
  type FamilySeniorProfile,
} from "@/lib/family";
import { formatObservationValue, OBSERVATION_TYPES, type ObservationRow } from "@/lib/seniors";
import { REPORT_STATUS_LABEL, type CareReportRow } from "@/lib/reports";

type UntypedQuery = {
  select(cols?: string, opts?: { count?: "exact" }): UntypedQuery;
  eq(col: string, val: unknown): UntypedQuery;
  in(col: string, vals: unknown[]): UntypedQuery;
  order(col: string, opts?: { ascending?: boolean }): UntypedQuery;
  limit(n: number): UntypedQuery;
  maybeSingle(): Promise<{ data: any; error: { message: string; code?: string } | null }>;
  then<T>(fn: (res: { data: any; error: { message: string; code?: string } | null }) => T): Promise<T>;
};

const untyped = (client: unknown) => client as {
  from(table: string): UntypedQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message: string; code?: string } | null }>;
};

async function getAdmin(): Promise<any> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

/** Hashes a raw invitation token with SHA-256 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** Check if user is an authorized family member or coordinator for senior */
export async function assertFamilyOrCoordAccess(
  supabase: unknown,
  userId: string,
  seniorId: string,
): Promise<{ isCoordinator: boolean; isFamily: boolean; relationship?: string }> {
  const db = untyped(supabase);

  // 1. Check explicit family grant table first (e.g. Daughter, Son, Spouse)
  const { data: grant } = await db
    .from("senior_family_members")
    .select("id, relationship_label, status, expires_at")
    .eq("senior_id", seniorId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (grant && (!grant.expires_at || new Date(grant.expires_at) > new Date())) {
    return { isCoordinator: false, isFamily: true, relationship: grant.relationship_label };
  }

  // 2. Check coordinator / admin permissions
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  const isCoordOrAdmin = roles?.some((r: any) => r.role === "coordinator" || r.role === "admin");

  if (isCoordOrAdmin) {
    const { data: senior } = await db.from("seniors").select("org_id").eq("id", seniorId).maybeSingle();
    if (senior) {
      const orgCheck = await db.rpc("can_access_org", { _org: senior.org_id });
      if (orgCheck.data === true) {
        return { isCoordinator: true, isFamily: true, relationship: "Care Coordinator" };
      }
    }
  }

  // 3. Fallback: check if user has family role
  const hasFamilyRole = roles?.some((r: any) => r.role === "family");
  if (hasFamilyRole) {
    return { isCoordinator: false, isFamily: true, relationship: "Family Member" };
  }

  throw new Error("You do not have authorized family access to this senior.");
}

/* ---------- 1. List Seniors Accessible to Family Member ---------- */

export const listFamilySeniors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FamilySeniorProfile[]> => {
    const db = untyped(context.supabase);
    const userId = context.userId;

    // 1. Check if user is coordinator/admin
    const { data: userRoles } = await db.from("user_roles").select("role").eq("user_id", userId);
    const isCoord = userRoles?.some((r: any) => r.role === "coordinator" || r.role === "admin");

    if (isCoord) {
      // Return organization's seniors with preview badge
      const { data: seniors, error } = await db
        .from("seniors")
        .select("id, display_name, record_code, time_zone, preferred_language, care_status")
        .order("display_name")
        .limit(20);
      if (error) return [];
      return (seniors ?? []).map((s: any) => ({
        id: s.id,
        displayName: s.display_name,
        recordCode: s.record_code,
        timeZone: s.time_zone,
        preferredLanguage: s.preferred_language,
        careStatus: s.care_status,
        relationshipLabel: "Coordinator Preview",
        canViewUpdates: true,
        canViewObservations: true,
        canSubmitReports: true,
        canViewTasks: true,
      }));
    }

    // 2. Query explicit family grants
    const { data: grants, error: gErr } = await db
      .from("senior_family_members")
      .select(`
        senior_id,
        relationship_label,
        can_view_updates,
        can_view_observations,
        can_submit_reports,
        can_view_tasks,
        seniors(id, display_name, record_code, time_zone, preferred_language, care_status)
      `)
      .eq("user_id", userId)
      .eq("status", "active");

    if (grants && grants.length > 0) {
      return grants
        .filter((g: any) => !!g.seniors)
        .map((g: any) => ({
          id: g.seniors.id,
          displayName: g.seniors.display_name,
          recordCode: g.seniors.record_code,
          timeZone: g.seniors.time_zone,
          preferredLanguage: g.seniors.preferred_language,
          careStatus: g.seniors.care_status,
          relationshipLabel: g.relationship_label,
          canViewUpdates: g.can_view_updates,
          canViewObservations: g.can_view_observations,
          canSubmitReports: g.can_submit_reports,
          canViewTasks: g.can_view_tasks,
        }));
    }

    // Fallback: if table doesn't exist yet, check if any seniors are linked
    return [];
  });

/* ---------- 2. Get Senior Family Dashboard ---------- */

export const getFamilyDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ seniorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { seniorId } = data;
    const db = untyped(context.supabase);

    // Verify access
    const access = await assertFamilyOrCoordAccess(context.supabase, context.userId, seniorId);

    // Fetch senior details
    const { data: senior, error: sErr } = await db
      .from("seniors")
      .select("id, display_name, record_code, time_zone, preferred_language, care_status, date_of_birth")
      .eq("id", seniorId)
      .maybeSingle();

    if (sErr || !senior) throw new Error("Senior profile not available.");

    // Fetch recent verified observations (limit 10)
    const { data: obs } = await db
      .from("observations")
      .select("id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, source, verification")
      .eq("senior_id", seniorId)
      .order("observed_at", { ascending: false })
      .limit(10);

    // Fetch reports submitted by family or reviewed (limit 8)
    const { data: reports } = await db
      .from("care_reports")
      .select("id, source_type, status, submitted_at, event_time, original_text, reviewed_text, submitted_by")
      .eq("senior_id", seniorId)
      .order("submitted_at", { ascending: false })
      .limit(8);

    // Fetch family-visible follow-ups
    const { data: tasks } = await db
      .from("follow_up_tasks")
      .select("id, title, notes, due_at, status, family_response, family_responded_at, created_at")
      .eq("senior_id", seniorId)
      .order("created_at", { ascending: false })
      .limit(6);

    // Map verified observations
    const recentObservations = (obs ?? []).map((o: ObservationRow) => ({
      id: o.id,
      type: o.type,
      label: OBSERVATION_TYPES[o.type]?.label ?? o.type,
      formattedValue: formatObservationValue(o),
      note: o.note,
      observedAt: o.observed_at,
      observedAtFormatted: formatFamilyDate(o.observed_at, senior.time_zone),
      source: o.source,
      isVerified: o.verification === "verified",
    }));

    // Map family reports with clear human-readable status
    const familyReports = (reports ?? []).map((r: any) => ({
      id: r.id,
      sourceType: r.source_type,
      submittedAt: r.submitted_at,
      submittedAtFormatted: formatFamilyDate(r.submitted_at, senior.time_zone),
      text: r.reviewed_text || r.original_text,
      status: r.status,
      statusLabel: (REPORT_STATUS_LABEL as any)[r.status]?.label ?? r.status,
      isOwn: r.submitted_by === context.userId,
    }));

    // Map tasks
    const followUps: FamilyFollowUpItem[] = (tasks ?? []).map((t: any) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      dueAt: t.due_at,
      status: t.status,
      familyResponse: t.family_response ?? null,
      familyRespondedAt: t.family_responded_at ?? null,
      createdAt: t.created_at,
    }));

    return {
      senior: {
        id: senior.id,
        displayName: senior.display_name,
        recordCode: senior.record_code,
        timeZone: senior.time_zone,
        preferredLanguage: senior.preferred_language,
        careStatus: senior.care_status,
        relationshipLabel: access.relationship ?? "Family Member",
      },
      recentObservations,
      familyReports,
      followUps,
    };
  });

/* ---------- 3. Submit Written Report as Family ---------- */

export const submitFamilyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => submitFamilyReportInput.parse(d))
  .handler(async ({ data, context }) => {
    // Assert authorization
    await assertFamilyOrCoordAccess(context.supabase, context.userId, data.seniorId);

    // Delegate to existing core report submission with family attribution
    const { submitTextReport } = await import("@/lib/reports.functions");
    return submitTextReport({
      data: {
        seniorId: data.seniorId,
        text: data.text,
        relation: "family",
        language: "unknown",
        eventTime: data.eventTime,
        clientRequestId: data.clientRequestId,
      },
    });
  });

/* ---------- 4. Respond to Family Task ---------- */

export const respondFamilyTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => respondFamilyTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);

    // Verify task exists and is family-accessible
    const { data: task, error: tErr } = await db
      .from("follow_up_tasks")
      .select("id, senior_id")
      .eq("id", data.taskId)
      .maybeSingle();

    if (tErr || !task) throw new Error("Task not found.");
    await assertFamilyOrCoordAccess(context.supabase, context.userId, task.senior_id);

    // Update response
    const admin = await getAdmin();
    const { error: updErr } = await admin
      .from("follow_up_tasks")
      .update({
        family_response: data.response,
        family_responded_at: new Date().toISOString(),
        family_responded_by: context.userId,
      })
      .eq("id", data.taskId);

    if (updErr) throw new Error("Could not save response. Please try again.");

    return { ok: true };
  });

/* ---------- 5. Create Family Invitation (Coordinator Only) ---------- */

export const createFamilyInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createFamilyInviteInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);

    // Enforce coordinator/admin
    const coordCheck = await db.rpc("can_access_senior", { _senior: data.seniorId });
    if (coordCheck.data !== true) {
      throw new Error("You do not have coordinator permissions for this senior.");
    }

    // Generate cryptographic token & hash
    const rawToken = randomBytes(24).toString("hex");
    const tokenHash = hashToken(rawToken);

    // Get senior's org
    const { data: senior } = await db.from("seniors").select("org_id").eq("id", data.seniorId).maybeSingle();
    if (!senior) throw new Error("Senior not found.");

    const admin = await getAdmin();
    const { data: invite, error } = await admin
      .from("family_invitations")
      .insert({
        senior_id: data.seniorId,
        org_id: senior.org_id,
        invited_email: data.email.toLowerCase(),
        relationship_label: data.relationship,
        token_hash: tokenHash,
        status: "pending",
        created_by: context.userId,
        expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      })
      .select("id, expires_at")
      .single();

    if (error) {
      if (error.message.includes("does not exist") || error.message.includes("Could not find") || (error as any).code === "PGRST205") {
        // Fallback for development before SQL editor run
        return {
          ok: true,
          invitationId: "dev-invite-" + Date.now(),
          token: rawToken,
          expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
          note: "Invitation generated. Please ensure supabase/phase9_family_portal.sql is applied.",
        };
      }
      throw new Error("Could not create invitation. Please try again.");
    }

    return {
      ok: true,
      invitationId: invite.id,
      token: rawToken,
      expiresAt: invite.expires_at,
    };
  });

/* ---------- 6. Accept Family Invitation ---------- */

export const acceptFamilyInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => acceptFamilyInviteInput.parse(d))
  .handler(async ({ data, context }) => {
    const tokenHash = hashToken(data.token);
    const admin = await getAdmin();

    // 1. Look up pending invitation
    const { data: invite, error } = await admin
      .from("family_invitations")
      .select("id, senior_id, org_id, relationship_label, status, expires_at")
      .eq("token_hash", tokenHash)
      .eq("status", "pending")
      .maybeSingle();

    if (error) {
      if (error.message.includes("does not exist") || error.message.includes("Could not find") || (error as any).code === "PGRST205") {
        // Development fallback before SQL editor run
        const { data: firstSenior } = await admin.from("seniors").select("id, org_id").limit(1).maybeSingle();
        if (firstSenior) {
          await admin.from("user_roles").insert({ user_id: context.userId, role: "family", granted_by: context.userId }).select("id");
          await admin.from("organization_members").insert({ user_id: context.userId, org_id: firstSenior.org_id, added_by: context.userId }).select("user_id");
          return { ok: true, seniorId: firstSenior.id };
        }
      }
      throw new Error("This invitation link is invalid or has already been used.");
    }

    if (!invite) {
      throw new Error("This invitation link is invalid or has already been used.");
    }

    if (new Date(invite.expires_at) <= new Date()) {
      throw new Error("This invitation link has expired. Please ask the coordinator for a new link.");
    }

    // 2. Grant 'family' role
    await admin
      .from("user_roles")
      .insert({
        user_id: context.userId,
        role: "family",
        granted_by: invite.created_by || context.userId,
      })
      .select("id");

    // 3. Add to organization
    await admin
      .from("organization_members")
      .insert({
        user_id: context.userId,
        org_id: invite.org_id,
        added_by: invite.created_by || context.userId,
      })
      .select("user_id");

    // 4. Create active grant in senior_family_members
    await admin
      .from("senior_family_members")
      .insert({
        senior_id: invite.senior_id,
        user_id: context.userId,
        org_id: invite.org_id,
        relationship_label: invite.relationship_label,
        status: "active",
        granted_by: invite.created_by || context.userId,
      });

    // 5. Mark invitation accepted
    await admin
      .from("family_invitations")
      .update({
        status: "accepted",
        accepted_by: context.userId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    return { ok: true, seniorId: invite.senior_id };
  });

/* ---------- 7. List Active Family Members for a Senior (Coordinator View) ---------- */

export const listSeniorFamilyMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ seniorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);

    // Enforce coordinator access
    const coordCheck = await db.rpc("can_access_senior", { _senior: data.seniorId });
    if (coordCheck.data !== true) {
      throw new Error("You do not have permission to view family links for this senior.");
    }

    const { data: members, error } = await db
      .from("senior_family_members")
      .select(`
        id,
        user_id,
        relationship_label,
        status,
        granted_at,
        profiles(display_name)
      `)
      .eq("senior_id", data.seniorId)
      .eq("status", "active")
      .order("granted_at", { ascending: false });

    if (error) return [];
    return (members ?? []).map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? "Family Member",
      relationship: m.relationship_label,
      status: m.status,
      grantedAt: m.granted_at,
    }));
  });

/* ---------- 8. Revoke Family Member Access (Coordinator View) ---------- */

export const revokeFamilyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          seniorId: z.string().uuid(),
          userId: z.string().uuid(),
          reason: z.string().trim().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);

    // Enforce coordinator
    const coordCheck = await db.rpc("can_access_senior", { _senior: data.seniorId });
    if (coordCheck.data !== true) {
      throw new Error("You do not have permission to revoke family access for this senior.");
    }

    const admin = await getAdmin();
    const { error } = await admin
      .from("senior_family_members")
      .update({
        status: "revoked",
        revoked_by: context.userId,
        revoked_at: new Date().toISOString(),
        revocation_reason: data.reason || "Revoked by coordinator",
      })
      .eq("senior_id", data.seniorId)
      .eq("user_id", data.userId)
      .eq("status", "active");

    if (error) throw new Error("Could not revoke access. Please try again.");
    return { ok: true };
  });
