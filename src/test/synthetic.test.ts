import { describe, expect, it } from "vitest";
import {
  OBSERVATION_TYPES,
  SCENARIOS,
  configErrors,
  datasetId,
  defaultConfig,
} from "@/synthetic/config";
import {
  CARE_NOTE_TEXT,
  assignScenarios,
  expectedOpportunitiesPerSenior,
  generate,
} from "@/synthetic/generate";
import { validate } from "@/synthetic/validate";
import { contentHash, qualityReport } from "@/synthetic/report";
import { buildSqlBatches } from "@/synthetic/sql";
import { Rng, stableUuid } from "@/synthetic/rng";

const NOW = new Date("2026-10-27T00:00:00Z");
const small = defaultConfig({ seniors: 24, days: 30 });

describe("synthetic generator", () => {
  it("is deterministic for the same seed and config", () => {
    expect(contentHash(generate(small))).toBe(contentHash(generate(small)));
  });

  it("produces different datasets for different seeds", () => {
    const other = generate({ ...small, seed: "other-seed" });
    expect(datasetId(other.meta.config)).not.toBe(datasetId(small));
    expect(contentHash(other)).not.toBe(contentHash(generate(small)));
  });

  it("PRNG is reproducible and stable UUIDs are well formed", () => {
    const a = new Rng("x"),
      b = new Rng("x");
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(stableUuid("a", 1)).toBe(stableUuid("a", 1));
    expect(stableUuid("a", 1)).not.toBe(stableUuid("a", 2));
    expect(stableUuid("a", 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("default config generates 200 seniors over 90 days with no validation errors", () => {
    const ds = generate(defaultConfig());
    expect(ds.seniors).toHaveLength(200);
    expect(ds.meta.days).toBe(90);
    expect(validate(ds, NOW).errors).toEqual([]);
    const ids = new Set([...ds.seniors, ...ds.baselines, ...ds.observations].map((r) => r.id));
    expect(ids.size).toBe(ds.seniors.length + ds.baselines.length + ds.observations.length);
  });

  it("opportunities = generated + missing and match the schedule", () => {
    const ds = generate(small);
    const q = qualityReport(ds);
    const bounds = expectedOpportunitiesPerSenior(small.days);
    for (const t of OBSERVATION_TYPES) {
      const [lo, hi] = bounds[t];
      expect(q.byType[t].opportunities).toBeGreaterThanOrEqual(lo * small.seniors);
      expect(q.byType[t].opportunities).toBeLessThanOrEqual(hi * small.seniors);
      expect(q.byType[t].generated + q.byType[t].missing).toBe(q.byType[t].opportunities);
    }
    expect(bounds.heart_rate).toEqual([30, 30]);
    expect(bounds.weight).toEqual([4, 5]);
  });

  it("missing opportunities never appear as observations", () => {
    const ds = generate(small);
    const keys = new Set(ds.observations.map((o) => `${o.senior_id}|${o.type}|${o.id}`));
    for (const m of ds.missing) {
      const idx = ds.seniors.findIndex((s) => s.id === m.senior_id);
      expect(
        keys.has(
          `${m.senior_id}|${m.type}|${stableUuid(ds.meta.dataset_id, "obs", idx, m.type, m.day)}`,
        ),
      ).toBe(false);
    }
  });

  it("delayed entries keep recorded_at after observed_at and inside the window", () => {
    const ds = generate(defaultConfig({ seniors: 40 }));
    const delayed = ds.observations.filter(
      (o) => Date.parse(o.recorded_at) - Date.parse(o.observed_at) > 3_600_000,
    );
    expect(delayed.length).toBeGreaterThan(0);
    for (const o of ds.observations) {
      expect(Date.parse(o.recorded_at)).toBeGreaterThanOrEqual(Date.parse(o.observed_at));
      expect(Date.parse(o.recorded_at)).toBeLessThanOrEqual(Date.parse(ds.meta.window_end));
      expect(Date.parse(o.observed_at)).toBeGreaterThanOrEqual(Date.parse(ds.meta.window_start));
    }
  });

  it("assigns scenarios with exact counts from the mix and includes controls", () => {
    const s = assignScenarios(defaultConfig());
    const count = (x: string) => s.filter((v) => v === x).length;
    expect(s).toHaveLength(200);
    expect(count("stable_control")).toBe(80);
    expect(count("medication_adherence_decline")).toBe(12);
  });

  it("ground truth: onset inside window, temporary scenario recovers, incomplete baselines are unknown", () => {
    const ds = generate(defaultConfig({ seniors: 60 }));
    for (const g of ds.groundTruth) {
      if (g.scenario === "stable_control" || g.scenario === "incomplete_baseline")
        expect(g.onset_day).toBeNull();
      else expect(g.onset_day).toBeGreaterThanOrEqual(0);
      if (g.scenario === "temporary_deviation_recovery")
        expect(g.duration_days).toBeLessThanOrEqual(9);
    }
    const inc = ds.groundTruth.find((g) => g.scenario === "incomplete_baseline");
    expect(inc).toBeDefined();
    const unknown = ds.baselines.filter(
      (b) => b.senior_id === inc?.senior_id && b.status === "unknown",
    );
    expect(unknown.length).toBeGreaterThanOrEqual(3);
  });

  it("gradual weight loss lowers late weights versus early weights", () => {
    const ds = generate(defaultConfig({ seniors: 100 }));
    const g = ds.groundTruth.find((x) => x.scenario === "gradual_weight_loss");
    const w = ds.observations
      .filter((o) => o.senior_id === g?.senior_id && o.type === "weight")
      .map((o) => o.value_numeric ?? 0);
    expect(w.length).toBeGreaterThan(6);
    expect(w[w.length - 1] ?? 0).toBeLessThan(w[0] ?? 0);
  });

  it("labels never leak into observation or profile text", () => {
    const ds = generate(small);
    const text = JSON.stringify([ds.seniors, ds.observations.map((o) => o.note)]);
    for (const s of SCENARIOS) expect(text.includes(s)).toBe(false);
    expect(
      ds.observations.filter((o) => o.type === "care_note").every((o) => o.note === CARE_NOTE_TEXT),
    ).toBe(true);
  });

  it("every senior is clearly synthetic and has no contact details", () => {
    const ds = generate(small);
    for (const s of ds.seniors) {
      expect(s.is_synthetic).toBe(true);
      expect(s.display_name.startsWith("Synthetic ")).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/@|phone|email|address/i);
    }
  });
});

describe("validation blocks bad datasets", () => {
  it("rejects malformed values, broken references, duplicates and future windows", () => {
    const ds = generate(small);
    const bad = structuredClone(ds);
    const o0 = bad.observations[0];
    const o1 = bad.observations[1];
    if (!o0 || !o1) throw new Error("fixture");
    o0.value_numeric = null; // missing value disguised as an observation
    o1.senior_id = "00000000-0000-5000-8000-000000000000";
    bad.observations.push({ ...o1 });
    const v = validate(bad, NOW);
    expect(v.errors.some((e) => e.includes("value shape"))).toBe(true);
    expect(v.errors.some((e) => e.includes("unknown senior"))).toBe(true);
    expect(v.errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(
      validate(ds, new Date("2026-10-01T00:00:00Z")).errors.some((e) => e.includes("future")),
    ).toBe(true);
  });

  it("rejects out-of-bounds configuration", () => {
    expect(configErrors(defaultConfig({ days: 120 }))).not.toEqual([]);
    expect(configErrors(defaultConfig({ seniors: 0 }))).not.toEqual([]);
    expect(configErrors(defaultConfig({ seed: "bad seed!" }))).not.toEqual([]);
  });
});

describe("ingestion SQL", () => {
  it("guards every batch, uses idempotent inserts, and never deletes", () => {
    const ds = generate(defaultConfig({ seniors: 5, days: 14 }));
    const batches = buildSqlBatches(ds, {
      orgId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      manifestSha: "x",
      observationBatchSize: 100,
    });
    expect(batches.length).toBe(2 + Math.ceil(ds.observations.length / 100));
    for (const b of batches) {
      expect(b).toContain("sahaara.allow_synthetic_write");
      expect(b).toMatch(/^BEGIN;/);
      expect(b).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i);
      for (const ins of b.match(/INSERT INTO public\.(seniors|observations|senior_baselines)/g) ??
        [])
        expect(ins).toBeTruthy();
    }
    expect(
      batches
        .join("\n")
        .match(/INSERT INTO public\.(seniors|observations|senior_baselines)[\s\S]*?;/g)
        ?.every((s) => s.includes("ON CONFLICT DO NOTHING")),
    ).toBe(true);
  });
});
