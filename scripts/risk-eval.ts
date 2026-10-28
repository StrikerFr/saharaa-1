#!/usr/bin/env bun
// Phase 5 synthetic evaluation. No database access. Development seed 42 was used for tuning;
// seeds 7 and 99 are held out and reported separately.
//   bun run risk:eval -- [--seeds 42,7,99] [--seniors 200] [--out DIR]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, formatEvaluation } from "../src/synthetic/evaluate";

const argv = process.argv.slice(2);
const get = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const seeds = (get("seeds") ?? "42,7,99").split(",").filter(Boolean);
const seniors = Number(get("seniors") ?? 200);
const out = get("out") ?? "synthetic-output/risk-eval";
mkdirSync(out, { recursive: true });
for (const seed of seeds) {
  const r = evaluate(seed, undefined, seniors);
  const role = seed === "42" ? "DEVELOPMENT (tuning) seed" : "HELD-OUT seed";
  console.log(`\n=== ${role} ===\n${formatEvaluation(r)}`);
  writeFileSync(join(out, `eval-${seed}.json`), JSON.stringify(r, null, 2));
}
