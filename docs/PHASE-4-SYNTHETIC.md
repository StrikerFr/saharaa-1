# Phase 4 — Synthetic Cohort & Data Ingestion (handoff)

Status: **PASS WITH DOCUMENTED BLOCKERS** (see §9). Phase 5 has not been started.

## 1. Architecture

All generator code lives in `src/synthetic/` and is only imported by `scripts/` and tests, never by app routes. The production build was checked and contains no generator code.

| Module                       | Responsibility                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`                  | Generator version `sahaara-synth/1.0.0`, schedule, plausibility bounds, scenario mix, missingness config, limits, dataset identity |
| `rng.ts`                     | Seeded PRNG (xmur3 hash → mulberry32), Box–Muller normal, SHA-256 stable UUIDs                                                     |
| `generate.ts`                | Profiles, baselines, observation schedule, temporal model, scenarios, missingness, ground truth                                    |
| `validate.ts`                | Pre-ingestion validation (mirrors DB CHECKs + plausibility + integrity + privacy)                                                  |
| `report.ts`                  | Quality report, manifest, content hash                                                                                             |
| `sql.ts`                     | Ordered, idempotent, guarded ingestion SQL batches                                                                                 |
| `scripts/synthetic.ts`       | CLI                                                                                                                                |
| `scripts/synthetic-itest.ts` | Builds the rolled-back DB integration test                                                                                         |

**Determinism.** Every logical stream (`profile|i`, `obs|i|type`, `miss|i|type`, `scenario|i`, `gap|i`, `baseline|i`, `scenario-shuffle`) has its own PRNG derived from `seed|stream|…`, so changing iteration order cannot shift values. Each opportunity draws its missingness, jitter and delay values unconditionally, so later days stay stable. IDs are `stableUuid(dataset_id, kind, index, type, day)`. The dataset identity is `syn-` followed by the first 16 hex characters of `sha256([generator_version, full config])`. No wall-clock time enters the generated data: the reference date is explicit (default `2026-10-20`). Only the ingestion run id is random.

## 2. Commands (actual syntax)

```
bun run synthetic:generate -- [--seed S] [--seniors N] [--days D] [--reference-date YYYY-MM-DD] [--out DIR]
bun run synthetic:sql      -- --org <TEST org uuid> [same options] [--out DIR] [--batch-size 5000]
```

- Limits: seniors 1–1000; days 7–90; seed `[A-Za-z0-9._-]{1,64}`.
- `generate` is the dry run. It has no database access and writes `manifest.json`, `quality-report.json` and `ground-truth.json` to `synthetic-output/<dataset_id>/`, which is gitignored. It exits 1 if validation finds any error.
- `sql` validates first, then writes `sql/000.sql …`. It does **not** apply them. An operator applies them in order with a write-capable connection and the explicit guard:
  `PGOPTIONS="-c sahaara.allow_synthetic_write=<dataset_id>" psql "$WRITE_DB_URL" -v ON_ERROR_STOP=1 -f 000.sql` (then 001…).

## 3. Cohort and observation model

- **Profiles:**
  - The name is "Synthetic <given name> <nnnn>". The record code is `S<4 hex of dataset id>-nnnn`.
  - `is_synthetic=true`, `synthetic_dataset_id` set, `care_context` begins "SYNTHETIC TEST RECORD…".
  - Age 65–95 from the reference date. Language weights: en 0.45, hi 0.45, other 0.10. Time zone `Asia/Kolkata`. No contact data of any kind.
  - Validation rejects anything that looks like an email, URL or phone number.
- **Baselines:** 6 per senior, captured 7 days before the window, `source=imported`, `unverified`.
- **Observation sources:** observations are `source=imported` and `unverified`. No medication names or doses are generated.
- **Schedule** (one opportunity per period, local hour ±40 min jitter, phase offset per senior/type):

| Type                                                                              | Every   | Opportunities per senior (90 days)            |
| --------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| heart_rate, blood_pressure, sleep_duration, appetite, hydration, medication_event | 1 day   | 90                                            |
| mobility                                                                          | 3 days  | 30                                            |
| weight                                                                            | 7 days  | 12–13 (depends on phase)                      |
| care_note                                                                         | 14 days | 6–7 (fixed neutral text; never scenario text) |

Expected opportunities for 200 seniors × 90 days = 108,000 + 6,000 + 2,400–2,600 + 1,200–1,400 = **117,600–118,000**. Actual: **117,854**.

- **Temporal model:**
  - Numeric values = personal mean + AR(1) noise (φ = 0.6) + scenario delta.
  - Personal means are rejection-sampled into the generation ranges, not clipped.
  - Categorical values are weighted daily draws whose weights shift under a scenario.
- **Plausibility bounds** (generation constraints, not clinical thresholds): HR 40–140; systolic 85–200; diastolic 45–120; weight 35–140; sleep 2–12 h. Values outside are **flagged as errors, never clipped**. The validator caught and blocked real model defects during development.

## 4. Missingness (denominator = scheduled opportunities)

- Per-senior base miss probability is drawn from U(0.03, 0.15).
- 25% of seniors have one gap of 2–6 days in which every type is missing.
- In the reduced-reporting scenario, 55% of opportunities after onset are missing.
- A missing opportunity produces **no row**. It is listed in the in-memory report only, never stored as a zero or placeholder value.
- Delayed entry: 8% of recorded observations have `recorded_at` set 2–36 h after `observed_at`, capped at the window end. Others are recorded 2–30 min after. "Delayed" in reports means more than 1 h.

## 5. Scenarios and ground truth

Default mix (exact counts for 200): stable_control 80, gradual_weight_loss 20, correlated_decline 20, increased_bp_variability 16, reduced_reporting 16, temporary_deviation_recovery 20, incomplete_baseline 16, medication_adherence_decline 12. Onset falls at 30–70% of the window.

Each label records the scenario, onset day, duration, affected types, expected behaviour, and any gap episode. Labels are stored in:

- `ground-truth.json`, a separate file.
- `public.synthetic_ground_truth`, which has **no grants for anon/authenticated** and is denied even to admins through the app.

Labels never appear in names, notes or context; tests and validation enforce this. These are evaluation labels, not risk scores.

## 6. Database changes — migration `0005_phase4_synthetic_datasets` (applied)

- `synthetic_datasets`: admin-read; holds the content hash used for identity.
- `synthetic_ingestion_runs`: admin-read; counts per run.
- `synthetic_ground_truth`: service only.
- `seniors.synthetic_dataset_id`: not in client column grants. CHECK: it may be set only when `is_synthetic` is true.
- `is_synthetic_ingest(senior)`: true only when all of these hold:
  - the session has no `auth.uid()`;
  - the session is not anon/authenticated;
  - `sahaara.synthetic_ingest` is set;
  - the senior belongs to that dataset.
- `care_record_server_fields`: keeps the generated `recorded_at` only in that state. Otherwise behaviour is unchanged (server time, `auth.uid()`).
- Per-row audit is skipped during guarded ingestion. One `synthetic.ingested` audit event is written per run.

## 7. Ingestion safety and idempotency

- **Guards in every batch:**
  - `sahaara.allow_synthetic_write` must equal the dataset id.
  - The session must be privileged (no app user).
  - The target org must exist and its name must start with `TEST`.
- **Identity:**
  - The same config gives the same dataset id and the same row ids.
  - If the dataset id already exists with a different content hash or org, ingestion is refused.
- **Idempotency:** all inserts use `ON CONFLICT DO NOTHING`; observations, baselines and audit are append-only by design. A rerun inserts 0 rows and counts every row as skipped.
- **Ownership:**
  - After the senior insert, every expected id must belong to this dataset; otherwise the batch aborts. Existing real or other rows are never touched.
  - Observations only insert for seniors owned by the dataset.
- **Batches:** batch 0 holds profiles, baselines and labels. Then come observation batches of 5,000, each a separate transaction, and a final batch that marks the run completed.
- **Recovery:**
  - An interrupted run leaves a `running` row. Committed batches stay.
  - Recovery is to regenerate the SQL for the same config and rerun all files. Already-committed rows are skipped.
- **Clean-up:** there is no delete or reset command. Observations and baselines are append-only, so a clean-slate tool would need its own approved design.
- **Isolation:**
  - Nothing runs at app start-up. No endpoint triggers ingestion. No service key is used in browser code.
  - No messaging integrations exist, and generated profiles contain no contact data.

## 8. Verification results

| Check                       | Command / method                                           | Result                                                                            |
| --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unit tests (15 new)         | `bunx vitest run src/test/synthetic.test.ts`               | PASS                                                                              |
| Full test suite             | `bun run test`                                             | PASS — 5 files, 49 tests                                                          |
| Type check                  | `bunx tsgo --noEmit`                                       | PASS                                                                              |
| Lint                        | `bun run lint`                                             | PASS — 0 errors, 7 pre-existing warnings                                          |
| Build                       | `bun run build`                                            | PASS; no generator code in output                                                 |
| Dry run, 200 × 90 days      | `bun run synthetic:generate`                               | PASS — 0 errors, 0 warnings; nothing written to DB                                |
| Different seeds (7, 42, 99) | `generate --seed …`                                        | PASS — distinct datasets, 0 errors each                                           |
| Validation blocks bad data  | dev run + unit test                                        | PASS — exit 1; implausible BP values were caught and blocked before the model fix |
| DB ingestion integration    | `supabase/tests/synthetic_ingest_phase4.sql` (rolled back) | PASS — see below                                                                  |

Rolled-back DB test output (1 senior × 7 days, real emitted SQL, run twice):

- **Guards:** no guard → blocked; id collision with a manually entered senior → blocked; non-TEST org → blocked.
- **Run 1:** 1 senior, 6 baselines and 39 observations inserted, 0 skipped.
- **Run 2:** 0 inserted, all skipped. The database holds exactly 1 senior, 6 baselines, 39 observations and 1 label.
- **Stored values:** 3 of 3 delayed `recorded_at` values preserved; `recorded_by` null; every row synthetic; one audit event per run.
- **Unrelated data:** the existing `SYN-0001` senior was untouched.

Permission checks (rolled back):

- An admin/coordinator in another org sees 0 of the dataset's seniors and cannot add observations to them (42501).
- Ground truth: permission denied, even for an admin.
- A signed-in user with no role sees 0 datasets, 0 runs and 0 seniors. A signed-out visitor is denied on datasets.
- A client cannot set `synthetic_dataset_id`.

## 9. Blockers and limitations

1. **No isolated test database.** Preview and live share one backend, so the full 200-senior dataset was **not persisted**. Persistence and idempotency were verified only inside rolled-back transactions. Loading the full cohort needs the owner's approval to write into a `TEST` organisation in the shared backend.
2. Because nothing was persisted, browser display of the generated cohort was not re-run. Phase 3 already verified that the list and profile pages label synthetic records.
3. Concurrent ingestion relies on primary-key conflicts, which give no duplicates by construction. It was not stress-tested.
4. Single time zone (Asia/Kolkata). Categorical models are simple. Values are for software testing only, with no clinical validity.
5. The Phase 3 provenance gap remains: direct client inserts can still claim `source=device` or `verified`. This is not in Phase 4 scope.
6. The test account `e2e-coordinator@sahaara.test` was granted **admin** at 20:15 UTC. This was done outside this phase. Review it.
