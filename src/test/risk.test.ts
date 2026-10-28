import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  assess,
  median,
  robustSigma,
  type EngineInput,
  type EngineObservation,
} from "@/risk/engine";
import { configFingerprint, DEFAULT_RISK_CONFIG, validateConfig } from "@/risk/config";
import { runRiskAssessmentInput } from "@/lib/risk.functions";
import { engineInputFor, evaluate } from "@/synthetic/evaluate";
import { generate } from "@/synthetic/generate";
import { defaultConfig } from "@/synthetic/config";

const T = "2026-10-20T12:00:00.000Z";
const DAY = 86_400_000;
const at = (daysBefore: number, hour = 0) =>
  new Date(Date.parse(T) - daysBefore * DAY + hour * 3_600_000).toISOString();
let n = 0;
const ob = (
  type: EngineObservation["type"],
  daysBefore: number,
  v: number | string,
  extra: Partial<EngineObservation> = {},
): EngineObservation => ({
  id: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
  type,
  value_numeric: typeof v === "number" ? v : null,
  value_numeric_2: type === "blood_pressure" ? 80 : null,
  value_text: typeof v === "string" ? v : null,
  unit:
    { heart_rate: "bpm", blood_pressure: "mmHg", weight: "kg", sleep_duration: "h" }[
      type as string
    ] ?? null,
  observed_at: at(daysBefore),
  recorded_at: new Date(Math.min(Date.parse(at(daysBefore, 1)), Date.parse(T))).toISOString(),
  source: "manual_entry",
  verification: "unverified",
  ...extra,
});
/** Daily heart-rate series: alternating ±1 around `ref` for 14–55 days ago, `recent` for 0–13 days ago. */
function hrSeries(ref: number, recent: number) {
  const out: EngineObservation[] = [];
  for (let d = 55; d >= 14; d--) out.push(ob("heart_rate", d, ref + (d % 2 ? 1 : -1)));
  for (let d = 13; d >= 0; d--) out.push(ob("heart_rate", d, recent + (d % 2 ? 1 : -1)));
  return out;
}
const input = (
  observations: EngineObservation[],
  extra: Partial<EngineInput> = {},
): EngineInput => ({
  seniorId: "11111111-1111-1111-1111-111111111111",
  timeZone: "Asia/Kolkata",
  referenceTime: T,
  observations,
  baselines: [],
  ...extra,
});
const rule = (a: ReturnType<typeof assess>, id: string) => a.evidence.find((e) => e.ruleId === id)!;

describe("risk engine — core", () => {
  it("is deterministic and versioned", () => {
    const i = input(hrSeries(70, 80));
    const a = assess(i);
    expect(assess(structuredClone(i))).toEqual(a);
    expect(a.engineVersion).toBe("sahaara-risk-engine/1.0.0");
    expect(a.rulesetVersion).toBe("ruleset/2026-10.1");
    expect(a.configFingerprint).toBe(configFingerprint(DEFAULT_RISK_CONFIG));
  });

  it("is independent of input order (out-of-order arrival)", () => {
    const obs = hrSeries(70, 80);
    expect(assess(input([...obs].reverse())).inputDigest).toBe(assess(input(obs)).inputDigest);
  });

  it("detects a sustained heart-rate increase and cites source observations", () => {
    const obs = hrSeries(70, 80);
    const e = rule(assess(input(obs)), "numeric_shift.heart_rate");
    expect(e.status).toBe("detected");
    expect(e.direction).toBe("increase");
    expect(e.values["change"]).toBe(10);
    expect(e.inputObservationIds.length).toBe(obs.length);
    expect(e.explanation).toMatch(/not a judgement about whether the value is medically normal/);
  });

  it("does not detect a change below the configured minimum", () => {
    expect(rule(assess(input(hrSeries(70, 73))), "numeric_shift.heart_rate").status).toBe(
      "not_detected",
    );
  });

  it("returns not_assessable (not 'no change') when samples are insufficient", () => {
    const obs = hrSeries(70, 80).filter(
      (o) => Date.parse(o.observed_at) > Date.parse(at(13)) || Number(o.id.slice(-2)) % 7 === 0,
    );
    const e = rule(assess(input(obs)), "numeric_shift.heart_rate");
    expect(e.status).toBe("not_assessable");
    expect(e.explanation).toMatch(/not evidence that nothing changed/);
  });

  it("returns unable_to_assess when most rules lack data, never a reassuring category", () => {
    const a = assess(input([ob("heart_rate", 1, 70)]));
    expect(a.priority).toBe("unable_to_assess");
    expect(a.dataQuality.status).toBe("insufficient");
    expect(a.insufficientReasons.length).toBeGreaterThan(0);
  });
});

describe("risk engine — temporal correctness and leakage", () => {
  it("ignores observations after the reference time", () => {
    const base = hrSeries(70, 70);
    const future = [ob("heart_rate", -1, 120), ob("heart_rate", -2, 120)];
    const a = assess(input([...base, ...future]));
    expect(a.inputDigest).toBe(assess(input(base)).inputDigest);
    expect(a.dataQuality.flags.find((f) => f.code === "excluded_future")?.count).toBe(2);
  });

  it("ignores entries observed before but recorded after the reference time (delayed entry)", () => {
    const base = hrSeries(70, 70);
    const late = ob("heart_rate", 1, 140, { recorded_at: at(-1) });
    expect(assess(input([...base, late])).inputDigest).toBe(assess(input(base)).inputDigest);
  });

  it("places delayed entries at their observed time and notes them", () => {
    const obs = hrSeries(70, 70).map((o, i) =>
      i % 5
        ? o
        : { ...o, recorded_at: new Date(Date.parse(o.observed_at) + 30 * 3_600_000).toISOString() },
    );
    const a = assess(input(obs));
    expect(a.dataQuality.flags.find((f) => f.code === "delayed_entry")?.count).toBeGreaterThan(0);
    expect(rule(a, "numeric_shift.heart_rate").status).toBe("not_detected");
  });

  it("historical recomputation at an earlier reference time is unaffected by later data", () => {
    const early = "2026-10-01T12:00:00.000Z";
    const obs = hrSeries(70, 80);
    const a1 = assess(input(obs, { referenceTime: early }));
    const a2 = assess(input([...obs, ob("weight", 0, 60)], { referenceTime: early }));
    expect(a2.inputDigest).toBe(a1.inputDigest);
    expect(a2.evidence).toEqual(a1.evidence);
    expect(a2.priority).toBe(a1.priority);
  });

  it("ground-truth labels cannot reach engine inputs from the synthetic harness", () => {
    const ds = generate(defaultConfig({ seniors: 16, days: 60 }));
    const s = ds.seniors[0]!;
    const json = JSON.stringify(engineInputFor(ds, s.id, ds.meta.window_end));
    for (const word of [
      "scenario",
      "onset",
      "ground",
      "expected",
      "affected",
      "stable_control",
      "SYNTHETIC",
    ])
      expect(json).not.toContain(word);
  });

  it("app code never imports synthetic/evaluation code", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      );
    const app = [
      ...walk("src/routes"),
      ...walk("src/components"),
      ...walk("src/lib"),
      ...walk("src/risk"),
    ];
    for (const f of app)
      expect(readFileSync(f, "utf8"), f).not.toMatch(/@\/synthetic|\.\.\/synthetic/);
  });
});

describe("risk engine — data quality", () => {
  it("collapses exact duplicates and excludes conflicting same-time entries", () => {
    const obs = hrSeries(70, 70);
    const dup = { ...obs[3]!, id: "ffffffff-0000-0000-0000-000000000001" };
    const conflict = { ...obs[4]!, id: "ffffffff-0000-0000-0000-000000000002", value_numeric: 99 };
    const a = assess(input([...obs, dup, conflict]));
    expect(a.dataQuality.flags.find((f) => f.code === "duplicate")?.count).toBe(1);
    expect(a.dataQuality.flags.find((f) => f.code === "conflict")?.count).toBe(2);
    expect(a.inputCounts.eligible).toBe(obs.length - 1);
  });

  it("keeps legitimate repeat measurements at different times", () => {
    const obs = hrSeries(70, 70);
    const repeat = ob("heart_rate", 2, 71, { observed_at: at(2, 6) });
    expect(assess(input([...obs, repeat])).inputCounts.eligible).toBe(obs.length + 1);
  });

  it("excludes wrong units and invalid values", () => {
    const a = assess(
      input([
        ...hrSeries(70, 70),
        ob("heart_rate", 3, 70, { unit: "kg" }),
        ob("heart_rate", 4, 999),
      ]),
    );
    expect(a.dataQuality.flags.map((f) => f.code)).toEqual(
      expect.arrayContaining(["unit_mismatch", "invalid_value"]),
    );
  });

  it("flags stale data and long gaps", () => {
    const obs = hrSeries(70, 70).filter((o) => Date.parse(o.observed_at) < Date.parse(at(6)));
    const codes = assess(input(obs)).dataQuality.flags.map((f) => f.code);
    expect(codes).toContain("stale_data");
    expect(codes).toContain("long_gap");
  });

  it("uses a recorded baseline only when history is insufficient, and rejects stale baselines", () => {
    const recent = [0, 3, 6, 9].map((d) => ob("weight", d, 60));
    const fresh = {
      field: "weight",
      status: "recorded" as const,
      value_numeric: 64,
      value_numeric_2: null,
      unit: "kg",
      captured_at: at(100),
      recorded_at: at(100),
    };
    const e = rule(assess(input(recent, { baselines: [fresh] })), "numeric_shift.weight");
    expect(e.referenceWindow?.kind).toBe("recorded_baseline");
    expect(e.status).toBe("detected");
    const stale = { ...fresh, captured_at: at(400), recorded_at: at(400) };
    expect(rule(assess(input(recent, { baselines: [stale] })), "numeric_shift.weight").status).toBe(
      "not_assessable",
    );
    const future = { ...fresh, captured_at: at(-5), recorded_at: at(-5) };
    expect(
      rule(assess(input(recent, { baselines: [future] })), "numeric_shift.weight").status,
    ).toBe("not_assessable");
  });

  it("does not treat missing categorical entries as normal", () => {
    const e = rule(assess(input(hrSeries(70, 70))), "categorical_shift.medication_event");
    expect(e.status).toBe("not_assessable");
  });

  it("flags a drop in reporting frequency as an operational signal", () => {
    const obs: EngineObservation[] = [];
    for (let d = 55; d >= 15; d--) obs.push(ob("heart_rate", d, 70), ob("sleep_duration", d, 7));
    obs.push(ob("heart_rate", 10, 70), ob("heart_rate", 2, 70));
    const e = rule(assess(input(obs)), "reporting.frequency");
    expect(e.status).toBe("detected");
    expect(e.method).toMatch(/not evidence of a change in the person/);
  });

  it("handles DST time zones without crashing day boundaries", () => {
    const a = assess(
      input(hrSeries(70, 70), {
        timeZone: "America/New_York",
        referenceTime: "2026-11-02T12:00:00.000Z",
      }),
    );
    expect(a.referenceTime).toBe("2026-11-02T12:00:00.000Z");
    expect(
      assess(input(hrSeries(70, 70), { timeZone: "Not/AZone" })).dataQuality.flags.map(
        (f) => f.code,
      ),
    ).toContain("invalid_time_zone");
  });
});

describe("risk engine — aggregation and configuration", () => {
  it("counts domains, not rules (BP level + BP variability = one domain)", () => {
    const obs: EngineObservation[] = [];
    for (let d = 55; d >= 15; d--) obs.push(ob("blood_pressure", d, 120 + (d % 2 ? 1 : -1)));
    for (let d = 13; d >= 0; d--) obs.push(ob("blood_pressure", d, 140 + (d % 2 ? 12 : -12)));
    const a = assess(input(obs));
    expect(rule(a, "numeric_shift.systolic").status).toBe("detected");
    expect(rule(a, "variability.blood_pressure").status).toBe("detected");
    expect(a.changedDomains).toEqual(["blood_pressure"]);
  });

  it("maps domain counts to the documented categories", () => {
    const one = assess(input(hrSeries(70, 80)));
    expect(one.changedDomains).toEqual(["heart_rate"]);
    expect(one.priority).toBe("review_suggested");
    const two = [...hrSeries(70, 80)];
    for (let d = 55; d >= 15; d--) two.push(ob("sleep_duration", d, 7 + (d % 2 ? 0.1 : -0.1)));
    for (let d = 13; d >= 0; d--) two.push(ob("sleep_duration", d, 5.5 + (d % 2 ? 0.1 : -0.1)));
    expect(assess(input(two)).priority).toBe("review_recommended");
  });

  it("reversal evidence never raises priority on its own", () => {
    const obs: EngineObservation[] = [];
    for (let d = 55; d >= 28; d--) obs.push(ob("heart_rate", d, 70 + (d % 2 ? 1 : -1)));
    for (let d = 27; d >= 14; d--) obs.push(ob("heart_rate", d, 82 + (d % 2 ? 1 : -1)));
    for (let d = 13; d >= 0; d--) obs.push(ob("heart_rate", d, 70 + (d % 2 ? 1 : -1)));
    const a = assess(input(obs));
    const rev = rule(a, "reversal.heart_rate");
    expect(rev.status).toBe("detected");
    expect(rev.contributes).toBe(false);
    expect(a.changedDomains).not.toContain("heart_rate");
  });

  it("rejects invalid or unknown configuration", () => {
    expect(() => validateConfig({ ...DEFAULT_RISK_CONFIG, extra: 1 })).toThrow();
    expect(() =>
      validateConfig({
        ...DEFAULT_RISK_CONFIG,
        windows: { recentDays: 0, referenceDays: 42, episodeDays: 14 },
      }),
    ).toThrow();
    const changed = validateConfig({
      ...DEFAULT_RISK_CONFIG,
      bpVariability: { ...DEFAULT_RISK_CONFIG.bpVariability, minRatio: 2 },
    });
    expect(configFingerprint(changed)).not.toBe(configFingerprint(DEFAULT_RISK_CONFIG));
  });

  it("server input accepts only a senior id and optional time — no thresholds or versions", () => {
    expect(() =>
      runRiskAssessmentInput.parse({
        seniorId: "11111111-1111-1111-1111-111111111111",
        config: {},
      }),
    ).toThrow();
    expect(() => runRiskAssessmentInput.parse({ seniorId: "not-a-uuid" })).toThrow();
    expect(
      runRiskAssessmentInput.parse({ seniorId: "11111111-1111-1111-1111-111111111111" }),
    ).toBeTruthy();
  });

  it("stats helpers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(robustSigma([1, 1, 1, 1])).toBe(0);
  });
});

describe("synthetic evaluation (small cohort)", () => {
  const r = evaluate("unit-eval", DEFAULT_RISK_CONFIG, 50);
  it("is reproducible", () => {
    expect(evaluate("unit-eval", DEFAULT_RISK_CONFIG, 50)).toEqual(r);
  });
  it("uses correct denominators", () => {
    const total = r.byScenario.reduce((a, s) => a + s.seniors, 0);
    expect(total).toBe(50);
    for (const s of r.byScenario) {
      expect(s.flaggedAtFinal).toBeLessThanOrEqual(s.seniors);
      if (s.expectedDetected !== null) expect(s.expectedDetected).toBeLessThanOrEqual(s.seniors);
    }
    expect(r.assessments).toBe(50 * r.checkpoints.length);
  });
  it("stable controls are mostly not flagged at the final checkpoint", () => {
    const c = r.byScenario.find((s) => s.scenario === "stable_control")!;
    expect(c.flaggedAtFinal / c.seniors).toBeLessThan(0.25);
  });
  it("correlated decline is detected in its expected domains", () => {
    const c = r.byScenario.find((s) => s.scenario === "correlated_decline")!;
    expect(c.expectedDetected).toBe(c.seniors);
  });
  it("labels itself as non-clinical", () => {
    expect(r.disclaimer).toMatch(/Not clinical validation/);
  });
});
