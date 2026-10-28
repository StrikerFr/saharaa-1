// Phase 5 evaluation harness: runs the pure risk engine over a generated Phase 4 cohort.
// Evaluation-only (lives in src/synthetic/, never imported by app code). Ground truth is read ONLY
// after assessments are computed; engine inputs are built from observation/baseline fields alone.
import { assess, type Assessment, type EngineInput } from "@/risk/engine";
import { DEFAULT_RISK_CONFIG, type RiskConfig } from "@/risk/config";
import { defaultConfig, SCENARIOS, type Scenario } from "./config";
import { generate, type Dataset } from "./generate";

const DAY = 86_400_000;

/** Map a generated senior's records to engine input. Deliberately field-by-field: no labels pass through. */
export function engineInputFor(ds: Dataset, seniorId: string, referenceTime: string): EngineInput {
  const s = ds.seniors.find((x) => x.id === seniorId);
  if (!s) throw new Error("unknown senior");
  return {
    seniorId,
    timeZone: s.time_zone,
    referenceTime,
    observations: ds.observations
      .filter((o) => o.senior_id === seniorId)
      .map((o) => ({
        id: o.id,
        type: o.type,
        value_numeric: o.value_numeric,
        value_numeric_2: o.value_numeric_2,
        value_text: o.value_text,
        unit: o.unit,
        observed_at: o.observed_at,
        recorded_at: o.recorded_at,
        source: o.source,
        verification: o.verification,
      })),
    baselines: ds.baselines
      .filter((b) => b.senior_id === seniorId)
      .map((b) => ({
        field: b.field,
        status: b.status,
        value_numeric: b.value_numeric,
        value_numeric_2: b.value_numeric_2,
        unit: b.unit,
        captured_at: b.captured_at,
        recorded_at: b.recorded_at,
      })),
  };
}

/** Which engine domains a planted scenario is documented to affect (expected behaviour, see PHASE-5 doc). */
export const EXPECTED_DOMAINS: Record<Scenario, string[]> = {
  stable_control: [],
  gradual_weight_loss: ["weight", "intake"],
  correlated_decline: ["heart_rate", "sleep", "intake", "mobility"],
  increased_bp_variability: ["blood_pressure"],
  reduced_reporting: ["reporting"],
  temporary_deviation_recovery: ["heart_rate", "sleep"],
  incomplete_baseline: [],
  medication_adherence_decline: ["medication"],
};

const flagged = (a: Assessment) =>
  a.priority === "review_suggested" ||
  a.priority === "review_recommended" ||
  a.priority === "prompt_review_recommended";

export interface ScenarioResult {
  scenario: Scenario;
  seniors: number;
  /** Flagged (any review category) at the final checkpoint. */
  flaggedAtFinal: number;
  /** Expected domain detected at ≥1 checkpoint after onset (planted scenarios only). */
  expectedDetected: number | null;
  /** Median days from onset to first checkpoint detecting an expected domain. */
  medianDelayDays: number | null;
  /** Flagged at ≥1 checkpoint strictly before onset (planted) / at any checkpoint (controls). */
  flaggedBeforeOnsetOrAny: number;
  unableAtFinal: number;
  /** temporary_deviation_recovery only: reversal evidence detected at ≥1 checkpoint after the episode. */
  reversalDetected: number | null;
}
export interface EvaluationReport {
  datasetId: string;
  seed: string;
  engineVersion: string;
  rulesetVersion: string;
  configFingerprint: string;
  checkpoints: string[];
  assessments: number;
  byScenario: ScenarioResult[];
  bySignal: { ruleId: string; detected: number; notDetected: number; notAssessable: number }[];
  finalCheckpoint: {
    flagged: number;
    flaggedWithOngoingPlantedChange: number;
    ongoingPlantedSeniors: number;
    stableControlsFlagged: number;
    stableControls: number;
  };
  disclaimer: string;
}

/** Weekly checkpoints at local-day boundaries from `firstDay` to the last generated day. */
export function checkpoints(ds: Dataset, firstDay = 42, step = 7): { day: number; t: string }[] {
  const start = Date.parse(ds.meta.window_start);
  const out: { day: number; t: string }[] = [];
  const last = ds.meta.days - 1;
  for (let d = last; d >= firstDay; d -= step)
    out.unshift({ day: d, t: new Date(start + (d + 1) * DAY - 1).toISOString() });
  return out;
}

export function evaluate(
  seed: string,
  cfg: RiskConfig = DEFAULT_RISK_CONFIG,
  seniors = 200,
): EvaluationReport {
  const ds = generate(defaultConfig({ seed, seniors }));
  const cps = checkpoints(ds);
  // 1) Run engine blind.
  const runs = new Map<string, Assessment[]>();
  for (const s of ds.seniors)
    runs.set(
      s.id,
      cps.map((c) => assess(engineInputFor(ds, s.id, c.t), cfg)),
    );
  // 2) Only now read ground truth.
  const gt = new Map(ds.groundTruth.map((g) => [g.senior_id, g]));
  const sig = new Map<string, { detected: number; notDetected: number; notAssessable: number }>();
  for (const as of runs.values())
    for (const a of as)
      for (const e of a.evidence) {
        const r = sig.get(e.ruleId) ?? { detected: 0, notDetected: 0, notAssessable: 0 };
        if (e.status === "detected") r.detected++;
        else if (e.status === "not_detected") r.notDetected++;
        else r.notAssessable++;
        sig.set(e.ruleId, r);
      }

  const byScenario: ScenarioResult[] = SCENARIOS.map((sc) => {
    const ids = ds.groundTruth.filter((g) => g.scenario === sc).map((g) => g.senior_id);
    const expected = EXPECTED_DOMAINS[sc];
    let flaggedAtFinal = 0;
    let unable = 0;
    let expHit = 0;
    let early = 0;
    let rev = 0;
    const delays: number[] = [];
    for (const id of ids) {
      const as = runs.get(id) as Assessment[];
      const g = gt.get(id);
      const onset = g?.onset_day ?? null;
      const fin = as.at(-1) as Assessment;
      if (flagged(fin)) flaggedAtFinal++;
      if (fin.priority === "unable_to_assess") unable++;
      let first: number | null = null;
      as.forEach((a, i) => {
        const day = (cps[i] as { day: number }).day;
        if (onset === null ? flagged(a) : day < onset && flagged(a)) early++;
        if (
          onset !== null &&
          day >= onset &&
          first === null &&
          a.changedDomains.some((d) => expected.includes(d))
        )
          first = day;
        if (
          sc === "temporary_deviation_recovery" &&
          onset !== null &&
          day >= onset + (g?.duration_days ?? 0) &&
          a.evidence.some((e) => e.category === "pattern_reversal" && e.status === "detected")
        )
          rev++;
      });
      if (first !== null && onset !== null) {
        expHit++;
        delays.push(first - onset);
      }
    }
    const dedupEarly = ids.filter((id) => {
      const as = runs.get(id) as Assessment[];
      const onset = gt.get(id)?.onset_day ?? null;
      return as.some(
        (a, i) => flagged(a) && (onset === null || (cps[i] as { day: number }).day < onset),
      );
    }).length;
    void early;
    const revSeniors =
      sc === "temporary_deviation_recovery"
        ? ids.filter((id) => {
            const g = gt.get(id);
            const as = runs.get(id) as Assessment[];
            return as.some(
              (a, i) =>
                g?.onset_day != null &&
                (cps[i] as { day: number }).day >= g.onset_day + (g.duration_days ?? 0) &&
                a.evidence.some(
                  (e) => e.category === "pattern_reversal" && e.status === "detected",
                ),
            );
          }).length
        : null;
    void rev;
    return {
      scenario: sc,
      seniors: ids.length,
      flaggedAtFinal,
      expectedDetected: expected.length ? expHit : null,
      medianDelayDays: delays.length
        ? (delays.sort((a, b) => a - b)[delays.length >> 1] ?? null)
        : null,
      flaggedBeforeOnsetOrAny: dedupEarly,
      unableAtFinal: unable,
      reversalDetected: revSeniors,
    };
  });

  const ongoing = new Set<Scenario>([
    "gradual_weight_loss",
    "correlated_decline",
    "increased_bp_variability",
    "reduced_reporting",
    "medication_adherence_decline",
  ]);
  let fl = 0;
  let flOngoing = 0;
  let stableFl = 0;
  for (const s of ds.seniors) {
    const fin = (runs.get(s.id) as Assessment[]).at(-1) as Assessment;
    const sc = gt.get(s.id)?.scenario as Scenario;
    if (flagged(fin)) {
      fl++;
      if (ongoing.has(sc)) flOngoing++;
      if (sc === "stable_control") stableFl++;
    }
  }
  const a0 = (runs.values().next().value as Assessment[])[0] as Assessment;
  return {
    datasetId: ds.meta.dataset_id,
    seed,
    engineVersion: a0.engineVersion,
    rulesetVersion: a0.rulesetVersion,
    configFingerprint: a0.configFingerprint,
    checkpoints: cps.map((c) => c.t),
    assessments: ds.seniors.length * cps.length,
    byScenario,
    bySignal: [...sig.entries()]
      .map(([ruleId, v]) => ({ ruleId, ...v }))
      .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1)),
    finalCheckpoint: {
      flagged: fl,
      flaggedWithOngoingPlantedChange: flOngoing,
      ongoingPlantedSeniors: ds.groundTruth.filter((g) => ongoing.has(g.scenario)).length,
      stableControlsFlagged: stableFl,
      stableControls: ds.groundTruth.filter((g) => g.scenario === "stable_control").length,
    },
    disclaimer:
      "Synthetic evaluation of software behaviour on planted patterns. Not clinical validation; says nothing about real-world sensitivity, safety or outcomes.",
  };
}

export function formatEvaluation(r: EvaluationReport): string {
  const L: string[] = [];
  L.push(
    `Dataset ${r.datasetId} (seed ${r.seed}) · ${r.engineVersion} · ${r.rulesetVersion} · ${r.configFingerprint}`,
  );
  L.push(
    `${r.assessments} assessments at ${r.checkpoints.length} weekly checkpoints (${r.checkpoints[0]} … ${r.checkpoints.at(-1)})`,
  );
  L.push(
    "scenario | n | flagged@final | expected-domain detected after onset | median delay d | flagged before onset (controls: ever) | unable@final | reversal",
  );
  for (const s of r.byScenario)
    L.push(
      `${s.scenario} | ${s.seniors} | ${s.flaggedAtFinal}/${s.seniors} | ${s.expectedDetected === null ? "n/a" : `${s.expectedDetected}/${s.seniors}`} | ${s.medianDelayDays ?? "n/a"} | ${s.flaggedBeforeOnsetOrAny}/${s.seniors} | ${s.unableAtFinal}/${s.seniors} | ${s.reversalDetected === null ? "n/a" : `${s.reversalDetected}/${s.seniors}`}`,
    );
  const f = r.finalCheckpoint;
  L.push(
    `final: flagged ${f.flagged}; of which ongoing planted change ${f.flaggedWithOngoingPlantedChange} (precision vs ongoing-change label ${f.flagged ? ((f.flaggedWithOngoingPlantedChange / f.flagged) * 100).toFixed(1) : "n/a"}%); stable controls flagged ${f.stableControlsFlagged}/${f.stableControls}`,
  );
  L.push("rule | detected | not detected | not assessable");
  for (const s of r.bySignal)
    L.push(`${s.ruleId} | ${s.detected} | ${s.notDetected} | ${s.notAssessable}`);
  L.push(r.disclaimer);
  return L.join("\n");
}
