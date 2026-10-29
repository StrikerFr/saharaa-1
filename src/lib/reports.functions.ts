// Phase 7 server functions: care reports (typed or voice), AI cue extraction,
// human review, and read-back of confirmed content. Every function requires an
// authenticated caller; reads use the caller's RLS session; human decisions go
// through SECURITY DEFINER functions as the caller; machine outputs are written
// by service-role functions only after access was verified for the caller.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AUDIO_REASON_MESSAGES, checkAudio } from "@/lib/ai/audio";
import { candidateCueSchema } from "@/lib/ai/cues";
import { ProviderError, userMessage } from "@/lib/ai/provider-errors";
import type { CareReportRow, ReportCueRow, ReportEventRow } from "@/lib/reports";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpcOf = (c: unknown) => (c as { rpc: Rpc }).rpc.bind(c);
interface Q {
  select(c: string): Q;
  eq(c: string, v: string): Q;
  order(c: string, o?: { ascending?: boolean }): Q;
  limit(n: number): Q;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  then<T>(f: (v: { data: unknown; error: { message: string } | null }) => T): Promise<T>;
}
const from = (c: unknown, t: string) => (c as { from(t: string): Q }).from(t);

function dbMessage(e: { message: string; code?: string }): string {
  const m = e.message;
  if (m.includes("report_rate_limited"))
    return "Too many reports in the last hour. Try again later.";
  if (e.code === "42501" || m.includes("forbidden")) return "You don't have access to this senior.";
  if (m.includes("no longer pending"))
    return "This suggestion was already reviewed. Reload to see the latest.";
  if (m.includes("already confirmed"))
    return "A suggestion from this report is already confirmed, so the transcript can't change.";
  if (m.includes("already reviewed")) return "This report is fully reviewed.";
  if (m.includes("relation") && m.includes("does not exist"))
    return "Reports aren't set up in the database yet. An administrator needs to apply the Phase 7 database update.";
  if (e.code === "23514")
    return "Some values are outside the allowed range. Check the fields and try again.";
  return "Couldn't save. Nothing was changed — please try again.";
}

async function call(client: unknown, f: string, a: Record<string, unknown>) {
  const { data, error } = await rpcOf(client)(f, a);
  if (error) throw new Error(dbMessage(error));
  return data;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function assertSenior(supabase: unknown, seniorId: string) {
  const ok = await rpcOf(supabase)("can_access_senior", { _senior: seniorId });
  if (ok.data !== true) throw new Error("This profile isn't available.");
}

async function loadReport(supabase: unknown, reportId: string) {
  const { data, error } = await from(supabase, "care_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(dbMessage(error));
  if (!data) throw new Error("This report isn't available.");
  return data as CareReportRow;
}

/* ---------- Status ---------- */

export const getAiProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    // Presence of configuration only; not proof the account accepts requests.
    llm: Boolean(process.env["GROQ_API_KEY"]),
    stt: Boolean(process.env["GROQ_API_KEY"]),
    tts: Boolean(
      process.env["ELEVENLABS_API_KEY"] &&
      process.env["ELEVENLABS_TTS_MODEL_ID"] &&
      process.env["ELEVENLABS_VOICE_ID"],
    ),
    llmModel: process.env["GROQ_LLM_MODEL"] || "openai/gpt-oss-20b",
    sttModel: process.env["GROQ_STT_MODEL"] || "whisper-large-v3-turbo",
  }));

/* ---------- Reads ---------- */

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ seniorId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await from(context.supabase, "care_reports")
      .select(
        "id, source_type, status, submitted_at, event_time, declared_language, reporter_relation",
      )
      .eq("senior_id", data.seniorId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    if (r.error) throw new Error(dbMessage(r.error));
    return (r.data ?? []) as Pick<
      CareReportRow,
      | "id"
      | "source_type"
      | "status"
      | "submitted_at"
      | "event_time"
      | "declared_language"
      | "reporter_relation"
    >[];
  });

export const getReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reportId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const report = await loadReport(context.supabase, data.reportId);
    const [cues, events] = await Promise.all([
      from(context.supabase, "report_cues")
        .select("*")
        .eq("report_id", report.id)
        .order("attempt")
        .order("position"),
      from(context.supabase, "care_report_events")
        .select("*")
        .eq("report_id", report.id)
        .order("at")
        .limit(200),
    ]);
    if (cues.error || events.error) throw new Error("Couldn't load this report.");
    // Re-validate stored AI output on read; anything malformed is not shown as a cue.
    const valid = ((cues.data ?? []) as ReportCueRow[]).filter(
      (c) => candidateCueSchema.safeParse(c.cue).success,
    );
    return { report, cues: valid, events: (events.data ?? []) as ReportEventRow[] };
  });

/* ---------- Extraction (shared) ---------- */

async function runExtraction(userId: string, report: CareReportRow) {
  const sb = await admin();
  const text = report.reviewed_text ?? report.original_text;
  try {
    const { groqConfig, extractCues } = await import("@/lib/ai/groq.server");
    const r = await extractCues(text, report.source_type, groqConfig());
    const needsClar = r.extraction.needsClarification;
    await call(sb, "record_report_extraction", {
      _actor: userId,
      _report: report.id,
      _cues: r.extraction.cues,
      _schema_version: r.schemaVersion,
      _model: r.model,
      _needs_clarification: needsClar,
    });
    return {
      ok: true as const,
      cueCount: r.extraction.cues.length,
      questions: r.extraction.clarificationQuestions,
    };
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null;
    await rpcOf(sb)("record_report_failure", {
      _actor: userId,
      _report: report.id,
      _code: pe ? `groq:${pe.code}` : "server_error",
    });
    // Report is kept; the user can retry later.
    return {
      ok: false as const,
      message: pe ? userMessage(pe) : "Analysis failed. The report is saved; you can retry.",
    };
  }
}

/* ---------- Submit ---------- */

const RELATIONS = ["senior", "family", "care_worker", "coordinator", "other"] as const;
const LANGS = ["en", "hi", "hinglish", "unknown"] as const;

const textInput = z
  .object({
    seniorId: z.string().uuid(),
    text: z.string().trim().min(3).max(8000),
    relation: z.enum(RELATIONS),
    language: z.enum(LANGS),
    eventTime: z.string().datetime({ offset: true }).nullable(),
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const submitTextReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => textInput.parse(d))
  .handler(async ({ data, context }) => {
    const id = (await call(context.supabase, "submit_text_report", {
      _senior: data.seniorId,
      _text: data.text,
      _relation: data.relation,
      _language: data.language,
      _event_time: data.eventTime,
      _client_request_id: data.clientRequestId,
    })) as string;
    const report = await loadReport(context.supabase, id);
    if (report.status !== "pending_extraction") return { reportId: id, extraction: null };
    return { reportId: id, extraction: await runExtraction(context.userId, report) };
  });

export const submitAudioReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Expected a form upload.");
    const file = d.get("audio");
    if (!(file instanceof File)) throw new Error("Choose an audio file.");
    const meta = z
      .object({
        seniorId: z.string().uuid(),
        relation: z.enum(RELATIONS),
        language: z.enum(LANGS),
        eventTime: z.string().datetime({ offset: true }).nullable(),
        clientRequestId: z.string().uuid(),
      })
      .strict()
      .parse({
        seniorId: d.get("seniorId"),
        relation: d.get("relation"),
        language: d.get("language"),
        eventTime: d.get("eventTime") || null,
        clientRequestId: d.get("clientRequestId"),
      });
    return { ...meta, file };
  })
  .handler(async ({ data, context }) => {
    await assertSenior(context.supabase, data.seniorId);
    const head = new Uint8Array(await data.file.slice(0, 16).arrayBuffer());
    const chk = checkAudio(data.file.name, data.file.type, data.file.size, head);
    if (!chk.ok) return { ok: false as const, message: AUDIO_REASON_MESSAGES[chk.reason] };

    const { groqConfig, transcribe } = await import("@/lib/ai/groq.server");
    let t;
    try {
      const lang = data.language === "en" || data.language === "hi" ? data.language : null;
      t = await transcribe(data.file, `note.${chk.format}`, lang, groqConfig());
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("provider_error", "groq");
      // Nothing is stored when transcription fails: there is no transcript to keep.
      return { ok: false as const, message: userMessage(pe) };
    }
    const sb = await admin();
    const id = (await call(sb, "record_transcribed_report", {
      _actor: context.userId,
      _senior: data.seniorId,
      _transcript: t.text,
      _relation: data.relation,
      _language: data.language,
      _event_time: data.eventTime,
      _stt_model: t.model,
      _stt_language: t.language,
      _duration: t.durationSeconds,
      _mime: chk.mime,
      _bytes: data.file.size,
      _client_request_id: data.clientRequestId,
    })) as string;
    // Transcript is unverified: no extraction until a human has read it.
    return { ok: true as const, reportId: id, lowQuality: t.lowQuality };
  });

/* ---------- Review actions ---------- */

const reportId = z.object({ reportId: z.string().uuid() }).strict();

export const retryExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportId.parse(d))
  .handler(async ({ data, context }) => {
    const report = await loadReport(context.supabase, data.reportId);
    await assertSenior(context.supabase, report.senior_id);
    if (report.status === "reviewed") throw new Error("This report is fully reviewed.");
    return runExtraction(context.userId, report);
  });

export const correctTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ reportId: z.string().uuid(), text: z.string().trim().min(1).max(8000) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await call(context.supabase, "correct_report_transcript", {
      _report: data.reportId,
      _text: data.text,
    });
    return { ok: true };
  });

export const requestClarification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ reportId: z.string().uuid(), note: z.string().trim().min(2).max(1000) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await call(context.supabase, "request_report_clarification", {
      _report: data.reportId,
      _note: data.note,
    });
    return { ok: true };
  });

export const rejectCue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ cueId: z.string().uuid(), reason: z.string().trim().max(500) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await call(context.supabase, "reject_report_cue", { _cue: data.cueId, _reason: data.reason });
    return { ok: true };
  });

export const confirmCueInput = z
  .object({
    cueId: z.string().uuid(),
    type: z.enum([
      "heart_rate",
      "blood_pressure",
      "weight",
      "sleep_duration",
      "mobility",
      "appetite",
      "hydration",
      "medication_event",
      "care_note",
    ]),
    valueNumeric: z.number().finite().nullable(),
    valueNumeric2: z.number().finite().nullable(),
    valueText: z.string().max(40).nullable(),
    unit: z.enum(["bpm", "mmHg", "kg", "h"]).nullable(),
    note: z.string().max(2000).nullable(),
    observedAt: z.string().datetime({ offset: true }),
    source: z.enum(["manual_entry", "reported_by_senior", "reported_by_family"]),
    description: z.string().trim().max(500),
  })
  .strict();

/** The only path from an AI suggestion to an observation: a human confirmation. */
export const confirmCue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => confirmCueInput.parse(d))
  .handler(async ({ data, context }) => {
    // 1. Fetch cue to identify the linked senior
    const { data: cueRow } = await from(context.supabase, "report_cues")
      .select("senior_id")
      .eq("id", data.cueId)
      .maybeSingle();

    // 2. Confirm the cue into a verified observation row (SECURITY DEFINER)
    const obs = await call(context.supabase, "confirm_report_cue", {
      _cue: data.cueId,
      _type: data.type,
      _value_numeric: data.valueNumeric,
      _value_numeric_2: data.valueNumeric2,
      _value_text: data.valueText,
      _unit: data.unit,
      _note: data.note,
      _observed_at: data.observedAt,
      _source: data.source,
      _description: data.description,
    });

    // 3. Drive the unified downstream evaluation pipeline immediately
    let evaluation = null;
    const seniorId = (cueRow as { senior_id?: string } | null)?.senior_id;
    if (seniorId) {
      try {
        const { evaluateSeniorRiskAndAlerts } = await import("@/lib/risk.functions");
        evaluation = await evaluateSeniorRiskAndAlerts({
          supabase: context.supabase,
          seniorId,
          userId: context.userId,
          referenceTime: data.observedAt,
          bypassThrottle: true,
        });
      } catch {
        evaluation = null;
      }
    }

    return { observationId: obs as string, evaluation };
  });

/* ---------- Text-to-speech (confirmed content only) ---------- */

export const speakConfirmedSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportId.parse(d))
  .handler(async ({ data, context }) => {
    const report = await loadReport(context.supabase, data.reportId); // RLS-scoped
    const { buildConfirmedSummary } = await import("@/lib/reports");
    const cues = await from(context.supabase, "report_cues")
      .select("*")
      .eq("report_id", report.id)
      .order("position");
    if (cues.error) throw new Error("Couldn't load this report.");
    const text = buildConfirmedSummary((cues.data ?? []) as ReportCueRow[]);
    if (!text)
      return { ok: false as const, message: "There are no confirmed observations to read yet." };
    const { synthesize, ttsConfig, toBase64, MAX_TTS_CHARS } =
      await import("@/lib/ai/elevenlabs.server");
    try {
      const r = await synthesize(text.slice(0, MAX_TTS_CHARS), ttsConfig());
      await rpcOf(await admin())("log_report_tts", {
        _actor: context.userId,
        _report: report.id,
        _chars: text.length,
      });
      return { ok: true as const, contentType: r.contentType, audioBase64: toBase64(r.audio) };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("provider_error", "elevenlabs");
      return { ok: false as const, message: userMessage(pe) };
    }
  });
