import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_RISK_CONFIG } from "@/risk/config";
import {
  assess,
  lookbackStart,
  type EngineObservation,
  type QualityStatus,
  type ReviewPriority,
} from "@/risk/engine";

const MAX_OBSERVATIONS = 5000;
const MAX_HISTORY_DAYS = 365;

export const runRiskAssessmentInput = z
  .object({
    seniorId: z.string().uuid(),
    /** Optional historical reference time; never in the future, at most a year back. */
    referenceTime: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export interface EvaluationResult {
  assessmentId: string;
  priority: ReviewPriority;
  dataQuality: QualityStatus;
  changedDomains: string[];
  alert: "opened_or_updated" | "updated" | "none" | "failed";
  caseId?: string | null;
}

/**
 * Shared evaluation pipeline: computes and persists one assessment for a senior,
 * and immediately triggers or updates alerts via idempotent open_review_case.
 */
export async function evaluateSeniorRiskAndAlerts({
  supabase,
  seniorId,
  userId,
  referenceTime: rawReferenceTime,
  bypassThrottle = false,
}: {
  supabase: any;
  seniorId: string;
  userId: string;
  referenceTime?: string | undefined;
  bypassThrottle?: boolean | undefined;
}): Promise<EvaluationResult> {
  const now = Date.now();
  const T = rawReferenceTime ? Date.parse(rawReferenceTime) : now;
  if (T > now + 60_000 || T < now - MAX_HISTORY_DAYS * 86_400_000)
    throw new Error("Choose a reference time within the past year.");
  const referenceTime = new Date(T).toISOString();

  const [{ data: senior }, { data: allowed }] = await Promise.all([
    supabase.from("seniors").select("id, time_zone").eq("id", seniorId).maybeSingle(),
    supabase.rpc("can_access_senior", { _senior: seniorId }),
  ]);
  if (!senior || allowed !== true) {
    await supabase.rpc("log_risk_assessment_denied", { _senior: seniorId });
    throw new Error("This profile isn't available.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (!bypassThrottle) {
    // Light throttle for manual user clicks: one run per senior per user every 10 seconds.
    const { data: recent } = await supabaseAdmin
      .from("risk_assessments")
      .select("id")
      .eq("senior_id", senior.id)
      .eq("created_by", userId)
      .gt("created_at", new Date(now - 10_000).toISOString())
      .limit(1);
    if (recent && recent.length)
      throw new Error("An assessment was just run. Please wait a moment.");
  }

  const [obs, base] = await Promise.all([
    supabase
      .from("observations")
      .select(
        "id, type, value_numeric, value_numeric_2, value_text, unit, observed_at, recorded_at, source, verification",
      )
      .eq("senior_id", senior.id)
      .gt("observed_at", lookbackStart(referenceTime))
      .lte("observed_at", referenceTime)
      .lte("recorded_at", referenceTime)
      .order("observed_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_OBSERVATIONS + 1),
    supabase
      .from("senior_baselines")
      .select("field, status, value_numeric, value_numeric_2, unit, captured_at, recorded_at")
      .eq("senior_id", senior.id)
      .lte("captured_at", referenceTime)
      .lte("recorded_at", referenceTime)
      .limit(500),
  ]);
  if (obs.error || base.error) throw new Error("Couldn't load observations for this assessment.");
  if ((obs.data ?? []).length > MAX_OBSERVATIONS)
    throw new Error("Too many observations in the window to assess safely.");

  const a = assess(
    {
      seniorId: senior.id,
      timeZone: senior.time_zone,
      referenceTime,
      observations: (obs.data ?? []).map((o: any) => ({
        ...o,
        value_numeric: o.value_numeric == null ? null : Number(o.value_numeric),
        value_numeric_2: o.value_numeric_2 == null ? null : Number(o.value_numeric_2),
      })) as EngineObservation[],
      baselines: (base.data ?? []).map((b: any) => ({
        ...b,
        value_numeric: b.value_numeric == null ? null : Number(b.value_numeric),
        value_numeric_2: b.value_numeric_2 == null ? null : Number(b.value_numeric_2),
      })),
    },
    DEFAULT_RISK_CONFIG,
  );

  const { data: row, error } = await supabaseAdmin
    .from("risk_assessments")
    .insert({
      senior_id: senior.id,
      org_id: "00000000-0000-0000-0000-000000000000", // replaced by trigger from the senior record
      reference_time: a.referenceTime,
      engine_version: a.engineVersion,
      ruleset_version: a.rulesetVersion,
      config_fingerprint: a.configFingerprint,
      input_digest: a.inputDigest,
      priority: a.priority,
      data_quality: a.dataQuality.status,
      changed_domains: a.changedDomains,
      result: JSON.parse(JSON.stringify(a)),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error("Couldn't save the assessment.");

  // Alerting: raise or refresh the senior's alert as the caller (RLS +
  // SECURITY DEFINER open_review_case, which is idempotent per senior). A
  // failure here never discards the saved assessment; it is reported.
  let alert: "opened_or_updated" | "updated" | "none" | "failed" = "none";
  let caseId: string | null = null;
  try {
    const { alertActionForPriority } = await import("@/lib/alerts");
    const action = alertActionForPriority(a.priority);
    const rpc = (args: object) =>
      (supabase.rpc as unknown as (f: string, a: object) => Promise<{ data: string | null; error: unknown }>)(
        "open_review_case",
        args,
      );
    if (action === "open") {
      const r = await rpc({ _senior: senior.id, _assessment: row.id });
      if (r.error) {
        alert = "failed";
      } else {
        alert = "opened_or_updated";
        caseId = r.data ?? null;
      }
    } else {
      const { data: active } = await (
        supabase as unknown as {
          from(t: string): {
            select(c: string): {
              eq(
                c: string,
                v: string,
              ): {
                in(
                  c: string,
                  v: string[],
                ): { limit(n: number): Promise<{ data: { id: string }[] | null }> };
              };
            };
          };
        }
      )
        .from("review_cases")
        .select("id")
        .eq("senior_id", senior.id)
        .in("status", ["needs_review", "in_review", "follow_up_required"])
        .limit(1);
      if (active && active.length) {
        const r = await rpc({ _senior: senior.id, _assessment: row.id });
        if (r.error) {
          alert = "failed";
        } else {
          alert = "updated";
          caseId = r.data ?? active[0]?.id ?? null;
        }
      }
    }
  } catch {
    alert = "failed";
  }

  return {
    assessmentId: row.id,
    priority: a.priority,
    dataQuality: a.dataQuality.status,
    changedDomains: a.changedDomains,
    alert,
    caseId,
  };
}

/**
 * Compute and persist one assessment for one senior. The configuration is fixed server-side
 * (clients cannot send thresholds or versions). Reads go through the caller's RLS session;
 * only the final append-only insert uses the service role, after access is confirmed.
 */
export const runRiskAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => runRiskAssessmentInput.parse(d))
  .handler(async ({ data, context }) => {
    const res = await evaluateSeniorRiskAndAlerts({
      supabase: context.supabase,
      seniorId: data.seniorId,
      userId: context.userId,
      referenceTime: data.referenceTime,
      bypassThrottle: false,
    });
    return { id: res.assessmentId, alert: res.alert, caseId: res.caseId };
  });
