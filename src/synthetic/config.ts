// Synthetic cohort configuration (Phase 4). Values here are generation constraints for
// software testing, NOT clinical reference ranges or diagnostic thresholds.
import { sha256 } from "./rng";

export const GENERATOR_VERSION = "sahaara-synth/1.0.0";

export type ObservationType =
  | "heart_rate"
  | "blood_pressure"
  | "weight"
  | "sleep_duration"
  | "mobility"
  | "appetite"
  | "hydration"
  | "medication_event"
  | "care_note";

/** Sampling schedule: one opportunity every `everyDays` days at a local hour. */
export const SCHEDULE: Record<ObservationType, { everyDays: number; hour: number }> = {
  heart_rate: { everyDays: 1, hour: 8 },
  blood_pressure: { everyDays: 1, hour: 8 },
  sleep_duration: { everyDays: 1, hour: 9 },
  appetite: { everyDays: 1, hour: 13 },
  hydration: { everyDays: 1, hour: 17 },
  medication_event: { everyDays: 1, hour: 20 },
  mobility: { everyDays: 3, hour: 11 },
  weight: { everyDays: 7, hour: 9 },
  care_note: { everyDays: 14, hour: 16 },
};

export const OBSERVATION_TYPES = Object.keys(SCHEDULE) as ObservationType[];

/** Generator plausibility bounds (validation flags anything outside; never silently clipped). */
export const PLAUSIBILITY = {
  heart_rate: [40, 140],
  systolic: [85, 200],
  diastolic: [45, 120],
  weight: [35, 140],
  sleep_duration: [2, 12],
} as const;

export const SCENARIOS = [
  "stable_control",
  "gradual_weight_loss",
  "correlated_decline",
  "increased_bp_variability",
  "reduced_reporting",
  "temporary_deviation_recovery",
  "incomplete_baseline",
  "medication_adherence_decline",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Share of the cohort per scenario (sums to 1). */
export const DEFAULT_SCENARIO_MIX: Record<Scenario, number> = {
  stable_control: 0.4,
  gradual_weight_loss: 0.1,
  correlated_decline: 0.1,
  increased_bp_variability: 0.08,
  reduced_reporting: 0.08,
  temporary_deviation_recovery: 0.1,
  incomplete_baseline: 0.08,
  medication_adherence_decline: 0.06,
};

export interface MissingnessConfig {
  /** Per-senior base probability that a scheduled opportunity is not recorded, sampled in [min, max]. */
  baseMissRange: [number, number];
  /** Probability a senior has one multi-day gap where nothing is recorded. */
  gapEpisodeProbability: number;
  gapLengthDays: [number, number];
  /** Share of recorded observations entered late (2–36 h after observed_at). */
  delayedEntryRate: number;
}

export interface CohortConfig {
  seed: string;
  seniors: number;
  days: number;
  /** ISO date (YYYY-MM-DD). Last day of history. Must not be in the future. */
  referenceDate: string;
  scenarioMix: Record<Scenario, number>;
  missingness: MissingnessConfig;
}

export const LIMITS = { seniors: [1, 1000], days: [7, 90] } as const;

export function defaultConfig(overrides: Partial<CohortConfig> = {}): CohortConfig {
  return {
    seed: "sahaara-phase4",
    seniors: 200,
    days: 90,
    referenceDate: "2026-10-20",
    scenarioMix: DEFAULT_SCENARIO_MIX,
    missingness: {
      baseMissRange: [0.03, 0.15],
      gapEpisodeProbability: 0.25,
      gapLengthDays: [2, 6],
      delayedEntryRate: 0.08,
    },
    ...overrides,
  };
}

export function configErrors(c: CohortConfig): string[] {
  const e: string[] = [];
  if (
    !Number.isInteger(c.seniors) ||
    c.seniors < LIMITS.seniors[0] ||
    c.seniors > LIMITS.seniors[1]
  )
    e.push(`seniors must be an integer in ${LIMITS.seniors.join("–")}`);
  if (!Number.isInteger(c.days) || c.days < LIMITS.days[0] || c.days > LIMITS.days[1])
    e.push(`days must be an integer in ${LIMITS.days.join("–")}`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(c.referenceDate) ||
    Number.isNaN(Date.parse(`${c.referenceDate}T00:00:00Z`))
  )
    e.push("referenceDate must be YYYY-MM-DD");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(c.seed)) e.push("seed must be 1–64 chars of [A-Za-z0-9._-]");
  const mix = Object.values(c.scenarioMix).reduce((a, b) => a + b, 0);
  if (Math.abs(mix - 1) > 1e-6) e.push("scenarioMix must sum to 1");
  const [lo, hi] = c.missingness.baseMissRange;
  if (!(lo >= 0 && hi <= 0.5 && lo <= hi)) e.push("baseMissRange must be within 0–0.5");
  return e;
}

/** Dataset identity: derived from generator version + full configuration. */
export function datasetId(c: CohortConfig): string {
  return `syn-${sha256(JSON.stringify([GENERATOR_VERSION, c])).slice(0, 16)}`;
}
