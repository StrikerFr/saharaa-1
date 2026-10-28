# Phase 5 — Explainable Risk Engine (handoff)

Early-warning aid for human review. Not a diagnosis; not clinically validated; synthetic results are not evidence of clinical performance.

## Architecture

- `src/risk/config.ts` — `ENGINE_VERSION` sahaara-risk-engine/1.0.0, `RULESET_VERSION` ruleset/2026-10.1, strict zod config, config fingerprint. Thresholds are development values, not clinical ones.
- `src/risk/engine.ts` — pure `assess(input, config)`. It injects the reference time and does no I/O.
- `src/lib/risk.functions.ts` — authenticated server function. It checks access through RLS and `can_access_senior`, logs denied attempts, runs bounded queries (≤5000 rows, 56-day lookback, observed and recorded ≤ T), and inserts append-only records with the service role. Clients cannot send thresholds or versions.
- `src/components/seniors/assessment-panel.tsx` — the "Change review" section on the senior profile.
- `src/synthetic/evaluate.ts`, `scripts/risk-eval.ts` (`bun run risk:eval`) — offline evaluation. Ground truth is read only after the engine runs.

## Windows and rules

Recent window (T−14d, T]. Reference window (T−56d, T−14d]. The reversal rules use an episode window (T−28d, T−14d] and a prior window (T−56d, T−28d].

- `numeric_shift.{heart_rate,systolic,sleep_duration,weight}`: compares median against median. The change must meet a minimum, be at least 3×SE, and be at least 1× the robust σ. Weight falls back to a recorded baseline only when it is ≤365 days old and was known at T.
- `variability.blood_pressure`: compares the SD of consecutive systolic differences. Detected at a ratio of 1.8× or more.
- `categorical_shift.{appetite,hydration,medication_event}`: detected when the share rises by ≥0.2, z ≥2.5 and there are at least 3 such entries.
- `ordinal_shift.mobility`: compares the median assistance level.
- `reporting.frequency`: entries per day ≤50% of the reference rate. This is an operational signal, not evidence of a change in the person.
- `reversal.*`: shown as context only and never raises the priority.

## Data quality

Possible flags: excluded_future, unit_mismatch, invalid_value, duplicate (exact matches collapsed), conflict (same time with different values; all such entries excluded), stale_data, long_gap (local days, DST-safe), delayed_entry, unverified_source, missing_baseline, insufficient_samples, invalid_time_zone. Overall status is adequate, limited or insufficient.

## Aggregation

The priority is set by how many distinct areas show a change, not by how many rules fire. This avoids double counting.

- 0 areas, with at least 50% of rules assessable: "no signal detected in evaluated scope". This is not "safe".
- 0 areas, with less than 50% assessable: "unable to assess".
- 1 area: review suggested.
- 2 areas: review recommended.
- 3 or more areas: prompt review recommended.

## Persistence

Migration `0006_phase5_risk_assessments.sql` was applied. Assessments are append-only: update, delete and truncate are blocked, and every recomputation creates a new record that keeps its own versions, fingerprint and input digest.

- The organisation is copied from the senior record.
- The insert trigger re-checks that the recorded creator has a role and membership in the senior's organisation. Each insert is also audited.
- Authenticated users can only read (SELECT) assessments for seniors they can access, enforced by RLS. No client insert or update is possible.

## Synthetic evaluation (200 seniors, 7 weekly checkpoints, frozen config)

Thresholds were tuned once, on seed 42 only. Seeds 7 and 99 are held out.

| Stable controls flagged at the final checkpoint | Seed 42 (dev) | Seed 7 | Seed 99 |
| ----------------------------------------------- | ------------- | ------ | ------- |
| Count                                           | 6/80          | 2/80   | 9/80    |

On the held-out seeds, the expected area was detected after onset at some checkpoint for:

- correlated decline: 20/20 and 20/20
- BP variability: 14/16 and 15/16
- weight loss: 15/20 and 16/20
- reduced reporting: 13/16 and 11/16
- medication decline: 7/12 and 9/12
- temporary deviation: 14/20 and 15/20; a reversal was found after the episode in 10/20 and 16/20

Stable controls flagged at any checkpoint: 21/80 (seed 7) and 31/80 (seed 99). Precision at the final checkpoint against the "ongoing planted change" label: 81.6% (seed 7) and 73.1% (seed 99).

Full tables: `bun run risk:eval`.

## Verification

- `npx tsc --noEmit`: PASS (0 errors).
- `npm run build`: PASS (Vite + TanStack Start client & SSR bundle + Nitro output for Cloudflare Workers).
- `npm run lint`: PASS (0 errors, 7 pre-existing shadcn/ui fast-refresh warnings).
- `npx vitest run src/test/risk.test.ts`: PASS (31 of 31 tests).
- Broader test suite (`npx vitest run`): PASS (80 of 80 tests across 6 suites).
- Synthetic evaluation (`npx tsx scripts/risk-eval.ts`): PASS (metrics reproduced exactly across seeds 42, 7, and 99).
- Dev server runtime route check: PASS (`/`, `/design-system`, `/auth`, `/seniors` responding with HTTP 200).
- DB matrix (`supabase/tests/rls_phase5.sql`, rolled back): verified in Phase 5 migration audit.
- Automated browser E2E (Playwright): NOT RUN (Playwright is not included in project dependencies; local HTTP dev server routes and SSR responses verified).

## Limitations / blockers

- The rolling reference window absorbs slow change, so gradual weight loss is often missed at the final checkpoint (about 9/20).
- Sleep and heart-rate rules still produce some false positives on autocorrelated controls.
- The full cohort is not in the database, so evaluation is offline only.
- Reads of assessments are not audited; only creation and denied attempts are.

## Phase 6

Use `risk_assessments` (latest record per senior) and the `Assessment` contract as the queue source. Phase 6 has not been started.
