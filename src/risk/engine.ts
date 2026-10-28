// Sahaara explainable risk engine (Phase 5). PURE: no database, network, logging or wall-clock access.
// Same eligible inputs + engine version + config + reference time  ⇒  same logical assessment.
// Output describes changes relative to a person's own history for HUMAN REVIEW. It never diagnoses.
import {
  canonicalJson,
  configFingerprint,
  days,
  DEFAULT_RISK_CONFIG,
  ENGINE_VERSION,
  fingerprint,
  RULESET_VERSION,
  type RiskConfig,
} from "./config";

/* ---------- Input contract (subset of Phase 3 rows; no labels, names or notes) ---------- */

export type EngineObservationType =
  | "heart_rate"
  | "blood_pressure"
  | "weight"
  | "sleep_duration"
  | "mobility"
  | "appetite"
  | "hydration"
  | "medication_event"
  | "care_note";

export interface EngineObservation {
  id: string;
  type: EngineObservationType;
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
  unit: string | null;
  observed_at: string;
  recorded_at: string;
  source: string;
  verification: "verified" | "unverified";
}
export interface EngineBaseline {
  field: string;
  status: "recorded" | "unknown" | "not_applicable";
  value_numeric: number | null;
  value_numeric_2: number | null;
  unit: string | null;
  captured_at: string;
  recorded_at: string;
}
export interface EngineInput {
  seniorId: string;
  timeZone: string;
  referenceTime: string;
  observations: EngineObservation[];
  baselines: EngineBaseline[];
}

/* ---------- Output contract (schema_version 1) ---------- */

export type EvidenceStatus = "detected" | "not_detected" | "not_assessable";
export type SignalCategory =
  | "change_from_reference"
  | "variability_change"
  | "categorical_shift"
  | "reporting_pattern"
  | "pattern_reversal";
export type Domain =
  | "heart_rate"
  | "blood_pressure"
  | "weight"
  | "sleep"
  | "intake"
  | "mobility"
  | "medication"
  | "reporting";
export type ReviewPriority =
  | "unable_to_assess"
  | "no_signal_detected"
  | "review_suggested"
  | "review_recommended"
  | "prompt_review_recommended";
export type QualityStatus = "adequate" | "limited" | "insufficient";

export interface Window {
  start: string;
  end: string;
}
export interface EvidenceItem {
  ruleId: string;
  ruleVersion: string;
  title: string;
  category: SignalCategory;
  domain: Domain;
  status: EvidenceStatus;
  /** Whether a detection contributes to the review-priority category. */
  contributes: boolean;
  observationTypes: EngineObservationType[];
  window: Window;
  referenceWindow: (Window & { kind: "observation_history" | "recorded_baseline" }) | null;
  inputObservationIds: string[];
  values: Record<string, number | string | null>;
  method: string;
  direction: "increase" | "decrease" | null;
  explanation: string;
  limitations: string[];
}
export interface QualityFlag {
  code:
    | "missing_baseline"
    | "insufficient_samples"
    | "stale_data"
    | "unit_mismatch"
    | "invalid_value"
    | "duplicate"
    | "conflict"
    | "long_gap"
    | "delayed_entry"
    | "unverified_source"
    | "excluded_future"
    | "invalid_time_zone";
  severity: "limitation" | "note";
  detail: string;
  count?: number;
}
export interface Assessment {
  schemaVersion: 1;
  seniorId: string;
  referenceTime: string;
  evaluationWindow: Window;
  engineVersion: string;
  rulesetVersion: string;
  configFingerprint: string;
  inputDigest: string;
  priority: ReviewPriority;
  changedDomains: Domain[];
  dataQuality: {
    status: QualityStatus;
    flags: QualityFlag[];
    assessableRules: number;
    totalRules: number;
  };
  evidence: EvidenceItem[];
  insufficientReasons: string[];
  inputCounts: { eligible: number; excluded: number };
}

/* ---------- Helpers ---------- */

const EXPECTED_UNIT: Partial<Record<EngineObservationType, string>> = {
  heart_rate: "bpm",
  blood_pressure: "mmHg",
  weight: "kg",
  sleep_duration: "h",
};
const BOUNDS: Partial<Record<EngineObservationType, [number, number]>> = {
  heart_rate: [20, 250],
  weight: [20, 300],
  sleep_duration: [0, 24],
};
const CHOICES: Partial<Record<EngineObservationType, string[]>> = {
  mobility: ["independent", "uses_aid", "needs_assistance", "bed_bound"],
  appetite: ["usual", "reduced", "increased", "refused"],
  hydration: ["usual", "reduced", "increased", "refused"],
  medication_event: ["taken", "partially_taken", "missed", "refused"],
};
const CONCERNING: Record<"appetite" | "hydration" | "medication_event", string[]> = {
  appetite: ["reduced", "refused"],
  hydration: ["reduced", "refused"],
  medication_event: ["missed", "refused", "partially_taken"],
};

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
}
/** Robust spread: 1.4826 × MAD, falling back to SD when MAD is 0. */
export function robustSigma(xs: number[]): number {
  const m = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
  return mad > 0 ? mad : sd(xs);
}
const r2 = (x: number) => Math.round(x * 100) / 100;
const iso = (ms: number) => new Date(ms).toISOString();

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function localDate(ms: number, fmt: Intl.DateTimeFormat): string {
  return fmt.format(new Date(ms));
}
function nextCalendarDate(d: string): string {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
}

function valueKey(o: EngineObservation): string {
  return `${o.value_numeric}|${o.value_numeric_2}|${o.value_text}|${o.unit}`;
}

interface Norm {
  o: EngineObservation;
  t: number;
}

/* ---------- Normalisation & eligibility ---------- */

export function normalize(input: EngineInput, cfg: RiskConfig) {
  const T = Date.parse(input.referenceTime);
  if (!Number.isFinite(T)) throw new Error("referenceTime must be an ISO timestamp");
  const { recentDays, referenceDays } = cfg.windows;
  const lookbackStart = T - days(recentDays + referenceDays);
  const flags: QualityFlag[] = [];
  const count = { future: 0, invalid: 0, unit: 0, dup: 0, conflict: 0 };

  const candidates: Norm[] = [];
  for (const o of input.observations) {
    const t = Date.parse(o.observed_at);
    const rec = Date.parse(o.recorded_at);
    if (!Number.isFinite(t) || !Number.isFinite(rec)) {
      count.invalid++;
      continue;
    }
    // Leakage guard: anything observed OR recorded after T was not knowable at T.
    if (t > T || rec > T) {
      count.future++;
      continue;
    }
    if (t <= lookbackStart) continue; // outside the bounded evaluation window
    const unit = EXPECTED_UNIT[o.type];
    if (unit && o.unit !== unit) {
      count.unit++;
      continue;
    }
    if (!isValidValue(o)) {
      count.invalid++;
      continue;
    }
    candidates.push({ o, t });
  }
  // Duplicates (same type + observed_at + identical value) collapse to the smallest id.
  // Conflicts (same type + observed_at, different values) are all excluded: we cannot tell which is right.
  const groups = new Map<string, Norm[]>();
  for (const c of candidates) {
    const k = `${c.o.type}|${c.t}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const eligible: Norm[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      eligible.push(g[0] as Norm);
      continue;
    }
    const keys = new Set(g.map((c) => valueKey(c.o)));
    if (keys.size > 1) {
      count.conflict += g.length;
      continue;
    }
    g.sort((a, b) => (a.o.id < b.o.id ? -1 : 1));
    eligible.push(g[0] as Norm);
    count.dup += g.length - 1;
  }
  eligible.sort((a, b) => a.t - b.t || (a.o.id < b.o.id ? -1 : 1));

  if (count.future)
    flags.push({
      code: "excluded_future",
      severity: "note",
      count: count.future,
      detail: `${count.future} entr${count.future === 1 ? "y was" : "ies were"} observed or recorded after the reference time and ignored.`,
    });
  if (count.unit)
    flags.push({
      code: "unit_mismatch",
      severity: "limitation",
      count: count.unit,
      detail: `${count.unit} entr${count.unit === 1 ? "y has" : "ies have"} an unexpected unit and ${count.unit === 1 ? "was" : "were"} excluded.`,
    });
  if (count.invalid)
    flags.push({
      code: "invalid_value",
      severity: "limitation",
      count: count.invalid,
      detail: `${count.invalid} entr${count.invalid === 1 ? "y has" : "ies have"} an unreadable value or time and ${count.invalid === 1 ? "was" : "were"} excluded.`,
    });
  if (count.dup)
    flags.push({
      code: "duplicate",
      severity: "note",
      count: count.dup,
      detail: `${count.dup} exact duplicate entr${count.dup === 1 ? "y" : "ies"} (same type, time and value) counted once.`,
    });
  if (count.conflict)
    flags.push({
      code: "conflict",
      severity: "limitation",
      count: count.conflict,
      detail: `${count.conflict} entries share a type and time but disagree on the value; all were excluded.`,
    });
  const excluded = count.future + count.invalid + count.unit + count.dup + count.conflict;
  return { T, eligible, flags, excluded };
}

function isValidValue(o: EngineObservation): boolean {
  if (o.type === "blood_pressure") {
    const s = o.value_numeric;
    const d = o.value_numeric_2;
    return (
      s != null &&
      d != null &&
      Number.isFinite(s) &&
      Number.isFinite(d) &&
      s >= 50 &&
      s <= 260 &&
      d >= 30 &&
      d <= 160 &&
      s > d
    );
  }
  const b = BOUNDS[o.type];
  if (b)
    return (
      o.value_numeric != null &&
      Number.isFinite(o.value_numeric) &&
      o.value_numeric >= b[0] &&
      o.value_numeric <= b[1]
    );
  const ch = CHOICES[o.type];
  if (ch) return o.value_text != null && ch.includes(o.value_text);
  return o.type === "care_note";
}

/* ---------- Rule evaluation ---------- */

type NumericKey = "heart_rate" | "systolic" | "sleep_duration" | "weight";
const NUMERIC_META: Record<
  NumericKey,
  {
    type: EngineObservationType;
    title: string;
    domain: Domain;
    unit: string;
    baselineField?: string;
  }
> = {
  heart_rate: {
    type: "heart_rate",
    title: "Heart rate",
    domain: "heart_rate",
    unit: "bpm",
    baselineField: "resting_heart_rate",
  },
  systolic: {
    type: "blood_pressure",
    title: "Blood pressure (systolic)",
    domain: "blood_pressure",
    unit: "mmHg",
    baselineField: "blood_pressure",
  },
  sleep_duration: { type: "sleep_duration", title: "Sleep duration", domain: "sleep", unit: "h" },
  weight: {
    type: "weight",
    title: "Weight",
    domain: "weight",
    unit: "kg",
    baselineField: "weight",
  },
};
const numVal = (o: EngineObservation) => o.value_numeric as number;

interface Ctx {
  T: number;
  cfg: RiskConfig;
  eligible: Norm[];
  baselines: EngineBaseline[];
  recent: Window;
  reference: Window;
}

function inRange(n: Norm, start: number, end: number) {
  return n.t > start && n.t <= end;
}

function shiftTest(
  ref: number[],
  rec: number[],
  rule: RiskConfig["numeric"][NumericKey],
  refFromBaseline: boolean,
) {
  const refMed = refFromBaseline ? (ref[0] as number) : median(ref);
  const recMed = median(rec);
  const change = recMed - refMed;
  const rel = refMed !== 0 ? change / refMed : 0;
  const sigma = refFromBaseline ? 0 : robustSigma(ref);
  const se = refFromBaseline ? 0 : 1.2533 * sigma * Math.sqrt(1 / rec.length + 1 / ref.length);
  const detected =
    Math.abs(change) >= rule.minAbsChange &&
    Math.abs(rel) >= rule.minRelChange &&
    Math.abs(change) >= rule.seK * se &&
    (refFromBaseline || Math.abs(change) >= rule.minSpreadMultiple * sigma);
  return { refMed, recMed, change, rel, sigma, se, detected };
}

function numericRule(ctx: Ctx, key: NumericKey): EvidenceItem {
  const rule = ctx.cfg.numeric[key];
  const meta = NUMERIC_META[key];
  const R = days(ctx.cfg.windows.recentDays);
  const F = days(ctx.cfg.windows.referenceDays);
  const of = ctx.eligible.filter((n) => n.o.type === meta.type);
  const recN = of.filter((n) => inRange(n, ctx.T - R, ctx.T));
  const refN = of.filter((n) => inRange(n, ctx.T - R - F, ctx.T - R));
  const base: Omit<
    EvidenceItem,
    | "status"
    | "values"
    | "direction"
    | "explanation"
    | "limitations"
    | "referenceWindow"
    | "inputObservationIds"
  > = {
    ruleId: `numeric_shift.${key}`,
    ruleVersion: "1.0.0",
    title: `${meta.title}: change from personal reference`,
    category: "change_from_reference",
    domain: meta.domain,
    contributes: true,
    observationTypes: [meta.type],
    window: ctx.recent,
    method:
      "Median of recent entries minus median of the reference period. Detected only if the change is at least the configured minimum AND at least k × its standard error AND at least m × the reference day-to-day spread (robust σ = 1.4826 × MAD).",
  };
  const limitations: string[] = [];
  let ref = refN.map((n) => numVal(n.o));
  let refWindow: EvidenceItem["referenceWindow"] = {
    ...ctx.reference,
    kind: "observation_history",
  };
  let fromBaseline = false;
  if (ref.length < rule.minReference && meta.baselineField) {
    const b = pickBaseline(ctx, meta.baselineField, meta.unit);
    if (b) {
      ref = [b.value];
      fromBaseline = true;
      refWindow = { start: b.captured_at, end: b.captured_at, kind: "recorded_baseline" };
      limitations.push(
        `Fewer than ${rule.minReference} reference entries; compared with the recorded baseline from ${b.captured_at.slice(0, 10)} instead, without a spread estimate.`,
      );
    }
  }
  const rec = recN.map((n) => numVal(n.o));
  const values: EvidenceItem["values"] = {
    unit: meta.unit,
    n_recent: rec.length,
    n_reference: fromBaseline ? 1 : ref.length,
  };
  if (
    (!fromBaseline && ref.length < rule.minReference) ||
    rec.length < rule.minRecent ||
    ref.length === 0
  ) {
    const why: string[] = [];
    if (!fromBaseline && ref.length < rule.minReference)
      why.push(
        `reference period has ${ref.length} of the ${rule.minReference} entries needed and no usable recorded baseline`,
      );
    if (rec.length < rule.minRecent)
      why.push(`recent window has ${rec.length} of the ${rule.minRecent} entries needed`);
    return {
      ...base,
      status: "not_assessable",
      referenceWindow: refWindow,
      inputObservationIds: [],
      values,
      direction: null,
      explanation: `Not enough ${meta.title.toLowerCase()} entries to compare: ${why.join("; ")}. This is not evidence that nothing changed.`,
      limitations,
    };
  }
  const t = shiftTest(ref, rec, rule, fromBaseline);
  const dir = t.change > 0 ? "increase" : t.change < 0 ? "decrease" : null;
  Object.assign(values, {
    recent_median: r2(t.recMed),
    reference_median: r2(t.refMed),
    change: r2(t.change),
    relative_change: r2(t.rel),
    reference_spread: fromBaseline ? null : r2(t.sigma),
    standard_error: fromBaseline ? null : r2(t.se),
  });
  const refDesc = fromBaseline
    ? "the recorded baseline"
    : `this person's reference period (${ref.length} entries)`;
  const explanation = t.detected
    ? `Recent median ${r2(t.recMed)} ${meta.unit} (${rec.length} entries) is ${r2(Math.abs(t.change))} ${meta.unit} ${dir === "increase" ? "higher" : "lower"} than ${refDesc}, median ${r2(t.refMed)} ${meta.unit}. This is a change relative to their own history, not a judgement about whether the value is medically normal.`
    : `Recent median ${r2(t.recMed)} ${meta.unit} is within the configured change limits of ${refDesc} (median ${r2(t.refMed)} ${meta.unit}).`;
  return {
    ...base,
    status: t.detected ? "detected" : "not_detected",
    referenceWindow: refWindow,
    inputObservationIds: [...refN, ...recN].map((n) => n.o.id),
    values,
    direction: dir,
    explanation,
    limitations,
  };
}

function pickBaseline(ctx: Ctx, field: string, unit: string) {
  const maxAge = days(ctx.cfg.quality.baselineMaxAgeDays);
  const ok = ctx.baselines
    .filter(
      (b) =>
        b.field === field &&
        b.status === "recorded" &&
        b.unit === unit &&
        b.value_numeric != null &&
        Date.parse(b.captured_at) <= ctx.T &&
        Date.parse(b.recorded_at) <= ctx.T &&
        ctx.T - Date.parse(b.captured_at) <= maxAge,
    )
    .sort(
      (a, b) =>
        Date.parse(b.captured_at) - Date.parse(a.captured_at) ||
        (a.recorded_at < b.recorded_at ? 1 : -1),
    );
  const b = ok[0];
  return b ? { value: b.value_numeric as number, captured_at: b.captured_at } : null;
}

function bpVariabilityRule(ctx: Ctx): EvidenceItem {
  const rule = ctx.cfg.bpVariability;
  const R = days(ctx.cfg.windows.recentDays);
  const F = days(ctx.cfg.windows.referenceDays);
  const bp = ctx.eligible.filter((n) => n.o.type === "blood_pressure");
  // Day-to-day differences of systolic between consecutive entries ≤ 2 days apart (robust to slow trends).
  const diffs = (ns: Norm[]) => {
    const out: number[] = [];
    for (let i = 1; i < ns.length; i++) {
      const a = ns[i - 1] as Norm;
      const b = ns[i] as Norm;
      if (b.t - a.t <= days(2)) out.push(numVal(b.o) - numVal(a.o));
    }
    return out;
  };
  const recN = bp.filter((n) => inRange(n, ctx.T - R, ctx.T));
  const refN = bp.filter((n) => inRange(n, ctx.T - R - F, ctx.T - R));
  const dRec = diffs(recN);
  const dRef = diffs(refN);
  const base = {
    ruleId: "variability.blood_pressure",
    ruleVersion: "1.0.0",
    title: "Blood pressure: day-to-day variability",
    category: "variability_change" as const,
    domain: "blood_pressure" as const,
    contributes: true,
    observationTypes: ["blood_pressure" as const],
    window: ctx.recent,
    referenceWindow: { ...ctx.reference, kind: "observation_history" as const },
    method:
      "Ratio of the standard deviation of consecutive systolic differences (entries ≤ 2 days apart) in the recent window to the same quantity in the reference period.",
    direction: null,
    limitations: [] as string[],
  };
  if (dRec.length < rule.minRecent || dRef.length < rule.minReference) {
    return {
      ...base,
      status: "not_assessable",
      inputObservationIds: [],
      values: { unit: "mmHg", n_recent_pairs: dRec.length, n_reference_pairs: dRef.length },
      explanation: `Not enough consecutive blood-pressure entries to compare variability (recent ${dRec.length}/${rule.minRecent}, reference ${dRef.length}/${rule.minReference}).`,
    };
  }
  const sRef = sd(dRef);
  const sRec = sd(dRec);
  const ratio = sRef > 0 ? sRec / sRef : sRec > 0 ? Infinity : 1;
  const detected = ratio >= rule.minRatio;
  return {
    ...base,
    status: detected ? "detected" : "not_detected",
    inputObservationIds: [...refN, ...recN].map((n) => n.o.id),
    values: {
      unit: "mmHg",
      recent_sd: r2(sRec),
      reference_sd: r2(sRef),
      ratio: Number.isFinite(ratio) ? r2(ratio) : null,
      n_recent_pairs: dRec.length,
      n_reference_pairs: dRef.length,
    },
    direction: detected ? "increase" : null,
    explanation: detected
      ? `Day-to-day systolic changes are ${r2(ratio)}× as variable as in the reference period. This describes variability in recorded readings only.`
      : `Day-to-day systolic variability (${r2(ratio)}× reference) is below the configured ${rule.minRatio}× limit.`,
  } as EvidenceItem;
}

const CAT_META = {
  appetite: { title: "Appetite", domain: "intake" as Domain, less: "less than usual or refused" },
  hydration: {
    title: "Fluid intake",
    domain: "intake" as Domain,
    less: "less than usual or refused",
  },
  medication_event: {
    title: "Medication events",
    domain: "medication" as Domain,
    less: "missed, refused or partly taken",
  },
};

function categoricalRule(ctx: Ctx, type: keyof typeof CONCERNING): EvidenceItem {
  const rule = ctx.cfg.categorical[type];
  const meta = CAT_META[type];
  const R = days(ctx.cfg.windows.recentDays);
  const F = days(ctx.cfg.windows.referenceDays);
  const of = ctx.eligible.filter((n) => n.o.type === type);
  const recN = of.filter((n) => inRange(n, ctx.T - R, ctx.T));
  const refN = of.filter((n) => inRange(n, ctx.T - R - F, ctx.T - R));
  const isC = (n: Norm) => CONCERNING[type].includes(n.o.value_text as string);
  const cRec = recN.filter(isC).length;
  const cRef = refN.filter(isC).length;
  const base = {
    ruleId: `categorical_shift.${type}`,
    ruleVersion: "1.0.0",
    title: `${meta.title}: more entries ${meta.less}`,
    category: "categorical_shift" as const,
    domain: meta.domain,
    contributes: true,
    observationTypes: [type],
    window: ctx.recent,
    referenceWindow: { ...ctx.reference, kind: "observation_history" as const },
    method:
      "Share of entries in the listed categories, recent window vs. reference period. Detected only if the share rises by at least the configured amount, a two-proportion z-score meets the minimum, and enough recent entries are in those categories.",
    limitations: [] as string[],
  };
  if (recN.length < rule.minRecent || refN.length < rule.minReference) {
    return {
      ...base,
      status: "not_assessable",
      inputObservationIds: [],
      values: { n_recent: recN.length, n_reference: refN.length },
      direction: null,
      explanation: `Not enough ${meta.title.toLowerCase()} entries to compare (recent ${recN.length}/${rule.minRecent}, reference ${refN.length}/${rule.minReference}). Missing entries are not treated as normal.`,
    };
  }
  const pRec = cRec / recN.length;
  const pRef = cRef / refN.length;
  const pool = (cRec + cRef) / (recN.length + refN.length);
  const se = Math.sqrt(pool * (1 - pool) * (1 / recN.length + 1 / refN.length));
  const z = se > 0 ? (pRec - pRef) / se : 0;
  const detected =
    pRec - pRef >= rule.minRateIncrease && z >= rule.minZ && cRec >= rule.minRecentConcerning;
  return {
    ...base,
    status: detected ? "detected" : "not_detected",
    inputObservationIds: [...refN, ...recN].map((n) => n.o.id),
    values: {
      recent_share: r2(pRec),
      reference_share: r2(pRef),
      z: r2(z),
      recent_count: cRec,
      n_recent: recN.length,
      reference_count: cRef,
      n_reference: refN.length,
    },
    direction: pRec > pRef ? "increase" : pRec < pRef ? "decrease" : null,
    explanation: detected
      ? `${cRec} of ${recN.length} recent entries (${Math.round(pRec * 100)}%) were ${meta.less}, compared with ${cRef} of ${refN.length} (${Math.round(pRef * 100)}%) in the reference period.`
      : `Share of entries ${meta.less} (${Math.round(pRec * 100)}% recent vs ${Math.round(pRef * 100)}% reference) is within the configured limits.`,
  };
}

function mobilityRule(ctx: Ctx): EvidenceItem {
  const rule = ctx.cfg.mobility;
  const order = CHOICES.mobility as string[];
  const R = days(ctx.cfg.windows.recentDays);
  const F = days(ctx.cfg.windows.referenceDays);
  const of = ctx.eligible.filter((n) => n.o.type === "mobility");
  const recN = of.filter((n) => inRange(n, ctx.T - R, ctx.T));
  const refN = of.filter((n) => inRange(n, ctx.T - R - F, ctx.T - R));
  const lvl = (n: Norm) => order.indexOf(n.o.value_text as string);
  const base = {
    ruleId: "ordinal_shift.mobility",
    ruleVersion: "1.0.0",
    title: "Mobility: more assistance recorded",
    category: "categorical_shift" as const,
    domain: "mobility" as const,
    contributes: true,
    observationTypes: ["mobility" as const],
    window: ctx.recent,
    referenceWindow: { ...ctx.reference, kind: "observation_history" as const },
    method:
      "Median assistance level (independent < walking aid < needs assistance < unable to leave bed), recent window vs. reference period. Detected when the recent median level is higher.",
    limitations: [] as string[],
  };
  if (recN.length < rule.minRecent || refN.length < rule.minReference)
    return {
      ...base,
      status: "not_assessable",
      inputObservationIds: [],
      values: { n_recent: recN.length, n_reference: refN.length },
      direction: null,
      explanation: `Not enough mobility entries to compare (recent ${recN.length}/${rule.minRecent}, reference ${refN.length}/${rule.minReference}).`,
    };
  const mRec = median(recN.map(lvl));
  const mRef = median(refN.map(lvl));
  const detected = mRec > mRef;
  const name = (x: number) => order[Math.round(x)]?.replace(/_/g, " ") ?? String(x);
  return {
    ...base,
    status: detected ? "detected" : "not_detected",
    inputObservationIds: [...refN, ...recN].map((n) => n.o.id),
    values: {
      recent_median_level: mRec,
      reference_median_level: mRef,
      n_recent: recN.length,
      n_reference: refN.length,
    },
    direction: mRec > mRef ? "increase" : mRec < mRef ? "decrease" : null,
    explanation: detected
      ? `Recent mobility entries are typically “${name(mRec)}”, compared with “${name(mRef)}” in the reference period.`
      : `Typical recorded mobility level is unchanged or lower than in the reference period (“${name(mRef)}”).`,
  };
}

function reportingRule(ctx: Ctx): EvidenceItem {
  const rule = ctx.cfg.reporting;
  const { recentDays, referenceDays } = ctx.cfg.windows;
  const recN = ctx.eligible.filter((n) => inRange(n, ctx.T - days(recentDays), ctx.T));
  const refN = ctx.eligible.filter((n) =>
    inRange(n, ctx.T - days(recentDays + referenceDays), ctx.T - days(recentDays)),
  );
  const base = {
    ruleId: "reporting.frequency",
    ruleVersion: "1.0.0",
    title: "Fewer entries than usual",
    category: "reporting_pattern" as const,
    domain: "reporting" as const,
    contributes: true,
    observationTypes: [] as EngineObservationType[],
    window: ctx.recent,
    referenceWindow: { ...ctx.reference, kind: "observation_history" as const },
    method:
      "Entries per day (all types) in the recent window divided by entries per day in the reference period. A drop is an operational signal that information is missing — not evidence of a change in the person.",
    limitations: [] as string[],
  };
  if (refN.length < rule.minReferenceEntries)
    return {
      ...base,
      status: "not_assessable",
      inputObservationIds: [],
      values: { n_recent: recN.length, n_reference: refN.length },
      direction: null,
      explanation: `The reference period has only ${refN.length} entries, too few to judge how often entries are usually made.`,
    };
  const rRec = recN.length / recentDays;
  const rRef = refN.length / referenceDays;
  const ratio = rRec / rRef;
  const detected = ratio <= rule.maxRatio;
  return {
    ...base,
    status: detected ? "detected" : "not_detected",
    inputObservationIds: [],
    values: {
      recent_per_day: r2(rRec),
      reference_per_day: r2(rRef),
      ratio: r2(ratio),
      n_recent: recN.length,
      n_reference: refN.length,
    },
    direction: ratio < 1 ? "decrease" : ratio > 1 ? "increase" : null,
    explanation: detected
      ? `${r2(rRec)} entries per day recently vs ${r2(rRef)} in the reference period (${Math.round(ratio * 100)}%). Other results are based on less information than usual.`
      : `Entries per day (${r2(rRec)}) are ${Math.round(ratio * 100)}% of the reference rate.`,
  };
}

/** Earlier episode window shifted vs. prior reference, but recent window has returned within limits. */
function recoveryRule(ctx: Ctx, key: "heart_rate" | "sleep_duration" | "systolic"): EvidenceItem {
  const rule = ctx.cfg.numeric[key];
  const meta = NUMERIC_META[key];
  const { recentDays: R, referenceDays: F, episodeDays: E } = ctx.cfg.windows;
  const of = ctx.eligible.filter((n) => n.o.type === meta.type);
  const recN = of.filter((n) => inRange(n, ctx.T - days(R), ctx.T));
  const epN = of.filter((n) => inRange(n, ctx.T - days(R + E), ctx.T - days(R)));
  const priorN = of.filter((n) => inRange(n, ctx.T - days(R + F), ctx.T - days(R + E)));
  const episode: Window = { start: iso(ctx.T - days(R + E)), end: iso(ctx.T - days(R)) };
  const prior: Window = { start: iso(ctx.T - days(R + F)), end: iso(ctx.T - days(R + E)) };
  const base = {
    ruleId: `reversal.${key}`,
    ruleVersion: "1.0.0",
    title: `${meta.title}: earlier change, since returned toward reference`,
    category: "pattern_reversal" as const,
    domain: meta.domain,
    contributes: false,
    observationTypes: [meta.type],
    window: episode,
    referenceWindow: { ...prior, kind: "observation_history" as const },
    method:
      "Same change test as the personal-reference rule, applied to the earlier episode window vs. the prior reference, and to the recent window vs. the same prior reference. Detected when the episode shifted and the recent window did not.",
    limitations: [] as string[],
  };
  const ref = priorN.map((n) => numVal(n.o));
  const ep = epN.map((n) => numVal(n.o));
  const rec = recN.map((n) => numVal(n.o));
  if (ref.length < rule.minReference || ep.length < rule.minRecent || rec.length < rule.minRecent)
    return {
      ...base,
      status: "not_assessable",
      inputObservationIds: [],
      values: { n_prior: ref.length, n_episode: ep.length, n_recent: rec.length },
      direction: null,
      explanation: `Not enough ${meta.title.toLowerCase()} entries to check for an earlier change and return.`,
    };
  const a = shiftTest(ref, ep, rule, false);
  const b = shiftTest(ref, rec, rule, false);
  const detected = a.detected && !b.detected;
  return {
    ...base,
    status: detected ? "detected" : "not_detected",
    inputObservationIds: [...priorN, ...epN, ...recN].map((n) => n.o.id),
    values: {
      unit: meta.unit,
      prior_median: r2(a.refMed),
      episode_median: r2(a.recMed),
      recent_median: r2(b.recMed),
    },
    direction: detected ? (a.change > 0 ? "increase" : "decrease") : null,
    explanation: detected
      ? `Between ${episode.start.slice(0, 10)} and ${episode.end.slice(0, 10)} the median was ${r2(a.recMed)} ${meta.unit} vs ${r2(a.refMed)} before; recently it is ${r2(b.recMed)} ${meta.unit}, back within limits. Shown for context; it does not raise the review priority on its own.`
      : "No earlier change followed by a return was found in these windows.",
  };
}

/* ---------- Data quality ---------- */

function qualityFlags(ctx: Ctx, input: EngineInput, tz: string): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const { recentDays } = ctx.cfg.windows;
  const recN = ctx.eligible.filter((n) => inRange(n, ctx.T - days(recentDays), ctx.T));
  const last = ctx.eligible.at(-1);
  if (!last || ctx.T - last.t > days(ctx.cfg.quality.staleAfterDays))
    flags.push({
      code: "stale_data",
      severity: "limitation",
      detail: last
        ? `The latest entry was observed ${r2((ctx.T - last.t) / days(1))} days before the reference time.`
        : "No eligible entries in the evaluation window.",
    });
  // Longest run of local calendar days with no entries in the recent window (senior's time zone; DST-safe).
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const have = new Set(recN.map((n) => localDate(n.t, fmt)));
  let d = localDate(ctx.T - days(recentDays) + 1, fmt);
  const endD = localDate(ctx.T, fmt);
  let run = 0;
  let longest = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (have.has(d)) run = 0;
    else longest = Math.max(longest, ++run);
    if (d >= endD) break;
    d = nextCalendarDate(d);
  }
  if (longest >= ctx.cfg.reporting.longGapDays)
    flags.push({
      code: "long_gap",
      severity: "limitation",
      count: longest,
      detail: `${longest} consecutive days in the recent window have no entries at all.`,
    });
  const delayed = ctx.eligible.filter(
    (n) => Date.parse(n.o.recorded_at) - n.t > ctx.cfg.quality.delayedEntryHours * 3_600_000,
  ).length;
  if (delayed)
    flags.push({
      code: "delayed_entry",
      severity: "note",
      count: delayed,
      detail: `${delayed} entries were recorded more than ${ctx.cfg.quality.delayedEntryHours} h after they were observed; they are placed at their observed time.`,
    });
  const unverified = ctx.eligible.filter((n) => n.o.verification !== "verified").length;
  if (unverified)
    flags.push({
      code: "unverified_source",
      severity: "note",
      count: unverified,
      detail: `${unverified} of ${ctx.eligible.length} entries are unverified; results depend on their accuracy.`,
    });
  const missing = ["resting_heart_rate", "blood_pressure", "weight"].filter(
    (f) =>
      !input.baselines.some(
        (b) => b.field === f && b.status === "recorded" && Date.parse(b.captured_at) <= ctx.T,
      ),
  );
  if (missing.length)
    flags.push({
      code: "missing_baseline",
      severity: "note",
      detail: `No recorded baseline for: ${missing.join(", ").replace(/_/g, " ")}. Rules use observation history instead where enough exists.`,
    });
  return flags;
}

/* ---------- Public entry point ---------- */

export function assess(input: EngineInput, cfg: RiskConfig = DEFAULT_RISK_CONFIG): Assessment {
  const tzOk = validTimeZone(input.timeZone);
  const tz = tzOk ? input.timeZone : "UTC";
  const { T, eligible, flags, excluded } = normalize(input, cfg);
  const R = days(cfg.windows.recentDays);
  const F = days(cfg.windows.referenceDays);
  const ctx: Ctx = {
    T,
    cfg,
    eligible,
    baselines: input.baselines,
    recent: { start: iso(T - R), end: iso(T) },
    reference: { start: iso(T - R - F), end: iso(T - R) },
  };
  if (!tzOk)
    flags.push({
      code: "invalid_time_zone",
      severity: "limitation",
      detail: `Unknown time zone "${input.timeZone}"; UTC used for day boundaries.`,
    });
  flags.push(...qualityFlags(ctx, input, tz));

  const evidence: EvidenceItem[] = [];
  for (const k of ["heart_rate", "systolic", "sleep_duration", "weight"] as const)
    if (cfg.numeric[k].enabled) evidence.push(numericRule(ctx, k));
  if (cfg.bpVariability.enabled) evidence.push(bpVariabilityRule(ctx));
  for (const k of ["appetite", "hydration", "medication_event"] as const)
    if (cfg.categorical[k].enabled) evidence.push(categoricalRule(ctx, k));
  if (cfg.mobility.enabled) evidence.push(mobilityRule(ctx));
  if (cfg.reporting.enabled) evidence.push(reportingRule(ctx));
  for (const k of ["heart_rate", "systolic", "sleep_duration"] as const)
    if (cfg.numeric[k].enabled) evidence.push(recoveryRule(ctx, k));

  const changeRules = evidence.filter((e) => e.contributes);
  const assessable = changeRules.filter((e) => e.status !== "not_assessable");
  const notAssessable = changeRules.filter((e) => e.status === "not_assessable");
  // Domains, not rules, drive priority so correlated rules (e.g. BP level + BP variability) are not double-counted.
  const domains = [
    ...new Set(changeRules.filter((e) => e.status === "detected").map((e) => e.domain)),
  ].sort() as Domain[];
  const share = changeRules.length ? assessable.length / changeRules.length : 0;
  const a = cfg.aggregation;
  let priority: ReviewPriority;
  if (domains.length >= a.promptDomains) priority = "prompt_review_recommended";
  else if (domains.length >= a.recommendedDomains) priority = "review_recommended";
  else if (domains.length === 1) priority = "review_suggested";
  else if (share < a.minAssessableShare) priority = "unable_to_assess";
  else priority = "no_signal_detected";

  if (notAssessable.length)
    flags.push({
      code: "insufficient_samples",
      severity: "limitation",
      count: notAssessable.length,
      detail: `${notAssessable.length} of ${changeRules.length} change rules could not be evaluated with the available entries.`,
    });
  const status: QualityStatus =
    share < a.minAssessableShare
      ? "insufficient"
      : flags.some((f) => f.severity === "limitation")
        ? "limited"
        : "adequate";

  const inputDigest = `in-${fingerprint(
    canonicalJson(
      eligible.map((n) => [
        n.o.id,
        n.o.type,
        n.o.observed_at,
        n.o.value_numeric,
        n.o.value_numeric_2,
        n.o.value_text,
      ]),
    ),
  )}`;

  return {
    schemaVersion: 1,
    seniorId: input.seniorId,
    referenceTime: iso(T),
    evaluationWindow: { start: iso(T - R - F), end: iso(T) },
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    configFingerprint: configFingerprint(cfg),
    inputDigest,
    priority,
    changedDomains: domains,
    dataQuality: {
      status,
      flags,
      assessableRules: assessable.length,
      totalRules: changeRules.length,
    },
    evidence,
    insufficientReasons: notAssessable.map((e) => `${e.title}: ${e.explanation}`),
    inputCounts: { eligible: eligible.length, excluded },
  };
}

/** Earliest observed_at the engine can use for a reference time — for bounded queries. */
export function lookbackStart(
  referenceTime: string,
  cfg: RiskConfig = DEFAULT_RISK_CONFIG,
): string {
  return iso(Date.parse(referenceTime) - days(cfg.windows.recentDays + cfg.windows.referenceDays));
}
