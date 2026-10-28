// Alerts list + reopen. Alerts are review cases; reads go through the caller's
// RLS session (org-scoped), mutations through SECURITY DEFINER RPCs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  compareQueueRows,
  REVIEW_CASE_STATUSES,
  selectCurrentAssessment,
} from "@/lib/review-workflow";
import type { ReviewCaseStatus } from "@/lib/review-workflow";
import { sanitizeSearch } from "@/lib/seniors";
import type { QualityStatus, ReviewPriority } from "@/risk/engine";

export const ALERT_PAGE_SIZE = 20;
const MAX_ALERTS = 300;

const PRIORITIES = [
  "unable_to_assess",
  "no_signal_detected",
  "review_suggested",
  "review_recommended",
  "prompt_review_recommended",
] as const;

export const listAlertsInput = z
  .object({
    page: z.number().int().min(0).default(0),
    search: z.string().max(80).default(""),
    status: z.enum(REVIEW_CASE_STATUSES).nullable().default(null),
    scope: z.enum(["active", "closed", "all"]).default("active"),
    priority: z.enum(PRIORITIES).nullable().default(null),
    assignee: z
      .union([z.string().uuid(), z.literal("unassigned"), z.literal("me")])
      .nullable()
      .default(null),
    from: z.string().date().nullable().default(null),
    to: z.string().date().nullable().default(null),
    sort: z.enum(["priority", "newest", "updated"]).default("priority"),
  })
  .strict();

export interface AlertRow {
  caseId: string;
  seniorId: string;
  seniorName: string;
  recordCode: string;
  timeZone: string;
  isSynthetic: boolean;
  status: ReviewCaseStatus;
  assignedTo: string | null;
  assigneeName: string | null;
  priority: ReviewPriority;
  priorityAtOpen: ReviewPriority;
  dataQuality: QualityStatus;
  changedDomains: string[];
  assessmentId: string;
  assessedAt: string;
  openedAt: string;
  updatedAt: string;
}

type Res = { data: unknown; error: { message: string } | null };
type Q = {
  select(c: string): Q;
  eq(c: string, v: string): Q;
  in(c: string, v: readonly string[]): Q;
  is(c: string, v: null): Q;
  gte(c: string, v: string): Q;
  lt(c: string, v: string): Q;
  or(f: string): Q;
  order(c: string, o?: { ascending?: boolean }): Q;
  limit(n: number): Q;
  then<T>(f: (r: Res) => T): Promise<T>;
};
const db = (c: unknown) => c as { from(t: string): Q; rpc(f: string, a: object): Promise<Res> };

export const listAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listAlertsInput.parse(d))
  .handler(
    async ({ data, context }): Promise<{ rows: AlertRow[]; total: number; page: number }> => {
      const c = db(context.supabase);
      let q = c
        .from("review_cases")
        .select(
          "id, senior_id, status, assigned_to, priority_at_open, latest_assessment_id, opened_at, updated_at",
        )
        .order("opened_at", { ascending: false })
        .limit(MAX_ALERTS);
      if (data.status) q = q.eq("status", data.status);
      else if (data.scope === "active")
        q = q.in("status", ["needs_review", "in_review", "follow_up_required"]);
      else if (data.scope === "closed") q = q.in("status", ["resolved", "dismissed"]);
      if (data.assignee === "unassigned") q = q.is("assigned_to", null);
      else if (data.assignee === "me") q = q.eq("assigned_to", context.userId);
      else if (data.assignee) q = q.eq("assigned_to", data.assignee);
      if (data.from) q = q.gte("opened_at", `${data.from}T00:00:00Z`);
      if (data.to)
        q = q.lt(
          "opened_at",
          new Date(Date.parse(`${data.to}T00:00:00Z`) + 86_400_000).toISOString(),
        );
      const { data: caseData, error } = await q;
      if (error) throw new Error(error.message);
      let cases = (caseData ?? []) as {
        id: string;
        senior_id: string;
        status: ReviewCaseStatus;
        assigned_to: string | null;
        priority_at_open: ReviewPriority;
        latest_assessment_id: string;
        opened_at: string;
        updated_at: string;
      }[];
      if (cases.length === 0) return { rows: [], total: 0, page: data.page };

      const search = sanitizeSearch(data.search);
      let sq = c
        .from("seniors")
        .select("id, display_name, record_code, time_zone, is_synthetic")
        .in("id", [...new Set(cases.map((x) => x.senior_id))]);
      if (search) sq = sq.or(`display_name.ilike.%${search}%,record_code.ilike.%${search}%`);
      const { data: sData, error: sErr } = await sq;
      if (sErr) throw new Error(sErr.message);
      const seniors = new Map(
        (
          (sData ?? []) as {
            id: string;
            display_name: string;
            record_code: string;
            time_zone: string;
            is_synthetic: boolean;
          }[]
        ).map((s) => [s.id, s]),
      );
      cases = cases.filter((x) => seniors.has(x.senior_id));
      if (cases.length === 0) return { rows: [], total: 0, page: data.page };

      const { data: aData, error: aErr } = await c
        .from("risk_assessments")
        .select("id, priority, data_quality, changed_domains, created_at")
        .in("id", [...new Set(cases.map((x) => x.latest_assessment_id))]);
      if (aErr) throw new Error(aErr.message);
      const assessments = new Map(
        (
          (aData ?? []) as {
            id: string;
            priority: ReviewPriority;
            data_quality: QualityStatus;
            changed_domains: string[];
            created_at: string;
          }[]
        ).map((a) => [a.id, a]),
      );

      const ids = [...new Set(cases.map((x) => x.assigned_to).filter((x): x is string => !!x))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: n, error: nErr } = await c.rpc("profile_names", { _ids: ids });
        if (nErr) throw new Error(nErr.message);
        for (const r of (n ?? []) as { id: string; display_name: string }[])
          names.set(r.id, r.display_name);
      }

      let rows: AlertRow[] = [];
      for (const x of cases) {
        const a = assessments.get(x.latest_assessment_id);
        const s = seniors.get(x.senior_id)!;
        if (!a) continue; // unreadable evidence is never fabricated
        rows.push({
          caseId: x.id,
          seniorId: x.senior_id,
          seniorName: s.display_name,
          recordCode: s.record_code,
          timeZone: s.time_zone,
          isSynthetic: s.is_synthetic,
          status: x.status,
          assignedTo: x.assigned_to,
          assigneeName: x.assigned_to ? (names.get(x.assigned_to) ?? null) : null,
          priority: a.priority,
          priorityAtOpen: x.priority_at_open,
          dataQuality: a.data_quality,
          changedDomains: a.changed_domains ?? [],
          assessmentId: a.id,
          assessedAt: a.created_at,
          openedAt: x.opened_at,
          updatedAt: x.updated_at,
        });
      }
      if (data.priority) rows = rows.filter((r) => r.priority === data.priority);
      rows.sort((a, b) =>
        data.sort === "newest"
          ? b.openedAt.localeCompare(a.openedAt) || a.caseId.localeCompare(b.caseId)
          : data.sort === "updated"
            ? b.updatedAt.localeCompare(a.updatedAt) || a.caseId.localeCompare(b.caseId)
            : compareQueueRows(
                { priority: a.priority, assessedAt: a.assessedAt, id: a.caseId },
                { priority: b.priority, assessedAt: b.assessedAt, id: b.caseId },
              ),
      );
      const start = data.page * ALERT_PAGE_SIZE;
      return {
        rows: rows.slice(start, start + ALERT_PAGE_SIZE),
        total: rows.length,
        page: data.page,
      };
    },
  );

/**
 * Reopen = a new alert linked to the senior's newest assessment. Closed alerts
 * and their history stay untouched (open_review_case is idempotent).
 */
export const reopenAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ seniorId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const c = db(context.supabase);
    const { data: a, error } = await c
      .from("risk_assessments")
      .select("id, created_at")
      .eq("senior_id", data.seniorId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const latest = selectCurrentAssessment((a ?? []) as { id: string; created_at: string }[]);
    if (!latest) throw new Error("There's no assessment to reopen this alert against.");
    const r = await c.rpc("open_review_case", { _senior: data.seniorId, _assessment: latest.id });
    if (r.error) throw new Error(r.error.message);
    return { caseId: r.data as string };
  });
