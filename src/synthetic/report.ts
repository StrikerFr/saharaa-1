// Data-quality summary and dataset manifest. No record contents, names, or credentials.
import { OBSERVATION_TYPES, SCENARIOS, SCHEDULE, type ObservationType } from "./config";
import type { Dataset } from "./generate";
import { sha256 } from "./rng";
import type { ValidationResult } from "./validate";

export interface QualityReport {
  seniors: number;
  baselines: { total: number; recorded: number; unknown: number };
  /** Denominator for every missingness rate below = scheduled opportunities. */
  byType: Record<
    ObservationType,
    { opportunities: number; generated: number; missing: number; missing_rate: number }
  >;
  totals: { opportunities: number; generated: number; missing: number; missing_rate: number };
  missingReasons: Record<string, number>;
  /** Per-senior missing rate (missing / that senior's opportunities). */
  perSeniorMissingRate: { min: number; p50: number; p90: number; max: number };
  gaps: { seniorsWithGapEpisode: number; gapLengths: Record<string, number> };
  delayedEntries: { count: number; rate_of_generated: number; definition: string };
  scenarios: Record<string, number>;
  coverage: { window_start: string; window_end: string; days: number };
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export function qualityReport(ds: Dataset): QualityReport {
  const byType = {} as QualityReport["byType"];
  for (const t of OBSERVATION_TYPES)
    byType[t] = { opportunities: 0, generated: 0, missing: 0, missing_rate: 0 };
  for (const o of ds.observations) byType[o.type].generated++;
  const reasons: Record<string, number> = {};
  const perSenior = new Map<string, { miss: number; total: number }>();
  for (const s of ds.seniors) perSenior.set(s.id, { miss: 0, total: 0 });
  for (const m of ds.missing) {
    byType[m.type].missing++;
    reasons[m.reason] = (reasons[m.reason] ?? 0) + 1;
    const p = perSenior.get(m.senior_id);
    if (p) p.miss++;
  }
  for (const o of ds.observations) {
    const p = perSenior.get(o.senior_id);
    if (p) p.total++;
  }
  for (const m of ds.missing) {
    const p = perSenior.get(m.senior_id);
    if (p) p.total++;
  }
  let opp = 0,
    gen = 0,
    miss = 0;
  for (const t of OBSERVATION_TYPES) {
    const b = byType[t];
    b.opportunities = b.generated + b.missing;
    b.missing_rate = r4(b.opportunities ? b.missing / b.opportunities : 0);
    opp += b.opportunities;
    gen += b.generated;
    miss += b.missing;
  }
  const rates = [...perSenior.values()]
    .map((p) => (p.total ? p.miss / p.total : 0))
    .sort((a, b) => a - b);
  const gapLengths: Record<string, number> = {};
  let withGap = 0;
  for (const g of ds.groundTruth) {
    if (g.details.gap) {
      withGap++;
      const k = String(g.details.gap.length_days);
      gapLengths[k] = (gapLengths[k] ?? 0) + 1;
    }
  }
  const delayed = ds.observations.filter(
    (o) => Date.parse(o.recorded_at) - Date.parse(o.observed_at) > 3_600_000,
  ).length;
  const scenarios: Record<string, number> = {};
  for (const s of SCENARIOS) scenarios[s] = 0;
  for (const g of ds.groundTruth) scenarios[g.scenario] = (scenarios[g.scenario] ?? 0) + 1;
  return {
    seniors: ds.seniors.length,
    baselines: {
      total: ds.baselines.length,
      recorded: ds.baselines.filter((b) => b.status === "recorded").length,
      unknown: ds.baselines.filter((b) => b.status === "unknown").length,
    },
    byType,
    totals: {
      opportunities: opp,
      generated: gen,
      missing: miss,
      missing_rate: r4(opp ? miss / opp : 0),
    },
    missingReasons: reasons,
    perSeniorMissingRate: {
      min: r4(rates[0] ?? 0),
      p50: r4(quantile(rates, 0.5)),
      p90: r4(quantile(rates, 0.9)),
      max: r4(rates[rates.length - 1] ?? 0),
    },
    gaps: { seniorsWithGapEpisode: withGap, gapLengths },
    delayedEntries: {
      count: delayed,
      rate_of_generated: r4(gen ? delayed / gen : 0),
      definition: "recorded_at − observed_at > 1 hour",
    },
    scenarios,
    coverage: {
      window_start: ds.meta.window_start,
      window_end: ds.meta.window_end,
      days: ds.meta.days,
    },
  };
}

/** Content fingerprint of the logical dataset (records + ground truth), used for identity checks. */
export function contentHash(ds: Dataset): string {
  return sha256(
    JSON.stringify([ds.meta.dataset_id, ds.seniors, ds.baselines, ds.observations, ds.groundTruth]),
  );
}

export function manifest(ds: Dataset, v: ValidationResult, q: QualityReport) {
  return {
    dataset_id: ds.meta.dataset_id,
    generator_version: ds.meta.generator_version,
    seed: ds.meta.seed,
    reference_date: ds.meta.reference_date,
    cohort_size: ds.seniors.length,
    historical_window: q.coverage,
    observation_types: Object.fromEntries(
      OBSERVATION_TYPES.map((t) => [t, { every_days: SCHEDULE[t].everyDays }]),
    ),
    counts: { baselines: q.baselines, observations: q.totals, by_type: q.byType },
    scenario_counts: q.scenarios,
    missingness_config: ds.meta.config.missingness,
    validation: { errors: v.errors.length, warnings: v.warnings.length },
    content_sha256: contentHash(ds),
  };
}

export function formatReport(q: QualityReport, v: ValidationResult): string {
  const lines = [
    `Seniors: ${q.seniors}`,
    `Baselines: ${q.baselines.total} (recorded ${q.baselines.recorded}, unknown ${q.baselines.unknown})`,
    `Window: ${q.coverage.window_start} → ${q.coverage.window_end} (${q.coverage.days} days)`,
    `Observations: ${q.totals.generated} generated of ${q.totals.opportunities} scheduled opportunities; ${q.totals.missing} missing (${(q.totals.missing_rate * 100).toFixed(2)}% of opportunities)`,
    "By type (missing % = missing / scheduled opportunities):",
    ...OBSERVATION_TYPES.map((t) => {
      const b = q.byType[t];
      return `  ${t.padEnd(17)} opp ${String(b.opportunities).padStart(6)}  gen ${String(b.generated).padStart(6)}  miss ${String(b.missing).padStart(5)} (${(b.missing_rate * 100).toFixed(1)}%)`;
    }),
    `Missing reasons: ${JSON.stringify(q.missingReasons)}`,
    `Per-senior missing rate: min ${q.perSeniorMissingRate.min} p50 ${q.perSeniorMissingRate.p50} p90 ${q.perSeniorMissingRate.p90} max ${q.perSeniorMissingRate.max}`,
    `Gap episodes: ${q.gaps.seniorsWithGapEpisode} seniors; lengths(days→count) ${JSON.stringify(q.gaps.gapLengths)}`,
    `Delayed entries (${q.delayedEntries.definition}): ${q.delayedEntries.count} (${(q.delayedEntries.rate_of_generated * 100).toFixed(1)}% of generated)`,
    `Scenarios: ${JSON.stringify(q.scenarios)}`,
    `Validation: ${v.errors.length} errors, ${v.warnings.length} warnings`,
    ...v.errors.slice(0, 20).map((e) => `  ERROR ${e}`),
    ...v.warnings.slice(0, 20).map((w) => `  WARN  ${w}`),
  ];
  return lines.join("\n");
}
