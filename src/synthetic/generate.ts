// Deterministic synthetic cohort generator (Phase 4). Server/CLI only — never import from app code.
// Model per numeric measure: value(t) = personal baseline + AR(1) noise + scenario delta(t).
// Categorical measures: per-day weighted draw whose weights shift under a scenario.
import {
  GENERATOR_VERSION,
  OBSERVATION_TYPES,
  SCENARIOS,
  SCHEDULE,
  datasetId,
  type CohortConfig,
  type ObservationType,
  type Scenario,
} from "./config";
import { stableUuid, stream, type Rng } from "./rng";

export const SYNTHETIC_TZ = "Asia/Kolkata";
const TZ_OFFSET_MIN = 330; // Asia/Kolkata has no DST.
export const CARE_NOTE_TEXT = "Synthetic routine check-in recorded for software testing.";
export const SYNTHETIC_CONTEXT =
  "SYNTHETIC TEST RECORD — fictional person generated for software testing. Not a real senior.";

export interface SeniorRecord {
  id: string;
  record_code: string;
  display_name: string;
  date_of_birth: string;
  preferred_language: "en" | "hi" | "other";
  time_zone: string;
  care_status: "active";
  care_context: string;
  is_synthetic: true;
}
export interface BaselineRecord {
  id: string;
  senior_id: string;
  field: "resting_heart_rate" | "blood_pressure" | "weight" | "mobility" | "hearing" | "vision";
  status: "recorded" | "unknown" | "not_applicable";
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
  unit: string | null;
  captured_at: string;
  recorded_at: string;
  source: "imported";
  verification: "unverified";
}
export interface ObservationRecord {
  id: string;
  client_request_id: string;
  senior_id: string;
  type: ObservationType;
  value_numeric: number | null;
  value_numeric_2: number | null;
  value_text: string | null;
  unit: string | null;
  note: string | null;
  observed_at: string;
  recorded_at: string;
  source: "imported";
  verification: "unverified";
}
export type MissReason = "random" | "gap" | "reduced_reporting";
export interface MissingOpportunity {
  senior_id: string;
  type: ObservationType;
  day: number;
  reason: MissReason;
}
export interface GroundTruth {
  senior_id: string;
  scenario: Scenario;
  onset_day: number | null;
  duration_days: number | null;
  affected_types: string[];
  details: { expected: string; gap: { start_day: number; length_days: number } | null };
}
export interface Dataset {
  meta: {
    dataset_id: string;
    generator_version: string;
    seed: string;
    reference_date: string;
    days: number;
    window_start: string;
    window_end: string;
    config: CohortConfig;
  };
  seniors: SeniorRecord[];
  baselines: BaselineRecord[];
  observations: ObservationRecord[];
  missing: MissingOpportunity[];
  groundTruth: GroundTruth[];
}

const GIVEN = [
  "Asha",
  "Ravi",
  "Meera",
  "Joseph",
  "Fatima",
  "Arjun",
  "Lakshmi",
  "Daniel",
  "Noor",
  "Suresh",
  "Grace",
  "Imran",
  "Kavita",
  "Thomas",
  "Leela",
  "Harpreet",
  "Mei",
  "Samuel",
  "Anjali",
  "Victor",
  "Zara",
  "Gopal",
  "Rosa",
  "Kiran",
  "Elena",
  "Mohan",
  "Priya",
  "Yusuf",
  "Shanti",
  "Paul",
];
const LANGS = ["en", "hi", "other"] as const;
const MOBILITY = ["independent", "uses_aid", "needs_assistance", "bed_bound"] as const;
const SENSE = [
  "no_difficulty",
  "some_difficulty",
  "significant_difficulty",
  "uses_device",
] as const;

function weighted<T extends string>(r: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = r.next() * total;
  for (const [v, w] of items) {
    if ((x -= w) < 0) return v;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error("weighted: empty");
  return last[0];
}

function within(r: Rng, mean: number, sd: number, lo: number, hi: number): number {
  for (let k = 0; k < 100; k++) {
    const x = r.normal(mean, sd);
    if (x >= lo && x <= hi) return x;
  }
  return mean;
}

const DAY_MS = 86_400_000;
function dayStartUtcMs(referenceDate: string, days: number, day: number): number {
  return (
    Date.parse(`${referenceDate}T00:00:00Z`) - (days - 1 - day) * DAY_MS - TZ_OFFSET_MIN * 60_000
  );
}
const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Deterministic scenario assignment: exact counts from the mix, order shuffled by seed. */
export function assignScenarios(c: CohortConfig): Scenario[] {
  const counts = SCENARIOS.map((s) => Math.floor(c.scenarioMix[s] * c.seniors));
  let assigned = counts.reduce((a, b) => a + b, 0);
  for (let i = 0; assigned < c.seniors; i = (i + 1) % SCENARIOS.length, assigned++)
    counts[i] = (counts[i] ?? 0) + 1;
  const list: Scenario[] = [];
  SCENARIOS.forEach((s, i) => {
    for (let k = 0; k < (counts[i] ?? 0); k++) list.push(s);
  });
  const r = stream(c.seed, "scenario-shuffle");
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    const a = list[i] as Scenario;
    list[i] = list[j] as Scenario;
    list[j] = a;
  }
  return list;
}

export function generate(c: CohortConfig): Dataset {
  const dsId = datasetId(c);
  const codePrefix = `S${dsId.slice(4, 8).toUpperCase()}`;
  const scenarios = assignScenarios(c);
  const refEndMs = dayStartUtcMs(c.referenceDate, c.days, c.days - 1) + DAY_MS - 60_000;
  const ds: Dataset = {
    meta: {
      dataset_id: dsId,
      generator_version: GENERATOR_VERSION,
      seed: c.seed,
      reference_date: c.referenceDate,
      days: c.days,
      window_start: iso(dayStartUtcMs(c.referenceDate, c.days, 0)),
      window_end: iso(refEndMs),
      config: c,
    },
    seniors: [],
    baselines: [],
    observations: [],
    missing: [],
    groundTruth: [],
  };

  for (let i = 0; i < c.seniors; i++) {
    const scenario = scenarios[i] as Scenario;
    const pr = stream(c.seed, "profile", i);
    const sid = stableUuid(dsId, "senior", i);
    const n = String(i + 1).padStart(4, "0");
    const age = pr.int(65, 95);
    const refYear = Number(c.referenceDate.slice(0, 4));
    ds.seniors.push({
      id: sid,
      record_code: `${codePrefix}-${n}`,
      display_name: `Synthetic ${pr.pick(GIVEN)} ${n}`,
      date_of_birth: `${refYear - age}-${String(pr.int(1, 12)).padStart(2, "0")}-${String(pr.int(1, 28)).padStart(2, "0")}`,
      preferred_language: weighted(pr, [
        [LANGS[0], 0.45],
        [LANGS[1], 0.45],
        [LANGS[2], 0.1],
      ]),
      time_zone: SYNTHETIC_TZ,
      care_status: "active",
      care_context: SYNTHETIC_CONTEXT,
      is_synthetic: true,
    });

    // Personal baselines (true underlying values).
    const hr0 = pr.normal(72, 6);
    // Personal means are rejection-sampled into documented generation ranges (not clipped).
    const sys0 = within(pr, 128, 10, 108, 155);
    const dia0 = Math.min(sys0 - 30, within(pr, 78, 6, 66, 90));
    const wt0 = pr.range(48, 88);
    const sleep0 = pr.normal(7, 0.6);
    const mob0 = weighted(pr, [
      [MOBILITY[0], 0.6],
      [MOBILITY[1], 0.3],
      [MOBILITY[2], 0.1],
    ]);
    const missBase = pr.range(c.missingness.baseMissRange[0], c.missingness.baseMissRange[1]);

    // Scenario parameters.
    const sr = stream(c.seed, "scenario", i);
    const onset =
      scenario === "stable_control" || scenario === "incomplete_baseline"
        ? null
        : sr.int(Math.floor(c.days * 0.3), Math.floor(c.days * 0.7));
    const tempLen = sr.int(5, 9);
    const duration =
      onset === null
        ? null
        : scenario === "temporary_deviation_recovery"
          ? tempLen
          : c.days - onset;
    const wtLossPct = sr.range(0.04, 0.07);
    const hrRise = sr.range(6, 12);
    const sleepDrop = sr.range(1, 1.8);
    const ramp = (d: number) =>
      onset === null ? 0 : clamp01((d - onset) / Math.max(1, c.days - 1 - onset));
    const inTemp = (d: number) => onset !== null && d >= onset && d < onset + tempLen;
    const active = (s: Scenario) => scenario === s;

    // Gap episode (all types missing for consecutive days).
    const gr = stream(c.seed, "gap", i);
    let gap: { start_day: number; length_days: number } | null = null;
    if (gr.chance(c.missingness.gapEpisodeProbability)) {
      const len = gr.int(c.missingness.gapLengthDays[0], c.missingness.gapLengthDays[1]);
      gap = { start_day: gr.int(0, c.days - len), length_days: len };
    }

    const affected: Record<Scenario, ObservationType[]> = {
      stable_control: [],
      gradual_weight_loss: ["weight", "appetite"],
      correlated_decline: ["heart_rate", "sleep_duration", "appetite", "hydration", "mobility"],
      increased_bp_variability: ["blood_pressure"],
      reduced_reporting: [...OBSERVATION_TYPES],
      temporary_deviation_recovery: ["heart_rate", "sleep_duration"],
      incomplete_baseline: [],
      medication_adherence_decline: ["medication_event"],
    };
    const expected: Record<Scenario, string> = {
      stable_control: "No planted change; negative control.",
      gradual_weight_loss: `Weight declines linearly by about ${(wtLossPct * 100).toFixed(1)}% from onset to window end; appetite 'reduced' becomes more frequent.`,
      correlated_decline: `From onset: heart rate rises up to ~${hrRise.toFixed(0)} bpm, sleep falls up to ~${sleepDrop.toFixed(1)} h, appetite/hydration 'reduced' more frequent, mobility worsens one step in the second half.`,
      increased_bp_variability:
        "From onset: blood-pressure day-to-day variability rises ~2x with no mean shift.",
      reduced_reporting:
        "From onset: the share of scheduled opportunities that are recorded falls sharply.",
      temporary_deviation_recovery: `Heart rate +~10 bpm and sleep −~1.5 h for ${tempLen} days, then return to baseline.`,
      incomplete_baseline: "Several baseline fields are 'unknown'; observations otherwise stable.",
      medication_adherence_decline:
        "From onset: 'missed' medication events become progressively more frequent.",
    };
    ds.groundTruth.push({
      senior_id: sid,
      scenario,
      onset_day: onset,
      duration_days: duration,
      affected_types: affected[scenario],
      details: { expected: expected[scenario], gap },
    });

    // Baselines, captured a week before the window.
    const br = stream(c.seed, "baseline", i);
    const capMs = dayStartUtcMs(c.referenceDate, c.days, 0) - 7 * DAY_MS + 10 * 3_600_000;
    const unknownFields = new Set<string>();
    if (scenario === "incomplete_baseline") {
      const fields = [
        "resting_heart_rate",
        "blood_pressure",
        "weight",
        "mobility",
        "hearing",
        "vision",
      ];
      const k = br.int(3, 4);
      while (unknownFields.size < k) unknownFields.add(br.pick(fields));
    }
    const baseline = (
      field: BaselineRecord["field"],
      v: Pick<BaselineRecord, "value_numeric" | "value_numeric_2" | "value_text" | "unit">,
    ) => {
      const unknown = unknownFields.has(field);
      ds.baselines.push({
        id: stableUuid(dsId, "baseline", i, field),
        senior_id: sid,
        field,
        status: unknown ? "unknown" : "recorded",
        ...(unknown
          ? { value_numeric: null, value_numeric_2: null, value_text: null, unit: null }
          : v),
        captured_at: iso(capMs),
        recorded_at: iso(capMs + 20 * 60_000),
        source: "imported",
        verification: "unverified",
      });
    };
    const none = { value_numeric_2: null, value_text: null };
    baseline("resting_heart_rate", { value_numeric: Math.round(hr0), ...none, unit: "bpm" });
    baseline("blood_pressure", {
      value_numeric: Math.round(sys0),
      value_numeric_2: Math.round(dia0),
      value_text: null,
      unit: "mmHg",
    });
    baseline("weight", { value_numeric: round1(wt0), ...none, unit: "kg" });
    baseline("mobility", {
      value_numeric: null,
      value_numeric_2: null,
      value_text: mob0,
      unit: null,
    });
    baseline("hearing", {
      value_numeric: null,
      value_numeric_2: null,
      value_text: weighted(br, [
        [SENSE[0], 0.6],
        [SENSE[1], 0.25],
        [SENSE[2], 0.05],
        [SENSE[3], 0.1],
      ]),
      unit: null,
    });
    baseline("vision", {
      value_numeric: null,
      value_numeric_2: null,
      value_text: weighted(br, [
        [SENSE[0], 0.5],
        [SENSE[1], 0.3],
        [SENSE[2], 0.05],
        [SENSE[3], 0.15],
      ]),
      unit: null,
    });

    // Observations.
    for (const type of OBSERVATION_TYPES) {
      const or = stream(c.seed, "obs", i, type);
      const mr = stream(c.seed, "miss", i, type);
      let ar = 0;
      let ar2 = 0;
      const { everyDays, hour } = SCHEDULE[type];
      const phase = or.int(0, everyDays - 1);
      for (let d = phase; d < c.days; d += everyDays) {
        // Value first (so the noise path does not depend on missingness).
        const bpSd = active("increased_bp_variability") && onset !== null && d >= onset ? 2 : 1;
        ar = 0.6 * ar + or.normal(0, 1);
        ar2 = 0.6 * ar2 + or.normal(0, 1);
        const temp = active("temporary_deviation_recovery") && inTemp(d);
        const corr = active("correlated_decline") ? ramp(d) : 0;
        let v: Pick<
          ObservationRecord,
          "value_numeric" | "value_numeric_2" | "value_text" | "unit" | "note"
        >;
        const catNone = { value_numeric: null, value_numeric_2: null, unit: null, note: null };
        switch (type) {
          case "heart_rate":
            v = {
              value_numeric: Math.round(hr0 + 3 * ar + hrRise * corr + (temp ? 10 : 0)),
              value_numeric_2: null,
              value_text: null,
              unit: "bpm",
              note: null,
            };
            break;
          case "blood_pressure": {
            const s = Math.round(sys0 + 4 * bpSd * ar);
            const dd = Math.round(Math.min(s - 25, dia0 + 2.5 * bpSd * ar2));
            v = {
              value_numeric: s,
              value_numeric_2: dd,
              value_text: null,
              unit: "mmHg",
              note: null,
            };
            break;
          }
          case "weight": {
            const loss = active("gradual_weight_loss") ? wtLossPct * ramp(d) : 0;
            v = {
              value_numeric: round1(wt0 * (1 - loss) + 0.3 * ar),
              value_numeric_2: null,
              value_text: null,
              unit: "kg",
              note: null,
            };
            break;
          }
          case "sleep_duration":
            v = {
              value_numeric: round1(sleep0 + 0.5 * ar - sleepDrop * corr - (temp ? 1.5 : 0)),
              value_numeric_2: null,
              value_text: null,
              unit: "h",
              note: null,
            };
            break;
          case "appetite":
          case "hydration": {
            const shift = Math.max(
              corr * 0.45,
              active("gradual_weight_loss") && type === "appetite" ? ramp(d) * 0.35 : 0,
            );
            v = {
              ...catNone,
              value_text: weighted(or, [
                ["usual", 0.88 - shift],
                ["reduced", 0.07 + shift],
                ["increased", 0.04],
                ["refused", 0.01],
              ]),
            };
            break;
          }
          case "medication_event": {
            const m = active("medication_adherence_decline") ? ramp(d) * 0.32 : 0;
            v = {
              ...catNone,
              value_text: weighted(or, [
                ["taken", 0.93 - m],
                ["partially_taken", 0.03],
                ["missed", 0.035 + m],
                ["refused", 0.005],
              ]),
            };
            break;
          }
          case "mobility": {
            const idx = MOBILITY.indexOf(mob0) + (corr > 0.5 ? 1 : 0);
            const jitter = or.chance(0.04) ? 1 : 0;
            v = { ...catNone, value_text: MOBILITY[Math.min(3, idx + jitter)] ?? mob0 };
            break;
          }
          case "care_note":
            v = {
              value_numeric: null,
              value_numeric_2: null,
              value_text: null,
              unit: null,
              note: CARE_NOTE_TEXT,
            };
            break;
        }

        // Missingness decision.
        let reason: MissReason | null = null;
        if (gap && d >= gap.start_day && d < gap.start_day + gap.length_days) reason = "gap";
        else if (active("reduced_reporting") && onset !== null && d >= onset && mr.chance(0.55))
          reason = "reduced_reporting";
        else if (mr.chance(missBase)) reason = "random";
        // Always consume the same draws regardless of branch, keeping later days stable.
        const jitterMin = mr.int(-40, 40);
        const delayed = mr.chance(c.missingness.delayedEntryRate);
        const delayMin = delayed ? mr.int(120, 36 * 60) : mr.int(2, 30);
        if (reason) {
          ds.missing.push({ senior_id: sid, type, day: d, reason });
          continue;
        }
        const obsMs =
          dayStartUtcMs(c.referenceDate, c.days, d) + hour * 3_600_000 + jitterMin * 60_000;
        const recMs = Math.min(obsMs + delayMin * 60_000, refEndMs);
        ds.observations.push({
          id: stableUuid(dsId, "obs", i, type, d),
          client_request_id: stableUuid(dsId, "obs-req", i, type, d),
          senior_id: sid,
          type,
          ...v,
          observed_at: iso(obsMs),
          recorded_at: iso(Math.max(recMs, obsMs)),
          source: "imported",
          verification: "unverified",
        });
      }
    }
  }
  return ds;
}

/** Scheduled opportunities per senior for a window (independent of missingness). */
export function expectedOpportunitiesPerSenior(
  days: number,
): Record<ObservationType, [number, number]> {
  const out = {} as Record<ObservationType, [number, number]>;
  for (const t of OBSERVATION_TYPES) {
    const e = SCHEDULE[t].everyDays;
    out[t] = [Math.floor((days - (e - 1) - 1) / e) + 1, Math.ceil(days / e)]; // [min, max] depending on phase
  }
  return out;
}
