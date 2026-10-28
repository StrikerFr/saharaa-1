// Phase 7 report types, labels and pure helpers (client-safe).
import { CUE_TYPE_LABELS, candidateCueSchema, type CandidateCue } from "@/lib/ai/cues";
import type { Tone } from "@/components/shell/states";

export type ReportStatus =
  "pending_extraction" | "pending_review" | "needs_clarification" | "reviewed" | "failed";
export type CueStatus = "pending_review" | "confirmed" | "rejected" | "superseded";

export interface CareReportRow {
  id: string;
  senior_id: string;
  org_id: string;
  source_type: "typed_text" | "transcribed_audio";
  reporter_relation: "senior" | "family" | "care_worker" | "coordinator" | "other";
  original_text: string;
  reviewed_text: string | null;
  declared_language: "en" | "hi" | "hinglish" | "unknown";
  stt_model: string | null;
  stt_language: string | null;
  stt_duration_s: number | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  event_time: string | null;
  submitted_by: string;
  submitted_at: string;
  status: ReportStatus;
  extraction_schema_version: string | null;
  llm_model: string | null;
  extraction_error: string | null;
  extraction_attempts: number;
  clarification_note: string | null;
}

export interface ReportCueRow {
  id: string;
  report_id: string;
  attempt: number;
  position: number;
  cue: CandidateCue;
  schema_version: string;
  llm_model: string;
  review_status: CueStatus;
  reviewer_description: string | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  observation_id: string | null;
}

export interface ReportEventRow {
  id: number;
  cue_id: string | null;
  actor_id: string | null;
  action: string;
  at: string;
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, { label: string; tone: Tone }> = {
  pending_extraction: { label: "Awaiting analysis", tone: "neutral" },
  pending_review: { label: "Waiting for review", tone: "warning" },
  needs_clarification: { label: "Needs clarification", tone: "info" },
  reviewed: { label: "Reviewed", tone: "success" },
  failed: { label: "Analysis failed", tone: "critical" },
};

export const RELATION_LABEL: Record<CareReportRow["reporter_relation"], string> = {
  senior: "The senior",
  family: "Family member",
  care_worker: "Care worker",
  coordinator: "Coordinator",
  other: "Someone else",
};

export const LANGUAGE_LABEL: Record<CareReportRow["declared_language"], string> = {
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish",
  unknown: "Not specified",
};

export const EVENT_LABEL: Record<string, string> = {
  "care_report.submitted": "Report submitted",
  "care_report.extracted": "AI suggestions generated",
  "care_report.extraction_failed": "AI analysis failed",
  "care_report.transcript_corrected": "Transcript corrected",
  "care_report.clarification_requested": "Clarification requested",
  "report_cue.confirmed": "Suggestion confirmed as observation",
  "report_cue.rejected": "Suggestion rejected",
};

/** Mirrors confirm/reject guards in the database. */
export const canReviewCue = (s: CueStatus) => s === "pending_review";
export const canRetryExtraction = (s: ReportStatus) => s !== "reviewed";
export const canCorrectTranscript = (
  r: Pick<CareReportRow, "source_type">,
  cues: Pick<ReportCueRow, "review_status">[],
) => r.source_type === "transcribed_audio" && !cues.some((c) => c.review_status === "confirmed");

/**
 * Text sent to text-to-speech: human-confirmed observations only, without the
 * senior's name or the raw report. Unreviewed AI suggestions are never read.
 */
export function buildConfirmedSummary(cues: ReportCueRow[]): string | null {
  const lines = cues
    .filter((c) => c.review_status === "confirmed" && candidateCueSchema.safeParse(c.cue).success)
    .map(
      (c, i) =>
        `${i + 1}. ${CUE_TYPE_LABELS[c.cue.cueType]}: ${c.reviewer_description || c.cue.description}`,
    );
  if (!lines.length) return null;
  return `Confirmed by a care coordinator. ${lines.join(" ")}`;
}
