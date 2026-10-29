// Phase 6 server functions: operations summary, review queue, case detail, and
// workflow mutations. Every function requires an authenticated caller; reads
// run through the caller's RLS session (org-scoped by can_access_org policies)
// and mutations go through SECURITY DEFINER database functions that re-derive
// the actor and validate transitions. No client-supplied actor, org, or role
// is ever trusted.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type {
  FollowUpTaskEventRow,
  FollowUpTaskRow,
  OperationsSummary,
  QueueRow,
  ReviewCaseEventRow,
  ReviewCaseRow,
} from "@/lib/review";
import {
  compareQueueRows,
  isAssessmentStale,
  isTaskDueSoon,
  isTaskOverdue,
  selectCurrentAssessment,
  REVIEW_CASE_STATUSES,
  TASK_STATUSES,
} from "@/lib/review-workflow";
import { sanitizeSearch } from "@/lib/seniors";
import type { Assessment } from "@/risk/engine";

export const QUEUE_PAGE_SIZE = 25;
const MAX_QUEUE_CASES = 200; // bounded pre-join fetch; page size is what the UI shows
const STALE_DAYS = 7;

/* The generated Database types predate the Phase 6 tables, so table access is
 * cast through a minimal untyped shape. RLS still applies — this only loosens
 * compile-time table names, never row security. */
interface UntypedQuery {
  select(columns?: string, options?: { count?: "exact" }): UntypedQuery;
  eq(column: string, value: string): UntypedQuery;
  in(column: string, values: string[]): UntypedQuery;
  or(filter: string): UntypedQuery;
  order(column: string, options?: { ascending?: boolean }): UntypedQuery;
  range(from: number, to: number): UntypedQuery;
  limit(n: number): UntypedQuery;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  then<T>(
    onfulfilled: (value: {
      data: unknown;
      error: { message: string } | null;
      count: number | null;
    }) => T,
  ): Promise<T>;
}
type UntypedClient = { from(table: string): UntypedQuery };
const untyped = (c: unknown) => c as UntypedClient;

async function rpc<T>(client: unknown, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    client as {
      rpc: (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: T; error: { message: string } | null }>;
    }
  ).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/* ---------- Inputs ---------- */

const queueInput = z
  .object({
    page: z.number().int().min(0).default(0),
    search: z.string().max(80).default(""),
    status: z.enum(REVIEW_CASE_STATUSES).nullable().default(null),
    priority: z
      .enum([
        "unable_to_assess",
        "no_signal_detected",
        "review_suggested",
        "review_recommended",
        "prompt_review_recommended",
      ])
      .nullable()
      .default(null),
    dataQuality: z.enum(["adequate", "limited", "insufficient"]).nullable().default(null),
    assignee: z.string().uuid().nullable().default(null),
  })
  .strict();

const transitionCaseInput = z
  .object({
    caseId: z.string().uuid(),
    to: z.enum(REVIEW_CASE_STATUSES),
    reason: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

const createTaskInput = z
  .object({
    seniorId: z.string().uuid(),
    title: z.string().trim().min(2).max(160),
    notes: z.string().trim().max(2000).nullable().default(null),
    caseId: z.string().uuid().nullable().default(null),
    assignee: z.string().uuid().nullable().default(null),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    familyVisible: z.boolean().default(false),
  })
  .strict();

const transitionTaskInput = z
  .object({
    taskId: z.string().uuid(),
    to: z.enum(TASK_STATUSES),
    note: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

/* ---------- Operations summary ---------- */

export const getOperationsSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperationsSummary> => {
    const db = untyped(context.supabase);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString();

    const count = async (build: (q: UntypedQuery) => UntypedQuery, table: string) => {
      const { count: c, error } = await build(
        db.from(table).select("id", { count: "exact" }),
      ).limit(0);
      if (error) throw new Error(error.message);
      return c ?? 0;
    };

    const [awaitingReview, inReview, followUpRequired, overdueTasks, dueSoonTasks] =
      await Promise.all([
        count((q) => q.eq("status", "needs_review"), "review_cases"),
        count((q) => q.eq("status", "in_review"), "review_cases"),
        count((q) => q.eq("status", "follow_up_required"), "review_cases"),
        count(
          (q) => q.in("status", ["open", "in_progress"]).or(`due_at.lt.${now.toISOString()}`),
          "follow_up_tasks",
        ),
        count(
          (q) =>
            q
              .in("status", ["open", "in_progress"])
              .or(
                `due_at.gte.${now.toISOString()},due_at.lte.${new Date(now.getTime() + 48 * 3_600_000).toISOString()}`,
              ),
          "follow_up_tasks",
        ),
      ]);

    // Cases whose current assessment is insufficient or stale: fetch active
    // cases with their latest assessment timestamps and count in memory
    // (bounded by MAX_QUEUE_CASES so this stays cheap).
    const { data: activeCases, error: casesErr } = await db
      .from("review_cases")
      .select("id, senior_id, latest_assessment_id")
      .in("status", ["needs_review", "in_review", "follow_up_required"])
      .limit(MAX_QUEUE_CASES);
    if (casesErr) throw new Error(casesErr.message);
    const cases = (activeCases ?? []) as Pick<
      ReviewCaseRow,
      "id" | "senior_id" | "latest_assessment_id"
    >[];

    let insufficientOrStale = 0;
    if (cases.length > 0) {
      const { data: assessments, error: aErr } = await untyped(context.supabase)
        .from("risk_assessments")
        .select("id, data_quality, created_at")
        .in(
          "id",
          cases.map((c) => c.latest_assessment_id),
        );
      if (aErr) throw new Error(aErr.message);
      const byId = new Map(
        ((assessments ?? []) as { id: string; data_quality: string; created_at: string }[]).map(
          (a) => [a.id, a],
        ),
      );
      for (const c of cases) {
        const a = byId.get(c.latest_assessment_id);
        if (!a || a.data_quality === "insufficient" || a.created_at < staleBefore)
          insufficientOrStale += 1;
      }
    }

    return {
      awaitingReview,
      inReview,
      followUpRequired,
      overdueTasks,
      dueSoonTasks,
      insufficientOrStale,
    };
  });

/* ---------- Review queue ---------- */

export const listReviewQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => queueInput.parse(d))
  .handler(
    async ({ data, context }): Promise<{ rows: QueueRow[]; total: number; page: number }> => {
      const db = untyped(context.supabase);
      const search = sanitizeSearch(data.search);

      // 1. Active cases in the caller's org (RLS), with case-level filters.
      let caseQuery = db
        .from("review_cases")
        .select(
          "id, senior_id, status, assigned_to, priority_at_open, latest_assessment_id, opened_at",
        )
        .in("status", ["needs_review", "in_review", "follow_up_required"])
        .order("opened_at", { ascending: false })
        .limit(MAX_QUEUE_CASES);
      if (data.status) caseQuery = caseQuery.eq("status", data.status);
      if (data.assignee) caseQuery = caseQuery.eq("assigned_to", data.assignee);
      const { data: caseData, error: caseErr } = await caseQuery;
      if (caseErr) throw new Error(caseErr.message);
      let cases = (caseData ?? []) as Pick<
        ReviewCaseRow,
        | "id"
        | "senior_id"
        | "status"
        | "assigned_to"
        | "priority_at_open"
        | "latest_assessment_id"
        | "opened_at"
      >[];

      // 2. Seniors for those cases, with search applied server-side.
      let seniors: {
        id: string;
        display_name: string;
        record_code: string;
        is_synthetic: boolean;
      }[] = [];
      if (cases.length > 0) {
        let sQuery = context.supabase
          .from("seniors")
          .select("id, display_name, record_code, is_synthetic")
          .in(
            "id",
            cases.map((c) => c.senior_id),
          );
        if (search)
          sQuery = sQuery.or(`display_name.ilike.%${search}%,record_code.ilike.%${search}%`);
        const { data: sData, error: sErr } = await sQuery;
        if (sErr) throw new Error(sErr.message);
        seniors = sData ?? [];
        const keep = new Set(seniors.map((s) => s.id));
        cases = cases.filter((c) => keep.has(c.senior_id));
      }

      if (cases.length === 0) return { rows: [], total: 0, page: data.page };

      // 3. Latest assessment per case (already pinned on the case row).
      const { data: aData, error: aErr } = await untyped(context.supabase)
        .from("risk_assessments")
        .select("id, priority, data_quality, changed_domains, created_at")
        .in(
          "id",
          cases.map((c) => c.latest_assessment_id),
        );
      if (aErr) throw new Error(aErr.message);
      const assessmentById = new Map(
        (
          (aData ?? []) as {
            id: string;
            priority: QueueRow["priority"];
            data_quality: QueueRow["dataQuality"];
            changed_domains: string[];
            created_at: string;
          }[]
        ).map((a) => [a.id, a]),
      );

      // 4. Open tasks per case for due dates and counts.
      const { data: tData, error: tErr } = await db
        .from("follow_up_tasks")
        .select("review_case_id, due_at, status")
        .in(
          "review_case_id",
          cases.map((c) => c.id),
        )
        .in("status", ["open", "in_progress"]);
      if (tErr) throw new Error(tErr.message);
      const tasksByCase = new Map<string, { due_at: string | null; status: string }[]>();
      for (const t of (tData ?? []) as {
        review_case_id: string;
        due_at: string | null;
        status: string;
      }[]) {
        const list = tasksByCase.get(t.review_case_id) ?? [];
        list.push(t);
        tasksByCase.set(t.review_case_id, list);
      }

      // 5. Assignee display names via the existing privacy-preserving RPC.
      const assigneeIds = [
        ...new Set(cases.map((c) => c.assigned_to).filter((x): x is string => !!x)),
      ];
      const nameById = new Map<string, string>();
      if (assigneeIds.length > 0) {
        const names = await rpc<{ id: string; display_name: string }[]>(
          context.supabase,
          "profile_names",
          { _ids: assigneeIds },
        );
        for (const n of names ?? []) nameById.set(n.id, n.display_name);
      }

      const seniorById = new Map(seniors.map((s) => [s.id, s]));

      // 6. Join, apply assessment-level filters, sort deterministically.
      let rows: QueueRow[] = [];
      for (const c of cases) {
        const a = assessmentById.get(c.latest_assessment_id);
        const s = seniorById.get(c.senior_id);
        if (!a || !s) continue; // assessment unreadable for this caller — never fabricate
        const tasks = tasksByCase.get(c.id) ?? [];
        const dues = tasks
          .map((t) => t.due_at)
          .filter((d): d is string => !!d)
          .sort();
        rows.push({
          caseId: c.id,
          seniorId: c.senior_id,
          seniorName: s.display_name,
          recordCode: s.record_code,
          isSynthetic: s.is_synthetic,
          status: c.status,
          assignedTo: c.assigned_to,
          assigneeName: c.assigned_to ? (nameById.get(c.assigned_to) ?? null) : null,
          priority: a.priority,
          dataQuality: a.data_quality,
          changedDomains: a.changed_domains,
          assessedAt: a.created_at,
          openedAt: c.opened_at,
          nextTaskDueAt: dues[0] ?? null,
          openTaskCount: tasks.length,
        });
      }
      if (data.priority) rows = rows.filter((r) => r.priority === data.priority);
      if (data.dataQuality) rows = rows.filter((r) => r.dataQuality === data.dataQuality);
      rows.sort((a, b) =>
        compareQueueRows(
          { priority: a.priority, assessedAt: a.assessedAt, id: a.caseId },
          { priority: b.priority, assessedAt: b.assessedAt, id: b.caseId },
        ),
      );

      const total = rows.length;
      const start = data.page * QUEUE_PAGE_SIZE;
      return { rows: rows.slice(start, start + QUEUE_PAGE_SIZE), total, page: data.page };
    },
  );

/* ---------- Case detail ---------- */

export const getReviewCaseDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);
    const { data: caseData, error: caseErr } = await db
      .from("review_cases")
      .select("*")
      .eq("id", data.caseId)
      .maybeSingle();
    if (caseErr) throw new Error(caseErr.message);
    if (!caseData) throw new Error("This review case isn't available.");
    const reviewCase = caseData as ReviewCaseRow;

    const [seniorRes, assessmentRes, eventsRes, tasksRes] = await Promise.all([
      context.supabase
        .from("seniors")
        .select("id, display_name, record_code, time_zone, is_synthetic")
        .eq("id", reviewCase.senior_id)
        .maybeSingle(),
      untyped(context.supabase)
        .from("risk_assessments")
        .select(
          "id, reference_time, created_at, engine_version, ruleset_version, config_fingerprint, priority, data_quality, result",
        )
        .eq("id", reviewCase.latest_assessment_id)
        .maybeSingle(),
      db
        .from("review_case_events")
        .select("*")
        .eq("case_id", reviewCase.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(200),
      db
        .from("follow_up_tasks")
        .select("*")
        .eq("review_case_id", reviewCase.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (seniorRes.error) throw new Error(seniorRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    // A missing assessment row means the caller cannot read it — surface that
    // honestly instead of fabricating evidence.
    const assessment = assessmentRes.data as {
      id: string;
      reference_time: string;
      created_at: string;
      engine_version: string;
      ruleset_version: string;
      config_fingerprint: string;
      priority: string;
      data_quality: string;
      result: Json;
    } | null;

    // Is there a newer assessment than the one the case points at?
    const { data: newer } = await untyped(context.supabase)
      .from("risk_assessments")
      .select("id, created_at")
      .eq("senior_id", reviewCase.senior_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    const latest = selectCurrentAssessment((newer ?? []) as { id: string; created_at: string }[]);
    const superseded = !!assessment && !!latest && latest.id !== assessment.id;

    return {
      case: reviewCase,
      senior: seniorRes.data,
      assessment,
      assessmentResult: assessment ? (assessment.result as unknown as Assessment) : null,
      superseded,
      events: (eventsRes.data ?? []) as ReviewCaseEventRow[],
      tasks: (tasksRes.data ?? []) as FollowUpTaskRow[],
    };
  });

/* ---------- Mutations (SECURITY DEFINER RPCs; actor derived server-side) ---------- */

export const openReviewCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ seniorId: z.string().uuid(), assessmentId: z.string().uuid() }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const id = await rpc<string>(context.supabase, "open_review_case", {
      _senior: data.seniorId,
      _assessment: data.assessmentId,
    });
    return { caseId: id };
  });

export const transitionReviewCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => transitionCaseInput.parse(d))
  .handler(async ({ data, context }) => {
    await rpc<undefined>(context.supabase, "transition_review_case", {
      _case: data.caseId,
      _to: data.to,
      _reason: data.reason,
    });
    return { ok: true as const };
  });

export const assignReviewCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ caseId: z.string().uuid(), assignee: z.string().uuid().nullable() })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await rpc<undefined>(context.supabase, "assign_review_case", {
      _case: data.caseId,
      _assignee: data.assignee,
    });
    return { ok: true as const };
  });

export const createFollowUpTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const id = await rpc<string>(context.supabase, "create_follow_up_task", {
      _senior: data.seniorId,
      _title: data.title,
      _notes: data.notes,
      _case: data.caseId,
      _assignee: data.assignee,
      _due_at: data.dueAt,
    });
    if (data.familyVisible && id) {
      await (context.supabase as any)
        .from("follow_up_tasks")
        .update({ family_visible: true })
        .eq("id", id);
    }
    return { taskId: id };
  });

export const transitionFollowUpTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => transitionTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    await rpc<undefined>(context.supabase, "transition_follow_up_task", {
      _task: data.taskId,
      _to: data.to,
      _note: data.note,
    });
    return { ok: true as const };
  });

export const assignFollowUpTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ taskId: z.string().uuid(), assignee: z.string().uuid().nullable() })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await rpc<undefined>(context.supabase, "assign_follow_up_task", {
      _task: data.taskId,
      _assignee: data.assignee,
    });
    return { ok: true as const };
  });

/* ---------- Task list (follow-ups page) ---------- */

const taskListInput = z
  .object({
    page: z.number().int().min(0).default(0),
    search: z.string().max(80).default(""),
    status: z.enum(TASK_STATUSES).nullable().default(null),
    bucket: z.enum(["all", "overdue", "due_soon", "closed"]).default("all"),
  })
  .strict();

export const TASK_PAGE_SIZE = 25;

export const listFollowUpTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => taskListInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = untyped(context.supabase);
    const now = new Date();
    const search = sanitizeSearch(data.search);

    let q = db
      .from("follow_up_tasks")
      .select("*", { count: "exact" })
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.bucket === "overdue")
      q = q.in("status", ["open", "in_progress"]).or(`due_at.lt.${now.toISOString()}`);
    if (data.bucket === "due_soon")
      q = q
        .in("status", ["open", "in_progress"])
        .or(
          `due_at.gte.${now.toISOString()},due_at.lte.${new Date(now.getTime() + 48 * 3_600_000).toISOString()}`,
        );
    if (data.bucket === "closed") q = q.in("status", ["completed", "cancelled"]);
    const {
      data: tData,
      error: tErr,
      count,
    } = await q.range(data.page * TASK_PAGE_SIZE, data.page * TASK_PAGE_SIZE + TASK_PAGE_SIZE - 1);
    if (tErr) throw new Error(tErr.message);
    let tasks = (tData ?? []) as FollowUpTaskRow[];

    // Join senior names (for display + search) and assignee names.
    const seniorIds = [...new Set(tasks.map((t) => t.senior_id))];
    let seniors: { id: string; display_name: string; record_code: string }[] = [];
    if (seniorIds.length > 0) {
      const { data: sData, error: sErr } = await context.supabase
        .from("seniors")
        .select("id, display_name, record_code")
        .in("id", seniorIds);
      if (sErr) throw new Error(sErr.message);
      seniors = sData ?? [];
    }
    if (search) {
      const keep = new Set(
        seniors
          .filter(
            (s) =>
              s.display_name.toLowerCase().includes(search.toLowerCase()) ||
              s.record_code.toLowerCase().includes(search.toLowerCase()),
          )
          .map((s) => s.id),
      );
      tasks = tasks.filter(
        (t) => keep.has(t.senior_id) || t.title.toLowerCase().includes(search.toLowerCase()),
      );
    }
    const seniorById = new Map(seniors.map((s) => [s.id, s]));

    const assigneeIds = [
      ...new Set(tasks.map((t) => t.assigned_to).filter((x): x is string => !!x)),
    ];
    const nameById = new Map<string, string>();
    if (assigneeIds.length > 0) {
      const names = await rpc<{ id: string; display_name: string }[]>(
        context.supabase,
        "profile_names",
        { _ids: assigneeIds },
      );
      for (const n of names ?? []) nameById.set(n.id, n.display_name);
    }

    return {
      rows: tasks.map((t) => ({
        ...t,
        seniorName: seniorById.get(t.senior_id)?.display_name ?? "",
        recordCode: seniorById.get(t.senior_id)?.record_code ?? "",
        assigneeName: t.assigned_to ? (nameById.get(t.assigned_to) ?? null) : null,
        overdue: isTaskOverdue(t.due_at, t.status, now),
        dueSoon: isTaskDueSoon(t.due_at, t.status, now),
      })),
      total: count ?? 0,
      page: data.page,
    };
  });

/* ---------- Task events (history drawer) ---------- */

export const listAssigneeOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const assignees = await rpc<{ id: string; display_name: string }[]>(
        context.supabase,
        "org_assignees",
        {},
      );
      return assignees ?? [];
    } catch {
      return [];
    }
  });

export const listTaskEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ taskId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await untyped(context.supabase)
      .from("follow_up_task_events")
      .select("*")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return { events: (rows ?? []) as FollowUpTaskEventRow[] };
  });
