# Sahaara — Phase 3: Senior Profiles & Observations

Date: 2026-10-27 (UTC). Every result below was observed in this session.

## Status: PASS WITH DOCUMENTED BLOCKERS

## What works

- **Directory** `/seniors`: searches name or record ID on the server, 20 per page, stable order (name, id), loading/empty/error/retry states.
- **Create / edit** `/seniors/new`, `/seniors/:id/edit`: validated forms. Record ID is unique per organisation and can't be changed. Edits use a version check, so a stale save is refused rather than overwriting someone else's change.
- **Detail** `/seniors/:id`: profile, care context, baseline, latest observation per type, and full history. Invalid, missing and unauthorised IDs all show the same "Profile not found".
- **Baselines**: append-only history, and the latest entry per field is treated as current. Status can be `recorded`, `unknown` or `not_applicable`. Each entry stores when it was captured, its source and a verification flag.
- **Observations**: append-only events with a type-specific value and unit, `observed_at` vs server-set `recorded_at`, a server-set `recorded_by`, source, `unverified` by default, and an idempotency key (`client_request_id`).
- **History**: newest observed first (ties broken by id), "Load older" pages of 20. Entries made more than an hour after the event are flagged "entered later".
- **Organisations** (new tenant boundary): admins create organisations and assign members on `/admin`. Each user belongs to at most one.

## Access rule

Care data is visible and writable only when the caller has the **coordinator or admin role** _and_ is a **member of the record's organisation** (`can_access_org`, enforced by row-level security on every table). The client never sends `org_id`, `created_by`, `recorded_by`, `recorded_at` or `version`. Those columns aren't client-writable, and triggers set them from `auth.uid()`.

## Migrations (applied to the Lovable Cloud database)

- `0002_phase3_orgs_seniors_observations.sql` — organisations, memberships, seniors, baselines, observations, policies, triggers, audit hooks, read helpers.
- `0003_fix_care_record_time_check.sql` — fixed a trigger bug that the security matrix found.
- `0004_fix_null_value_checks.sql` — fixed CHECK constraints that let NULL values through (found by the matrix; a medication event with no value was being accepted).

## Observation types (schema_version 1)

| Type                 | Value                    | Allowed                                                                         |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| heart_rate           | number, bpm              | 20–250                                                                          |
| blood_pressure       | systolic/diastolic, mmHg | 50–260 / 30–160, systolic > diastolic                                           |
| weight               | number, kg               | 20–300                                                                          |
| sleep_duration       | number, h                | 0–24                                                                            |
| mobility             | choice                   | independent, uses_aid, needs_assistance, bed_bound                              |
| appetite / hydration | choice                   | usual, reduced, increased, refused (relative to the person)                     |
| medication_event     | choice                   | taken, partially_taken, missed, refused — explicit events only; absence ≠ taken |
| care_note            | text                     | 3–2000 chars                                                                    |

The ranges only reject impossible or mistyped input. They are **not** clinical thresholds. Observed times can't be in the future (+5 min tolerance) or more than 5 years ago. Missing values are rejected, never stored as zero, and display as "Not recorded".

## Correction policy

Observations and baselines **cannot be edited or deleted**: there are no grants, and a trigger blocks it. Corrections (an amending entry with a reason) are deferred until the master plan defines them.

## Verification

| Check                                                                            | Result                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/rls_phase3.sql` (real `authenticated`/`anon` roles, rolled back) | **PASS** after 2 fixes — cross-org read/write/RPC = 0 rows/denied; no-role user = 0 rows; spoofing org/creator/recorder denied; replayed request rejected; invalid values/units/times rejected; update/delete denied; stale version = 0 rows         |
| Null-value follow-up check                                                       | PASS — missing values rejected for all tested types                                                                                                                                                                                                  |
| `supabase/tests/rls_matrix.sql` (Phase 2)                                        | Not re-run; Phase 2 tables were untouched                                                                                                                                                                                                            |
| `bun run test`                                                                   | PASS — 4 files, 34 tests                                                                                                                                                                                                                             |
| `bunx tsgo --noEmit`                                                             | PASS                                                                                                                                                                                                                                                 |
| `bun run lint`                                                                   | PASS — 0 errors (6 pre-existing shadcn warnings)                                                                                                                                                                                                     |
| `bun run build`                                                                  | PASS                                                                                                                                                                                                                                                 |
| Browser E2E as synthetic coordinator (1280px)                                    | PASS — create (with validation errors) → detail → invalid then valid observation → medication event → "unknown" baseline → shown in latest + history with "entered later" → edit (version 2) → search hit/miss → random/invalid IDs show "not found" |
| Mobile 375px                                                                     | PASS — no horizontal overflow; dialog fits                                                                                                                                                                                                           |
| axe-core (detail page, mobile)                                                   | 0 violations                                                                                                                                                                                                                                         |
| Backend linter                                                                   | 11 warnings: signed-in users can call the definer helpers. All are intentional and check identity internally                                                                                                                                         |

## Test data created in the shared backend

Clearly synthetic: the user `e2e-coordinator@sahaara.test` (coordinator), the organisation "TEST — Synthetic E2E", and the senior "Synthetic Asha Test" (SYN-0001, flagged synthetic) with 2 observations and 1 baseline. Remove the user under **Users** when no longer needed.

## Known limitations / blockers

- No separate test database: preview and live share one backend.
- Record reads are not audited (only writes). Phase 11.
- Observed-time entry uses the browser's local timezone. Display uses the senior's timezone.
- Senior/family roles have no access to care records yet (family portal phase).
- Timezone list is a short fixed set.

## Phase 4 starting point

Synthetic cohort generation must insert through the same tables with `is_synthetic = true`, into a dedicated synthetic organisation, and must use the `observation_value_shape` rules above.
