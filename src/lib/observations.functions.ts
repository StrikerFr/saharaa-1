// Observations server functions: single authorized entry point for recording,
// correcting, and evaluating observations. Enforces database value CHECK constraints,
// actor permissions, idempotency via client_request_id, and immediately drives the
// downstream risk evaluation and alerting pipeline.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateSeniorRiskAndAlerts, type EvaluationResult } from "@/lib/risk.functions";

export const OBSERVATION_TYPES_LIST = [
  "heart_rate",
  "blood_pressure",
  "weight",
  "sleep_duration",
  "mobility",
  "appetite",
  "hydration",
  "medication_event",
  "care_note",
] as const;

export const DATA_SOURCES_LIST = [
  "manual_entry",
  "reported_by_senior",
  "reported_by_family",
  "device",
  "imported",
] as const;

export const recordObservationInput = z
  .object({
    seniorId: z.string().uuid(),
    type: z.enum(OBSERVATION_TYPES_LIST),
    valueNumeric: z.number().nullable().optional(),
    valueNumeric2: z.number().nullable().optional(),
    valueText: z.string().max(40).nullable().optional(),
    unit: z.string().max(10).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    observedAt: z.string().datetime({ offset: true }),
    source: z.enum(DATA_SOURCES_LIST).default("manual_entry"),
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const correctObservationInput = z
  .object({
    seniorId: z.string().uuid(),
    originalObservationId: z.string().uuid(),
    type: z.enum(OBSERVATION_TYPES_LIST),
    valueNumeric: z.number().nullable().optional(),
    valueNumeric2: z.number().nullable().optional(),
    valueText: z.string().max(40).nullable().optional(),
    unit: z.string().max(10).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    correctionReason: z.string().trim().min(3).max(500),
    observedAt: z.string().datetime({ offset: true }),
    clientRequestId: z.string().uuid(),
  })
  .strict();

/** Validates shape against database observation_value_shape CHECK constraint. */
export function validateObservationShape(d: {
  type: (typeof OBSERVATION_TYPES_LIST)[number];
  valueNumeric?: number | null | undefined;
  valueNumeric2?: number | null | undefined;
  valueText?: string | null | undefined;
  unit?: string | null | undefined;
  note?: string | null | undefined;
}): { valid: boolean; error?: string } {
  const v1 = d.valueNumeric ?? null;
  const v2 = d.valueNumeric2 ?? null;
  const vt = d.valueText ?? null;
  const u = d.unit ?? null;
  const n = d.note ?? "";

  switch (d.type) {
    case "heart_rate":
      if (u !== "bpm" || v1 == null || v1 < 20 || v1 > 250 || v2 != null || vt != null)
        return { valid: false, error: "Heart rate must be between 20 and 250 bpm." };
      return { valid: true };

    case "blood_pressure":
      if (
        u !== "mmHg" ||
        v1 == null ||
        v1 < 50 ||
        v1 > 260 ||
        v2 == null ||
        v2 < 30 ||
        v2 > 160 ||
        v1 <= v2 ||
        vt != null
      )
        return {
          valid: false,
          error:
            "Blood pressure must have systolic (50-260) strictly greater than diastolic (30-160) in mmHg.",
        };
      return { valid: true };

    case "weight":
      if (u !== "kg" || v1 == null || v1 < 20 || v1 > 300 || v2 != null || vt != null)
        return { valid: false, error: "Weight must be between 20 and 300 kg." };
      return { valid: true };

    case "sleep_duration":
      if (u !== "h" || v1 == null || v1 < 0 || v1 > 24 || v2 != null || vt != null)
        return { valid: false, error: "Sleep duration must be between 0 and 24 hours." };
      return { valid: true };

    case "mobility":
      if (
        u != null ||
        v1 != null ||
        v2 != null ||
        !["independent", "uses_aid", "needs_assistance", "bed_bound"].includes(vt ?? "")
      )
        return { valid: false, error: "Mobility must be one of the permitted categories." };
      return { valid: true };

    case "appetite":
    case "hydration":
      if (
        u != null ||
        v1 != null ||
        v2 != null ||
        !["usual", "reduced", "increased", "refused"].includes(vt ?? "")
      )
        return { valid: false, error: `${d.type} must be usual, reduced, increased, or refused.` };
      return { valid: true };

    case "medication_event":
      if (
        u != null ||
        v1 != null ||
        v2 != null ||
        !["taken", "partially_taken", "missed", "refused"].includes(vt ?? "")
      )
        return { valid: false, error: "Medication event must be taken, partially taken, missed, or refused." };
      return { valid: true };

    case "care_note":
      if (u != null || v1 != null || v2 != null || vt != null || n.trim().length < 3)
        return { valid: false, error: "Care notes must contain at least 3 characters." };
      return { valid: true };

    default:
      return { valid: false, error: "Unknown observation type." };
  }
}

/**
 * Record an observation:
 * 1. Authenticate caller and verify senior access.
 * 2. Validate observation value shape and units.
 * 3. Persist to public.observations (idempotent by client_request_id).
 * 4. Run downstream evaluation pipeline (risk assessment + alerts).
 * 5. Return persisted observation and derived evaluation status.
 */
export const recordObservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => recordObservationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Verify access
    const { data: allowed, error: accErr } = await supabase.rpc("can_access_senior", {
      _senior: data.seniorId,
    });
    if (accErr || allowed !== true) {
      throw new Error("You don't have permission to record observations for this senior.");
    }

    // 2. Validate shape
    const check = validateObservationShape(data);
    if (!check.valid) {
      throw new Error(check.error || "Invalid observation values.");
    }

    // 3. Persist observation with idempotency
    let observationId: string;
    let recordedAt: string;
    const { data: inserted, error: insErr } = await supabase
      .from("observations")
      .insert({
        senior_id: data.seniorId,
        type: data.type,
        value_numeric: data.valueNumeric ?? null,
        value_numeric_2: data.valueNumeric2 ?? null,
        value_text: data.valueText ?? null,
        unit: data.unit ?? null,
        note: data.note ?? null,
        observed_at: data.observedAt,
        source: data.source,
        verification: "unverified",
        client_request_id: data.clientRequestId,
      })
      .select("id, recorded_at")
      .single();

    if (insErr) {
      // Idempotency: duplicate key on client_request_id returns the existing row
      if (insErr.code === "23505" || insErr.message.includes("client_request_id")) {
        const { data: existing, error: getErr } = await supabase
          .from("observations")
          .select("id, recorded_at")
          .eq("client_request_id", data.clientRequestId)
          .single();
        if (getErr || !existing) throw insErr;
        observationId = existing.id;
        recordedAt = existing.recorded_at;
      } else {
        throw new Error(insErr.message);
      }
    } else {
      observationId = inserted.id;
      recordedAt = inserted.recorded_at;
    }

    // 4. Downstream Evaluation Pipeline (zero-delay, reliable retry)
    let evaluation: EvaluationResult | null = null;
    try {
      evaluation = await evaluateSeniorRiskAndAlerts({
        supabase,
        seniorId: data.seniorId,
        userId,
        referenceTime: data.observedAt,
        bypassThrottle: true,
      });
    } catch {
      // If downstream evaluation throws, observation is preserved; report status
      evaluation = null;
    }

    return {
      ok: true as const,
      observationId,
      recordedAt,
      evaluation: evaluation
        ? {
            assessmentId: evaluation.assessmentId,
            priority: evaluation.priority,
            dataQuality: evaluation.dataQuality,
            changedDomains: evaluation.changedDomains,
            alert: evaluation.alert,
            caseId: evaluation.caseId,
          }
        : null,
    };
  });

/**
 * Correct an observation in an append-only architecture:
 * 1. Validates that original observation exists.
 * 2. Appends new observation with explicit correction note.
 * 3. Logs an audited correction event in audit_events.
 * 4. Re-runs downstream evaluation to recalculate derived results.
 */
export const correctObservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => correctObservationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Verify access
    const { data: allowed, error: accErr } = await supabase.rpc("can_access_senior", {
      _senior: data.seniorId,
    });
    if (accErr || allowed !== true) {
      throw new Error("You don't have permission to modify records for this senior.");
    }

    // 2. Fetch original observation to preserve provenance
    const { data: orig, error: origErr } = await supabase
      .from("observations")
      .select("*")
      .eq("id", data.originalObservationId)
      .eq("senior_id", data.seniorId)
      .maybeSingle();

    if (origErr || !orig) {
      throw new Error("Original observation not found for this senior.");
    }

    // 3. Validate new shape
    const check = validateObservationShape(data);
    if (!check.valid) {
      throw new Error(check.error || "Invalid observation values.");
    }

    // 4. Append the corrected observation
    const correctedNote = `[Correction: ${data.correctionReason}] ${data.note || ""}`.trim();
    const { data: inserted, error: insErr } = await supabase
      .from("observations")
      .insert({
        senior_id: data.seniorId,
        type: data.type,
        value_numeric: data.valueNumeric ?? null,
        value_numeric_2: data.valueNumeric2 ?? null,
        value_text: data.valueText ?? null,
        unit: data.unit ?? null,
        note: correctedNote,
        observed_at: data.observedAt,
        source: "manual_entry",
        verification: "unverified",
        client_request_id: data.clientRequestId,
      })
      .select("id, recorded_at")
      .single();

    if (insErr) {
      if (insErr.code === "23505" || insErr.message.includes("client_request_id")) {
        const { data: existing } = await supabase
          .from("observations")
          .select("id, recorded_at")
          .eq("client_request_id", data.clientRequestId)
          .single();
        if (existing) return { ok: true as const, observationId: existing.id, recordedAt: existing.recorded_at, evaluation: null };
      }
      throw new Error(insErr.message);
    }

    // 5. Audit log the correction
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("audit_events").insert({
        actor_id: userId,
        action: "observation.corrected",
        resource_type: "observations",
        resource_id: inserted.id,
        outcome: "success",
        metadata: {
          senior_id: data.seniorId,
          original_id: data.originalObservationId,
          reason: data.correctionReason,
          previous: {
            value_numeric: orig.value_numeric,
            value_numeric_2: orig.value_numeric_2,
            value_text: orig.value_text,
            unit: orig.unit,
            observed_at: orig.observed_at,
          },
          corrected: {
            value_numeric: data.valueNumeric,
            value_numeric_2: data.valueNumeric2,
            value_text: data.valueText,
            unit: data.unit,
            observed_at: data.observedAt,
          },
        },
      });
    } catch {
      // Non-fatal audit log catch
    }

    // 6. Recalculate downstream evaluation
    let evaluation: EvaluationResult | null = null;
    try {
      evaluation = await evaluateSeniorRiskAndAlerts({
        supabase,
        seniorId: data.seniorId,
        userId,
        referenceTime: data.observedAt,
        bypassThrottle: true,
      });
    } catch {
      evaluation = null;
    }

    return {
      ok: true as const,
      observationId: inserted.id,
      recordedAt: inserted.recorded_at,
      evaluation: evaluation
        ? {
            assessmentId: evaluation.assessmentId,
            priority: evaluation.priority,
            dataQuality: evaluation.dataQuality,
            changedDomains: evaluation.changedDomains,
            alert: evaluation.alert,
            caseId: evaluation.caseId,
          }
        : null,
    };
  });
