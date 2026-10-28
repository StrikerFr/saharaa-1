// Pure: prompt + strict schema + validation for the AI wellbeing summary.
// The summary is a read-only, unverified narrative over records the caller can
// already see. It never produces a score, diagnosis or record. Review level
// comes only from the risk engine's saved assessment, shown separately.
import { z } from "zod";

export const SUMMARY_SCHEMA_VERSION = "summary.v1";

export type SummaryObservation = {
  id: string;
  type: string;
  value: string;
  observed_at: string;
  source: string;
  verification: string;
};

export type SummaryInput = {
  now: string;
  timeZone: string;
  observations: SummaryObservation[];
  assessment: {
    priority: string;
    data_quality: string;
    changed_domains: string[];
    created_at: string;
  } | null;
  openCaseStatus: string | null;
};

export const SUMMARY_SYSTEM_PROMPT = `You summarise care records for a home-care coordinator.
Rules:
- Use ONLY the records provided. Never invent values, symptoms, feelings or events.
- Do not diagnose, give medical advice, or produce any score, percentage or risk level.
- Do not restate the review level; it is shown separately from the rules engine.
- "today" is one or two full sentences describing only records observed on the reference day ("now", in the given time zone), e.g. "Family reported reduced appetite this morning." Never just a date. If there are no records that day, set "today" to null.
- How the person is feeling may be described only when a care note or reported entry says so, attributed ("family reported...").
- Missing data is never reassuring: list absent or stale areas in "data_gaps".
- Every point must cite the record ids it relies on in "evidence_ids".
- Plain, neutral English. Short sentences.`;

export const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "today", "points", "notes_summary", "data_gaps", "suggested_checks"],
  properties: {
    headline: { type: "string" },
    today: { type: ["string", "null"] },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence_ids"],
        properties: {
          text: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes_summary: { type: ["string", "null"] },
    data_gaps: { type: "array", items: { type: "string" } },
    suggested_checks: { type: "array", items: { type: "string" } },
  },
} as const;

const summarySchema = z.object({
  headline: z.string().min(1).max(300),
  today: z.string().max(600).nullable(),
  points: z
    .array(
      z.object({ text: z.string().min(1).max(400), evidence_ids: z.array(z.string()).max(20) }),
    )
    .max(8),
  notes_summary: z.string().max(800).nullable(),
  data_gaps: z.array(z.string().max(300)).max(8),
  suggested_checks: z.array(z.string().max(300)).max(5),
});
export type WellbeingSummary = z.infer<typeof summarySchema>;

// Scores, percentages and diagnostic phrasing are rejected outright.
const FORBIDDEN = /(\b\d{1,3}\s?%|\brisk score\b|\bscore of\b|\/\s?10\b|\bdiagnos(e|is|ed)\b)/i;

export function buildSummaryPrompt(input: SummaryInput): string {
  return JSON.stringify(input);
}

/** Parses model output and enforces grounding: every cited id must exist; uncited points are dropped. */
export function parseSummary(
  raw: string,
  knownIds: ReadonlySet<string>,
): { ok: true; value: WellbeingSummary } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const r = summarySchema.safeParse(json);
  if (!r.success) return { ok: false, reason: "schema" };
  const v = r.data;
  const texts = [
    v.headline,
    v.today ?? "",
    v.notes_summary ?? "",
    ...v.points.map((p) => p.text),
    ...v.suggested_checks,
  ];
  if (texts.some((t) => FORBIDDEN.test(t))) return { ok: false, reason: "forbidden_content" };
  const points = v.points
    .map((p) => ({ ...p, evidence_ids: p.evidence_ids.filter((id) => knownIds.has(id)) }))
    .filter((p) => p.evidence_ids.length > 0);
  // With no records today, a "today" statement cannot be grounded.
  return { ok: true, value: { ...v, points } };
}
