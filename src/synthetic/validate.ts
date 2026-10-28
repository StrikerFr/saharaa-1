// Pre-ingestion validation. Mirrors the database CHECKs (migrations 0002/0004) plus generator
// plausibility bounds and dataset integrity rules. Any `error` blocks ingestion.
import { OBSERVATION_TYPES, PLAUSIBILITY, SCENARIOS, configErrors } from "./config";
import { CARE_NOTE_TEXT, type Dataset, type ObservationRecord } from "./generate";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const SCENARIO_WORDS = new RegExp(SCENARIOS.join("|").replace(/_/g, "[ _]"), "i");

function obsShape(o: ObservationRecord): boolean {
  const n1 = o.value_numeric,
    n2 = o.value_numeric_2,
    t = o.value_text,
    u = o.unit;
  const between = (x: number | null, a: number, b: number) => x !== null && x >= a && x <= b;
  switch (o.type) {
    case "heart_rate":
      return u === "bpm" && between(n1, 20, 250) && n2 === null && t === null;
    case "blood_pressure":
      return (
        u === "mmHg" &&
        between(n1, 50, 260) &&
        between(n2, 30, 160) &&
        (n1 ?? 0) > (n2 ?? 0) &&
        t === null
      );
    case "weight":
      return u === "kg" && between(n1, 20, 300) && n2 === null && t === null;
    case "sleep_duration":
      return u === "h" && between(n1, 0, 24) && n2 === null && t === null;
    case "mobility":
      return (
        u === null &&
        n1 === null &&
        n2 === null &&
        ["independent", "uses_aid", "needs_assistance", "bed_bound"].includes(t ?? "")
      );
    case "appetite":
    case "hydration":
      return (
        u === null &&
        n1 === null &&
        n2 === null &&
        ["usual", "reduced", "increased", "refused"].includes(t ?? "")
      );
    case "medication_event":
      return (
        u === null &&
        n1 === null &&
        n2 === null &&
        ["taken", "partially_taken", "missed", "refused"].includes(t ?? "")
      );
    case "care_note":
      return (
        u === null && n1 === null && n2 === null && t === null && (o.note ?? "").trim().length >= 3
      );
  }
}

export function validate(ds: Dataset, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => {
    if (errors.length < 200) errors.push(m);
  };
  const c = ds.meta.config;

  errors.push(...configErrors(c));
  if (ds.seniors.length !== c.seniors)
    err(`cohort size ${ds.seniors.length} ≠ configured ${c.seniors}`);
  const winStart = Date.parse(ds.meta.window_start);
  const winEnd = Date.parse(ds.meta.window_end);
  if (winEnd > now.getTime())
    err("reference window ends in the future; choose an earlier --reference-date");
  if (winStart < now.getTime() - 5 * 365 * 86_400_000)
    err("window starts more than 5 years ago (database rejects it)");

  const ids = new Set<string>();
  const unique = (id: string, what: string) => {
    if (!UUID.test(id)) err(`${what}: malformed id`);
    if (ids.has(id)) err(`${what}: duplicate id ${id}`);
    ids.add(id);
  };
  const seniorIds = new Set<string>();
  const codes = new Set<string>();
  for (const s of ds.seniors) {
    unique(s.id, "senior");
    seniorIds.add(s.id);
    if (!CODE.test(s.record_code)) err(`senior ${s.record_code}: bad record code`);
    if (codes.has(s.record_code)) err(`duplicate record code ${s.record_code}`);
    codes.add(s.record_code);
    if (s.is_synthetic !== true) err(`senior ${s.record_code}: not marked synthetic`);
    if (!s.display_name.startsWith("Synthetic "))
      err(`senior ${s.record_code}: name lacks Synthetic prefix`);
    if (!s.care_context.startsWith("SYNTHETIC TEST RECORD"))
      err(`senior ${s.record_code}: context lacks synthetic label`);
    // No contact-shaped data anywhere in the profile.
    const text = [s.display_name, s.care_context].join(" ");
    if (/@|https?:|\d[\d\s()-]{7,}\d/.test(text))
      err(`senior ${s.record_code}: contact-shaped value`);
    if (s.date_of_birth > ds.meta.reference_date)
      err(`senior ${s.record_code}: DOB after reference date`);
  }

  for (const b of ds.baselines) {
    unique(b.id, "baseline");
    if (!seniorIds.has(b.senior_id)) err(`baseline ${b.id}: unknown senior`);
    const hasValue =
      b.value_numeric !== null ||
      b.value_numeric_2 !== null ||
      b.value_text !== null ||
      b.unit !== null;
    if (b.status !== "recorded" && hasValue)
      err(`baseline ${b.id}: value present with status ${b.status}`);
    if (b.status === "recorded" && !hasValue) err(`baseline ${b.id}: recorded without value`);
    if (Date.parse(b.recorded_at) < Date.parse(b.captured_at))
      err(`baseline ${b.id}: recorded before captured`);
  }

  const reqIds = new Set<string>();
  const perKey = new Set<string>();
  const counts: Record<string, number> = {};
  for (const o of ds.observations) {
    unique(o.id, "observation");
    if (reqIds.has(o.client_request_id)) err(`observation ${o.id}: duplicate request id`);
    reqIds.add(o.client_request_id);
    if (!seniorIds.has(o.senior_id)) err(`observation ${o.id}: unknown senior`);
    if (!obsShape(o)) err(`observation ${o.id} (${o.type}): value shape violates schema`);
    const obs = Date.parse(o.observed_at),
      rec = Date.parse(o.recorded_at);
    if (!(obs >= winStart && obs <= winEnd)) err(`observation ${o.id}: observed_at outside window`);
    if (rec < obs) err(`observation ${o.id}: recorded before observed`);
    if (rec > winEnd) err(`observation ${o.id}: recorded after window end`);
    const key = `${o.senior_id}|${o.type}|${o.observed_at.slice(0, 10)}`;
    if (perKey.has(key)) warnings.push(`duplicate same-day ${o.type} for a senior`);
    perKey.add(key);
    if (o.type === "care_note" && o.note !== CARE_NOTE_TEXT)
      err(`observation ${o.id}: unexpected note text`);
    if (o.note && SCENARIO_WORDS.test(o.note))
      err(`observation ${o.id}: note leaks scenario label`);
    // Plausibility (flag, never clip).
    const p = (v: number | null, [lo, hi]: readonly [number, number], label: string) => {
      if (v !== null && (v < lo || v > hi))
        err(`observation ${o.id}: ${label} ${v} outside generator plausibility ${lo}–${hi}`);
    };
    if (o.type === "heart_rate") p(o.value_numeric, PLAUSIBILITY.heart_rate, "heart rate");
    if (o.type === "blood_pressure") {
      p(o.value_numeric, PLAUSIBILITY.systolic, "systolic");
      p(o.value_numeric_2, PLAUSIBILITY.diastolic, "diastolic");
    }
    if (o.type === "weight") p(o.value_numeric, PLAUSIBILITY.weight, "weight");
    if (o.type === "sleep_duration") p(o.value_numeric, PLAUSIBILITY.sleep_duration, "sleep");
    counts[o.type] = (counts[o.type] ?? 0) + 1;
  }
  for (const t of OBSERVATION_TYPES)
    if (!counts[t]) warnings.push(`no ${t} observations generated`);

  // Ground truth integrity.
  const gtSeniors = new Set(ds.groundTruth.map((g) => g.senior_id));
  if (
    gtSeniors.size !== ds.seniors.length ||
    ds.groundTruth.some((g) => !seniorIds.has(g.senior_id))
  )
    err("ground truth does not cover exactly the cohort");
  for (const g of ds.groundTruth) {
    if (!SCENARIOS.includes(g.scenario)) err(`unknown scenario ${g.scenario}`);
    if (g.onset_day !== null && (g.onset_day < 0 || g.onset_day >= c.days))
      err("scenario onset outside window");
  }
  return { errors, warnings: [...new Set(warnings)] };
}
