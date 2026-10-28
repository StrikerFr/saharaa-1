# Phase 6 — Coordinator Operations Dashboard, Review Queue & Follow-ups (handoff)

A working coordinator workspace on top of Phase 5 assessments: an operations
dashboard, an authorized review queue, a persisted review-case lifecycle, and
follow-up tasks with outcomes. Not a diagnostic system; an algorithmic
suggestion becomes a decision only when a coordinator acts.

## Phase 5 prerequisite status: PASS (verified this phase)

- `bunx tsgo --noEmit`: 0 errors.
- `bun run build`: PASS (Vite client + SSR + Nitro/Workers output).
- `bunx vitest run`: 80/80 pre-existing tests passed before Phase 6 changes.
- `AGENTS.md` contains the risk-engine architecture rule.
- The `Assessment` contract carries priority, data quality, evidence with
  windows, and engine/ruleset/config versions — sufficient for the queue.
- Inherited limitations (unchanged): assessment reads are not audited; the
  rolling reference window misses some gradual change; synthetic evaluation is
  offline only.

## What was built

### Routes and components

- `src/routes/index.tsx` — signed-in coordinators/admins see the operations
  dashboard (workload summary + review queue); signed-out visitors see the
  honest setup page. The session is client-side, so the dashboard renders
  after hydration; authorization is enforced server-side regardless.
- `src/routes/_authenticated/follow-ups.tsx` — the follow-up task list with
  search, due-bucket and status filters, and pagination.
- `src/routes/_authenticated/seniors.$seniorId.index.tsx` — new "Review case"
  section: the senior's latest case (open or closed) with history, tasks, and
  actions, or an "Open a review case" action from the latest assessment.
- `src/components/review/`: `summary-cards.tsx`, `queue-table.tsx`,
  `case-detail.tsx`, `review-actions.tsx`.
- `src/components/tasks/`: `task-form.tsx`, `task-list.tsx`.
- Navigation: "Follow-ups" is now available at `/follow-ups`.

### Data model (appended to `supabase/full_schema.sql`)

- `review_cases` — one active case per senior (partial unique index on
  `senior_id` where status is active). Links `opened_by_assessment_id` and
  `latest_assessment_id`; superseded assessments stay in `risk_assessments`.
- `review_case_events` — append-only status history (immutable triggers).
- `follow_up_tasks` — title, notes, assignee, `due_at`, status, outcome note,
  `completed_at`, optimistic-concurrency `version`.
- `follow_up_task_events` — append-only task history.
- All four tables: `REVOKE ALL` from anon/authenticated, SELECT-only grants to
  authenticated, RLS via `can_access_org(org_id)`, service_role for privileged
  writes. `supabase/tests/rls_phase6.sql` covers the matrix (rolled back).

### Review-case lifecycle

`needs_review → in_review → follow_up_required → resolved | dismissed`
(plus `needs_review → dismissed`, `in_review → resolved | dismissed`).

- Dismissal requires a reason; resolution requires an outcome note.
- Closed cases are terminal. Reopening after closure creates a NEW case via
  `open_review_case`, so history is never erased.
- `open_review_case` is idempotent: with an active case it only refreshes
  `latest_assessment_id` and returns the existing case — no duplicate active
  cases on refresh.

### Follow-up task lifecycle

`open → in_progress → completed | cancelled` (plus `in_progress → open`).

- Completion requires an outcome note; `completed_at` is set server-side.
- Completing a task never closes the review case — verified in the RLS test.
- Overdue is derived (`due_at < now()` and status open/in_progress), never
  stored. Due-soon means within 48 hours and not yet overdue.

### Mutations (SECURITY DEFINER, actor from `auth.uid()`)

`open_review_case`, `transition_review_case`, `assign_review_case`,
`create_follow_up_task`, `transition_follow_up_task`, `assign_follow_up_task`.
Each validates the caller's care role + org membership, the transition, and
assignee scope; writes history and an audit event; concurrent updates are
guarded by `WHERE status = <expected>`. Clients have no INSERT/UPDATE/DELETE
grants on any Phase 6 table.

### Server functions (`src/lib/review.functions.ts`)

- `getOperationsSummary` — six counts with the same org scope as the queue:
  awaiting review, in review, follow-up required, overdue tasks, due in 48h,
  and active cases whose latest assessment is insufficient or older than 7
  days.
- `listReviewQueue` — bounded (25/page, 200-case pre-join cap), org-scoped via
  RLS, search on name/record code, filters for status/priority/data
  quality/assignee, deterministic ordering: priority rank → assessment
  recency → case id. Priority rank is an operational ordering signal only.
- `getReviewCaseDetail` — case + pinned assessment + history + linked tasks,
  plus a `superseded` flag when a newer assessment exists.
- `listFollowUpTasks`, `listTaskEvents` — task list with overdue/due-soon
  derivation, and per-task history.
- Mutations wrap the RPCs above, all behind `requireSupabaseAuth`.

### Pure logic (`src/lib/review-workflow.ts`)

Transition maps (mirrored by the DB functions), overdue/due-soon derivation,
priority ranking, current-vs-superseded selection, staleness. No I/O; the
clock is always injected. Unit-tested in `src/test/review-workflow.test.ts`
(18 tests).

## Audit

Case opened/transitioned/assigned and task created/transitioned/assigned write
`audit_events` rows with actor, resource, outcome, and reason metadata, inside
the same DB functions that perform the mutation — no client-render duplication.
Reads are not audited (matches the Phase 5 policy).

## Verification (commands and actual results)

- `bunx tsgo --noEmit`: PASS (0 errors).
- `bun run lint`: PASS (0 errors; 7 pre-existing shadcn/ui fast-refresh warnings).
- `bunx vitest run`: PASS (98/98 across 7 suites, incl. 18 new workflow tests).
  `navigation.test.ts` was updated because "Follow-ups" is now built.
- `bun run build`: PASS.
- Browser (Playwright, signed out): PASS — `/` shows the setup page with no
  dashboard data; `/follow-ups` redirects to `/auth?redirect=%2Ffollow-ups`;
  nav lists Follow-ups; mobile (390px) renders cleanly; no console errors.
- `supabase/tests/rls_phase6.sql`: PREPARED, NOT RUN — this project's database
  is externally managed and no `PG*` connection is available in the sandbox,
  so the Phase 6 schema has not been applied to the live database and the
  matrix could not be executed here.

## Known limitations / blockers

- **Schema not yet applied to the live database.** The Phase 6 tables and
  functions exist in `supabase/full_schema.sql` but must be applied to the
  external Supabase project before the dashboard shows real data. Until then
  the queue and task pages render their empty/error states.
- Authenticated end-to-end browser flow (open case → transition → create and
  complete task) is BLOCKED on the same: no managed session exists for the
  external backend, and no test account was available.
- `src/integrations/supabase/types.ts` predates the new tables and is
  platform-protected; Phase 6 row shapes live in `src/lib/review.ts` and
  queries cast through a minimal untyped shape. RLS is unaffected. Regenerate
  the types after applying the schema.
- Assignee pickers are not in the UI yet; assignment functions exist and are
  tested at the DB level, but the UI creates tasks unassigned.

## How to run locally

1. Apply the Phase 6 section of `supabase/full_schema.sql` to the database.
2. `bun install`, then `bun run dev` with the `.env` Supabase variables.
3. Sign in as a coordinator, open a senior, run an assessment, then "Open a
   review case" from the profile's Review case section.

## Phase 7 starting point

Apply the schema, run `rls_phase6.sql` against a staging database, then verify
the authenticated dashboard flow end-to-end. After that, assignee pickers
(org-member directory) are the natural next increment.
