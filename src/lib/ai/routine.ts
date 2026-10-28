// "Tell the AI" routine updates: pure prompt, schema and validation.
// The model only proposes; a coordinator confirms each proposal before it is logged.
import { z } from "zod";

export const ROUTINE_AI_SCHEMA_VERSION = "routine.v1";

export const ROUTINE_AI_SYSTEM_PROMPT = `You map a short care update (English, Hindi or Hinglish) to a senior's scheduled routine items for one day.
Rules:
- Only use item ids from the provided list. Never invent items.
- Only propose an update when the text clearly states it. If unsure, leave it out and list it in "unmatched".
- status: "done" if it happened, "missed" if it clearly did not happen, "skipped" if it was intentionally skipped.
- time: 24h "HH:MM" local time only if the text states it, else null.
- note: short factual detail from the text (e.g. "took after breakfast"), else null. No diagnoses.
Return JSON only.`;

export const ROUTINE_AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["updates", "unmatched"],
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "status", "time", "note"],
        properties: {
          item_id: { type: "string" },
          status: { type: "string", enum: ["done", "missed", "skipped"] },
          time: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
        },
      },
    },
    unmatched: { type: "array", items: { type: "string" } },
  },
} as const;

const update = z.object({
  item_id: z.string(),
  status: z.enum(["done", "missed", "skipped"]),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  note: z.string().max(300).nullable(),
});
const shape = z.object({ updates: z.array(update).max(40), unmatched: z.array(z.string().max(300)).max(20) });
export type RoutineProposal = z.infer<typeof update>;
export type RoutineAiResult = z.infer<typeof shape>;

export function buildRoutinePrompt(
  date: string,
  items: { id: string; title: string; category: string; time: string }[],
  text: string,
): string {
  return `Date: ${date}\nItems:\n${items
    .map((i) => `- id=${i.id} | ${i.time} | ${i.category} | ${i.title}`)
    .join("\n")}\n\nUpdate text:\n"""${text}"""`;
}

/** Parse model output; drops unknown item ids and duplicate items (first wins). */
export function parseRoutineAi(
  raw: string,
  allowedIds: Set<string>,
): { ok: true; value: RoutineAiResult } | { ok: false } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const r = shape.safeParse(json);
  if (!r.success) return { ok: false };
  const seen = new Set<string>();
  const updates = r.data.updates.filter((u) => {
    if (!allowedIds.has(u.item_id) || seen.has(u.item_id)) return false;
    seen.add(u.item_id);
    return true;
  });
  return { ok: true, value: { updates, unmatched: r.data.unmatched } };
}
