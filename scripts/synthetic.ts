#!/usr/bin/env bun
// Sahaara synthetic cohort CLI (Phase 4). Development/test tooling only; never imported by the app.
//
//   bun run synthetic:generate -- [--seed S] [--seniors N] [--days D] [--reference-date YYYY-MM-DD] [--out DIR]
//       Dry run: generate + validate + report. Writes manifest/report/ground-truth JSON to DIR. No database access.
//   bun run synthetic:sql -- --org <TEST org uuid> [same options] [--out DIR] [--batch-size 5000]
//       Validate, then write ordered, idempotent ingestion SQL batches. Still no database access.
//       An operator applies them with a write-capable connection and the explicit guard:
//         PGOPTIONS="-c sahaara.allow_synthetic_write=<dataset_id>" psql "$DB_URL" -v ON_ERROR_STOP=1 -f DIR/sql/000.sql ...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultConfig } from "../src/synthetic/config";
import { generate } from "../src/synthetic/generate";
import { validate } from "../src/synthetic/validate";
import { formatReport, manifest, qualityReport } from "../src/synthetic/report";
import { buildSqlBatches } from "../src/synthetic/sql";
import { sha256 } from "../src/synthetic/rng";

const [cmd, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  const k = rest[i];
  if (k?.startsWith("--")) {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith("--")) args.set(k.slice(2), "true");
    else {
      args.set(k.slice(2), v);
      i++;
    }
  }
}
const num = (k: string) => (args.has(k) ? Number(args.get(k)) : undefined);

if (cmd !== "generate" && cmd !== "sql") {
  console.error(
    "usage: synthetic.ts <generate|sql> [--seed S] [--seniors N] [--days D] [--reference-date YYYY-MM-DD] [--out DIR] [--org UUID]",
  );
  process.exit(2);
}

const base = defaultConfig();
const config = defaultConfig({
  seed: args.get("seed") ?? base.seed,
  seniors: num("seniors") ?? base.seniors,
  days: num("days") ?? base.days,
  referenceDate: args.get("reference-date") ?? base.referenceDate,
});

const ds = generate(config);
const v = validate(ds);
const q = qualityReport(ds);
const m = manifest(ds, v, q);
const out = args.get("out") ?? join("synthetic-output", ds.meta.dataset_id);
mkdirSync(out, { recursive: true });
const manifestText = JSON.stringify(m, null, 2);
writeFileSync(join(out, "manifest.json"), manifestText);
writeFileSync(join(out, "quality-report.json"), JSON.stringify(q, null, 2));
// Ground truth kept in its own file: evaluation-only, never a model input.
writeFileSync(
  join(out, "ground-truth.json"),
  JSON.stringify({ dataset_id: ds.meta.dataset_id, labels: ds.groundTruth }, null, 2),
);

console.log(
  `Dataset ${ds.meta.dataset_id} (${ds.meta.generator_version}, seed ${config.seed}, reference ${config.referenceDate})`,
);
console.log(formatReport(q, v));
console.log(`Content sha256: ${m.content_sha256}`);

if (v.errors.length > 0) {
  console.error(`FATAL: ${v.errors.length} validation error(s). Nothing written to any database.`);
  process.exit(1);
}

if (cmd === "generate") {
  console.log(`DRY RUN: generated and validated only. No database writes. Files in ${out}`);
  process.exit(0);
}

const org = args.get("org");
if (!org || !/^[0-9a-f-]{36}$/.test(org)) {
  console.error("FATAL: --org <TEST organisation uuid> is required for sql output.");
  process.exit(1);
}
const runId = randomUUID();
const batches = buildSqlBatches(ds, {
  orgId: org,
  runId,
  manifestSha: sha256(m.content_sha256),
  observationBatchSize: num("batch-size") ?? 5000,
});
mkdirSync(join(out, "sql"), { recursive: true });
batches.forEach((b, i) => writeFileSync(join(out, "sql", `${String(i).padStart(3, "0")}.sql`), b));
console.log(
  `Wrote ${batches.length} SQL batches to ${join(out, "sql")} (run ${runId}). NOT applied.`,
);
console.log(
  `Apply with: PGOPTIONS="-c sahaara.allow_synthetic_write=${ds.meta.dataset_id}" psql "$WRITE_DB_URL" -v ON_ERROR_STOP=1 -f <each file in order>`,
);
