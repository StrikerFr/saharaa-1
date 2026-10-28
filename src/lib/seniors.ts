import { z } from "zod";

/* ---------- Senior profile ---------- */

export const CARE_STATUS = {
  active: "Active",
  paused: "Paused",
  discharged: "Discharged",
} as const;
export const LANGUAGES = { en: "English", hi: "Hindi", other: "Other" } as const;
export const TIME_ZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "America/New_York",
  "Asia/Dubai",
  "Asia/Singapore",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

export const seniorSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(120, "Use at most 120 characters."),
  dateOfBirth: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidPastDate(v), "Enter a real date that isn't in the future.")
    .transform((v) => (v === "" ? null : v)),
  preferredLanguage: z.enum(["en", "hi", "other"]),
  timeZone: z.enum(TIME_ZONES),
  careStatus: z.enum(["active", "paused", "discharged"]),
  communicationNotes: optionalText(1000),
  careContext: optionalText(2000),
  isSynthetic: z.boolean(),
});
export const createSeniorSchema = seniorSchema.extend({
  recordCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, "Use 3–20 letters, numbers or hyphens, e.g. SR-0042."),
});
export type SeniorInput = z.infer<typeof seniorSchema>;

export function isValidPastDate(v: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return false;
  if (y < 1900) return false;
  const todayIso = today.toISOString().slice(0, 10);
  return v <= todayIso;
}

/** Whole years from an ISO date (YYYY-MM-DD), compared as calendar dates — no timezone shift. */
export function ageFrom(dob: string | null, today = new Date()): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= 0 ? age : null;
}

/** Strip characters that have meaning in PostgREST filter syntax; bound length. */
export function sanitizeSearch(q: string): string {
  return q
    .replace(/[,()*%\\:."']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export const DIRECTORY_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 20;

/* ---------- Provenance ---------- */

export const SOURCES = {
  manual_entry: "Care team entry",
  reported_by_senior: "Reported by senior",
  reported_by_family: "Reported by family",
  device: "Device reading",
  imported: "Imported",
} as const;
export type Source = keyof typeof SOURCES;
// Only manual-entry sources can be chosen in this phase; device/imported come with integrations.
export const ENTRY_SOURCES = ["manual_entry", "reported_by_senior", "reported_by_family"] as const;

/* ---------- Observation types (schema_version 1) ---------- */

type NumericDef = {
  kind: "numeric";
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};
type PairDef = { kind: "pair"; label: string; unit: string };
type ChoiceDef = { kind: "choice"; label: string; options: Record<string, string> };
type NoteDef = { kind: "note"; label: string };
export type ObservationDef = NumericDef | PairDef | ChoiceDef | NoteDef;

export const OBSERVATION_TYPES = {
  heart_rate: { kind: "numeric", label: "Heart rate", unit: "bpm", min: 20, max: 250, step: 1 },
  blood_pressure: { kind: "pair", label: "Blood pressure", unit: "mmHg" },
  weight: { kind: "numeric", label: "Weight", unit: "kg", min: 20, max: 300, step: 0.1 },
  sleep_duration: { kind: "numeric", label: "Sleep", unit: "h", min: 0, max: 24, step: 0.5 },
  mobility: {
    kind: "choice",
    label: "Mobility",
    options: {
      independent: "Moves independently",
      uses_aid: "Uses a walking aid",
      needs_assistance: "Needs assistance",
      bed_bound: "Unable to leave bed",
    },
  },
  appetite: {
    kind: "choice",
    label: "Appetite",
    options: {
      usual: "As usual for them",
      reduced: "Less than usual",
      increased: "More than usual",
      refused: "Refused food",
    },
  },
  hydration: {
    kind: "choice",
    label: "Fluid intake",
    options: {
      usual: "As usual for them",
      reduced: "Less than usual",
      increased: "More than usual",
      refused: "Refused fluids",
    },
  },
  medication_event: {
    kind: "choice",
    label: "Medication event",
    options: {
      taken: "Dose taken",
      partially_taken: "Partly taken",
      missed: "Dose missed",
      refused: "Dose refused",
    },
  },
  care_note: { kind: "note", label: "Care note" },
} as const satisfies Record<string, ObservationDef>;
export type ObservationType = keyof typeof OBSERVATION_TYPES;

export type ObservationRow = {
  id: string;
  type: ObservationType;
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
  unit: string | null;
  note: string | null;
  observed_at: string;
  recorded_at: string;
  recorded_by: string | null;
  source: Source;
  verification: "verified" | "unverified";
};

export type ObservationDraft = {
  type: ObservationType;
  value1: string;
  value2: string;
  choice: string;
  note: string;
  observedAt: string; // datetime-local value, in the browser's timezone
  source: (typeof ENTRY_SOURCES)[number];
};

export type ObservationInsert = {
  type: ObservationType;
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
  unit: string | null;
  note: string | null;
  observed_at: string;
  source: Source;
};

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Client-side mirror of the database CHECK constraints. The database remains the authority. */
export function buildObservation(
  d: ObservationDraft,
  now = new Date(),
):
  | { ok: true; value: ObservationInsert }
  | {
      ok: false;
      errors: Partial<Record<"value1" | "value2" | "choice" | "note" | "observedAt", string>>;
    } {
  const def: ObservationDef = OBSERVATION_TYPES[d.type];
  const errors: Partial<Record<"value1" | "value2" | "choice" | "note" | "observedAt", string>> =
    {};
  const observed = parseLocalDateTime(d.observedAt);
  if (!observed) errors.observedAt = "Enter when this was observed.";
  else if (observed.getTime() > now.getTime() + 5 * 60_000)
    errors.observedAt = "This time is in the future.";
  else if (observed.getTime() < now.getTime() - 5 * 365 * 86_400_000)
    errors.observedAt = "This is more than 5 years ago.";
  const note = d.note.trim();
  if (note.length > 2000) errors.note = "Use at most 2000 characters.";

  let value_numeric: number | null = null;
  let value_numeric_2: number | null = null;
  let value_text: string | null = null;
  let unit: string | null = null;

  if (def.kind === "numeric") {
    const v = num(d.value1);
    if (!Number.isFinite(v)) errors.value1 = `Enter a number in ${def.unit}.`;
    else if (v < def.min || v > def.max)
      errors.value1 = `Enter a value between ${def.min} and ${def.max} ${def.unit}.`;
    else value_numeric = Math.round(v * 10) / 10;
    unit = def.unit;
  } else if (def.kind === "pair") {
    const s = num(d.value1);
    const di = num(d.value2);
    if (!Number.isFinite(s) || s < 50 || s > 260)
      errors.value1 = "Enter systolic between 50 and 260 mmHg.";
    if (!Number.isFinite(di) || di < 30 || di > 160)
      errors.value2 = "Enter diastolic between 30 and 160 mmHg.";
    if (!errors.value1 && !errors.value2 && s <= di)
      errors.value2 = "Diastolic must be lower than systolic.";
    value_numeric = s;
    value_numeric_2 = di;
    unit = def.unit;
  } else if (def.kind === "choice") {
    if (!(d.choice in def.options)) errors.choice = "Choose one option.";
    value_text = d.choice;
  } else if (note.length < 3) errors.note = "Write at least 3 characters.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type: d.type,
      value_numeric,
      value_numeric_2,
      value_text,
      unit,
      note: note === "" ? null : note,
      observed_at: (observed as Date).toISOString(),
      source: d.source,
    },
  };
}

export function parseLocalDateTime(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const dt = new Date(v); // interpreted in the browser's local timezone
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Human value for an observation; never invents a value for missing data. */
export function formatObservationValue(
  o: Pick<
    ObservationRow,
    "type" | "value_numeric" | "value_numeric_2" | "value_text" | "unit" | "note"
  >,
): string {
  const def: ObservationDef = OBSERVATION_TYPES[o.type];
  if (def.kind === "numeric")
    return o.value_numeric == null ? "Not recorded" : `${fmtNum(o.value_numeric)} ${def.unit}`;
  if (def.kind === "pair")
    return o.value_numeric == null || o.value_numeric_2 == null
      ? "Not recorded"
      : `${fmtNum(o.value_numeric)}/${fmtNum(o.value_numeric_2)} ${def.unit}`;
  if (def.kind === "choice")
    return (
      (o.value_text && (def.options as Record<string, string>)[o.value_text]) || "Not recorded"
    );
  return o.note ?? "Not recorded";
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** True when the entry was made noticeably after the event (shown as "entered later"). */
export function isDelayedEntry(
  observedAt: string,
  recordedAt: string,
  thresholdMinutes = 60,
): boolean {
  return (
    new Date(recordedAt).getTime() - new Date(observedAt).getTime() > thresholdMinutes * 60_000
  );
}

/* ---------- Baselines ---------- */

export const BASELINE_FIELDS = {
  resting_heart_rate: {
    kind: "numeric",
    label: "Resting heart rate",
    unit: "bpm",
    min: 20,
    max: 250,
    step: 1,
  },
  blood_pressure: { kind: "pair", label: "Usual blood pressure", unit: "mmHg" },
  weight: { kind: "numeric", label: "Usual weight", unit: "kg", min: 20, max: 300, step: 0.1 },
  mobility: {
    kind: "choice",
    label: "Usual mobility",
    options: OBSERVATION_TYPES.mobility.options,
  },
  hearing: {
    kind: "choice",
    label: "Hearing",
    options: {
      no_difficulty: "No reported difficulty",
      some_difficulty: "Some difficulty",
      significant_difficulty: "Significant difficulty",
      uses_device: "Uses a hearing aid",
    },
  },
  vision: {
    kind: "choice",
    label: "Vision",
    options: {
      no_difficulty: "No reported difficulty",
      some_difficulty: "Some difficulty",
      significant_difficulty: "Significant difficulty",
      uses_device: "Uses glasses or aid",
    },
  },
} as const satisfies Record<string, ObservationDef>;
export type BaselineField = keyof typeof BASELINE_FIELDS;
export const BASELINE_STATUS = {
  recorded: "Recorded",
  unknown: "Unknown",
  not_applicable: "Not applicable",
} as const;
export type BaselineStatus = keyof typeof BASELINE_STATUS;

export type BaselineDraft = {
  field: BaselineField;
  status: BaselineStatus;
  value1: string;
  value2: string;
  choice: string;
  note: string;
  capturedAt: string;
  source: (typeof ENTRY_SOURCES)[number];
};

export function buildBaseline(d: BaselineDraft, now = new Date()) {
  const def: ObservationDef = BASELINE_FIELDS[d.field];
  const fake: ObservationDraft = {
    type: def.kind === "numeric" ? "weight" : def.kind === "pair" ? "blood_pressure" : "mobility",
    value1: d.value1,
    value2: d.value2,
    choice: d.choice,
    note: d.note,
    observedAt: d.capturedAt,
    source: d.source,
  };
  const errors: Partial<Record<"value1" | "value2" | "choice" | "note" | "capturedAt", string>> =
    {};
  const captured = parseLocalDateTime(d.capturedAt);
  if (!captured) errors.capturedAt = "Enter when this was captured.";
  else if (captured.getTime() > now.getTime() + 5 * 60_000)
    errors.capturedAt = "This time is in the future.";
  if (d.note.trim().length > 500) errors.note = "Use at most 500 characters.";

  let value_numeric: number | null = null;
  let value_numeric_2: number | null = null;
  let value_text: string | null = null;
  let unit: string | null = null;
  if (d.status === "recorded") {
    if (def.kind === "numeric") {
      const v = num(d.value1);
      if (!Number.isFinite(v) || v < def.min || v > def.max)
        errors.value1 = `Enter a value between ${def.min} and ${def.max} ${def.unit}.`;
      value_numeric = v;
      unit = def.unit;
    } else if (def.kind === "pair") {
      const r = buildObservation({ ...fake, observedAt: toLocalInputValue(now) }, now);
      if (!r.ok) {
        if (r.errors.value1) errors.value1 = r.errors.value1;
        if (r.errors.value2) errors.value2 = r.errors.value2;
      }
      value_numeric = num(d.value1);
      value_numeric_2 = num(d.value2);
      unit = def.unit;
    } else if (def.kind === "choice") {
      if (!(d.choice in def.options)) errors.choice = "Choose one option.";
      value_text = d.choice;
    }
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return {
    ok: true as const,
    value: {
      field: d.field,
      status: d.status,
      value_numeric,
      value_numeric_2,
      value_text,
      unit,
      note: d.note.trim() === "" ? null : d.note.trim(),
      captured_at: (captured as Date).toISOString(),
      source: d.source,
    },
  };
}

export function formatBaselineValue(b: {
  field: BaselineField;
  status: BaselineStatus;
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
}): string {
  if (b.status !== "recorded") return BASELINE_STATUS[b.status];
  const def: ObservationDef = BASELINE_FIELDS[b.field];
  if (def.kind === "numeric")
    return b.value_numeric == null ? "Not recorded" : `${fmtNum(b.value_numeric)} ${def.unit}`;
  if (def.kind === "pair")
    return b.value_numeric == null || b.value_numeric_2 == null
      ? "Not recorded"
      : `${fmtNum(b.value_numeric)}/${fmtNum(b.value_numeric_2)} ${def.unit}`;
  if (def.kind === "choice")
    return (
      (b.value_text && (def.options as Record<string, string>)[b.value_text]) || "Not recorded"
    );
  return "Not recorded";
}

/** Maps database errors to safe messages. */
export function friendlyDbError(e: { code?: string; message?: string } | null | undefined): string {
  const code = e?.code;
  if (code === "23505") return "That record ID is already used in your organisation.";
  if (code === "23514")
    return "Some values are outside the allowed range. Check the fields and try again.";
  if (code === "42501") return "You don't have permission to do that.";
  if (code === "PGRST116") return "This record couldn't be found or you don't have access.";
  return "Couldn't save. Nothing was changed — please try again.";
}
