// Sahaara risk engine — versioned rule configuration (Phase 5).
// All thresholds below are DEVELOPMENT thresholds for detecting change relative to a person's own
// history in software tests. They are NOT clinical reference ranges or validated medical thresholds.
import { z } from "zod";

export const ENGINE_VERSION = "sahaara-risk-engine/1.0.0";
export const RULESET_VERSION = "ruleset/2026-10.1";

const DAY_MS = 86_400_000;
export const days = (n: number) => n * DAY_MS;

const numericRule = z.object({
  enabled: z.boolean(),
  /** Minimum absolute change of the recent median vs. reference median (in the type's unit). */
  minAbsChange: z.number().positive(),
  /** Optional minimum relative change (fraction of reference median). */
  minRelChange: z.number().min(0).max(1).default(0),
  /** Change must also exceed k × the standard error implied by the reference spread. */
  seK: z.number().positive(),
  /** Change must also be at least this multiple of the reference day-to-day spread (robust σ). */
  minSpreadMultiple: z.number().min(0).default(0),
  minReference: z.number().int().min(2),
  minRecent: z.number().int().min(1),
});

const categoricalRule = z.object({
  enabled: z.boolean(),
  /** Minimum increase in the share of "less than usual" category entries (absolute). */
  minRateIncrease: z.number().min(0).max(1),
  minZ: z.number().positive(),
  minRecentConcerning: z.number().int().min(1),
  minReference: z.number().int().min(2),
  minRecent: z.number().int().min(1),
});

export const riskConfigSchema = z
  .object({
    windows: z.object({
      recentDays: z.number().int().min(3).max(30),
      referenceDays: z.number().int().min(14).max(120),
      /** Recovery rule: earlier "episode" window length directly before the recent window. */
      episodeDays: z.number().int().min(3).max(30),
    }),
    numeric: z.object({
      heart_rate: numericRule,
      systolic: numericRule,
      sleep_duration: numericRule,
      weight: numericRule,
    }),
    bpVariability: z.object({
      enabled: z.boolean(),
      minRatio: z.number().min(1),
      minReference: z.number().int().min(4),
      minRecent: z.number().int().min(3),
    }),
    categorical: z.object({
      appetite: categoricalRule,
      hydration: categoricalRule,
      medication_event: categoricalRule,
    }),
    mobility: z.object({
      enabled: z.boolean(),
      minReference: z.number().int().min(2),
      minRecent: z.number().int().min(1),
    }),
    reporting: z.object({
      enabled: z.boolean(),
      /** Signal when recent entries/day ≤ this fraction of reference entries/day. */
      maxRatio: z.number().min(0).max(1),
      minReferenceEntries: z.number().int().min(1),
      /** A run of days with no entries of any type at least this long is a data-quality limitation. */
      longGapDays: z.number().int().min(1),
    }),
    quality: z.object({
      /** Latest entry older than this before the reference time = stale. */
      staleAfterDays: z.number().int().min(1),
      /** Recorded baselines older than this are not used as a fallback reference. */
      baselineMaxAgeDays: z.number().int().min(1),
      delayedEntryHours: z.number().positive(),
    }),
    aggregation: z.object({
      /** Below this share of assessable change rules → "unable to assess reliably". */
      minAssessableShare: z.number().min(0).max(1),
      /** Distinct changed domains needed for each category. */
      recommendedDomains: z.number().int().min(2),
      promptDomains: z.number().int().min(3),
    }),
  })
  .strict();

export type RiskConfig = z.infer<typeof riskConfigSchema>;

export const DEFAULT_RISK_CONFIG: RiskConfig = riskConfigSchema.parse({
  windows: { recentDays: 14, referenceDays: 42, episodeDays: 14 },
  numeric: {
    heart_rate: {
      enabled: true,
      minAbsChange: 6,
      seK: 3,
      minSpreadMultiple: 1,
      minReference: 10,
      minRecent: 5,
    },
    systolic: {
      enabled: true,
      minAbsChange: 10,
      seK: 3,
      minSpreadMultiple: 1,
      minReference: 10,
      minRecent: 5,
    },
    sleep_duration: {
      enabled: true,
      minAbsChange: 0.9,
      seK: 3,
      minSpreadMultiple: 1,
      minReference: 10,
      minRecent: 5,
    },
    weight: {
      enabled: true,
      minAbsChange: 1,
      minRelChange: 0.025,
      seK: 3,
      minReference: 3,
      minRecent: 2,
    },
  },
  bpVariability: { enabled: true, minRatio: 1.8, minReference: 14, minRecent: 8 },
  categorical: {
    appetite: {
      enabled: true,
      minRateIncrease: 0.2,
      minZ: 2.5,
      minRecentConcerning: 3,
      minReference: 10,
      minRecent: 7,
    },
    hydration: {
      enabled: true,
      minRateIncrease: 0.2,
      minZ: 2.5,
      minRecentConcerning: 3,
      minReference: 10,
      minRecent: 7,
    },
    medication_event: {
      enabled: true,
      minRateIncrease: 0.2,
      minZ: 2.5,
      minRecentConcerning: 3,
      minReference: 10,
      minRecent: 7,
    },
  },
  mobility: { enabled: true, minReference: 4, minRecent: 3 },
  reporting: { enabled: true, maxRatio: 0.5, minReferenceEntries: 20, longGapDays: 4 },
  quality: { staleAfterDays: 3, baselineMaxAgeDays: 365, delayedEntryHours: 24 },
  aggregation: { minAssessableShare: 0.5, recommendedDomains: 2, promptDomains: 3 },
});

/** Deterministic canonical JSON (sorted keys) for fingerprints. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Non-cryptographic 64-bit FNV-1a style fingerprint (two 32-bit lanes). Identity only, not security. */
export function fingerprint(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function configFingerprint(c: RiskConfig): string {
  return `cfg-${fingerprint(canonicalJson({ engine: ENGINE_VERSION, ruleset: RULESET_VERSION, c }))}`;
}

/** The only way a configuration enters the engine: strict schema validation. */
export function validateConfig(input: unknown): RiskConfig {
  return riskConfigSchema.parse(input);
}
