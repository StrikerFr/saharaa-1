// AI wellbeing summary for one senior. Reads only through the caller's RLS
// session (so it can never see more than the profile page shows), calls Groq
// server-side, and returns an unverified narrative. Nothing is persisted.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSummaryPrompt,
  parseSummary,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SCHEMA_VERSION,
  SUMMARY_SYSTEM_PROMPT,
  type SummaryInput,
  type WellbeingSummary,
} from "@/lib/ai/summary";
import { ProviderError, userMessage } from "@/lib/ai/provider-errors";
import { formatObservationValue, OBSERVATION_TYPES, type ObservationRow } from "@/lib/seniors";

const WINDOW_DAYS = 14;

export type SummaryResult =
  | {
      ok: true;
      summary: WellbeingSummary;
      model: string;
      schemaVersion: string;
      generatedAt: string;
      observationCount: number;
      windowDays: number;
    }
  | { ok: false; message: string };

export const generateWellbeingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ seniorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SummaryResult> => {
    const db = context.supabase;
    const { data: senior, error: sErr } = await db
      .from("seniors")
      .select("id, time_zone")
      .eq("id", data.seniorId)
      .maybeSingle();
    if (sErr || !senior) return { ok: false, message: "You don't have access to this senior." };

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const [obs, assess, kase] = await Promise.all([
      db
        .from("observations")
        .select("id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, source, verification")
        .eq("senior_id", data.seniorId)
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(120),
      db
        .from("risk_assessments")
        .select("priority, data_quality, changed_domains, created_at")
        .eq("senior_id", data.seniorId)
        .order("created_at", { ascending: false })
        .limit(1),
      db
        .from("review_cases")
        .select("status")
        .eq("senior_id", data.seniorId)
        .in("status", ["needs_review", "in_review", "follow_up_required"])
        .limit(1),
    ]);
    if (obs.error || assess.error || kase.error)
      return { ok: false, message: "Couldn't read this person's records." };

    const rows = (obs.data ?? []) as unknown as ObservationRow[];
    if (rows.length === 0)
      return {
        ok: false,
        message: `No observations in the last ${WINDOW_DAYS} days, so there is nothing to summarise. No data is not the same as well.`,
      };

    const input: SummaryInput = {
      now: new Date().toISOString(),
      timeZone: senior.time_zone,
      observations: rows.map((o) => ({
        id: o.id,
        type: OBSERVATION_TYPES[o.type].label,
        value: o.type === "care_note" ? (o.note ?? "") : `${formatObservationValue(o)}${o.note ? ` — note: ${o.note}` : ""}`,
        observed_at: o.observed_at,
        source: o.source,
        verification: o.verification,
      })),
      assessment: (assess.data?.[0] as SummaryInput["assessment"]) ?? null,
      openCaseStatus: (kase.data?.[0] as { status: string } | undefined)?.status ?? null,
    };
    const ids = new Set(rows.map((r) => r.id));

    try {
      const { groqConfig, summarize } = await import("@/lib/ai/groq.server");
      const r = await summarize(
        SUMMARY_SYSTEM_PROMPT,
        buildSummaryPrompt(input),
        SUMMARY_JSON_SCHEMA,
        (raw) => parseSummary(raw, ids).ok,
        groqConfig(),
      );
      const parsed = parseSummary(r.raw, ids);
      if (!parsed.ok) return { ok: false, message: "The AI summary didn't pass safety checks. Try again." };
      return {
        ok: true,
        summary: parsed.value,
        model: r.model,
        schemaVersion: SUMMARY_SCHEMA_VERSION,
        generatedAt: input.now,
        observationCount: rows.length,
        windowDays: WINDOW_DAYS,
      };
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof ProviderError
            ? e.code === "invalid_output"
              ? "The AI summary didn't pass safety checks. Try again."
              : userMessage(e)
            : "The summary couldn't be generated. Try again.",
      };
    }
  });
