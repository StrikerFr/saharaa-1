# Phase 6 — Coordinator Operations Dashboard, Review Queue & Follow-ups

## Verified Phase 5 gate status: PASS

- `tsgo --noEmit`: 0 errors. `bun run build`: PASS (client + SSR + Nitro/Workers output). `bunx vitest run`: 80/80 across 6 suites.
- `AGENTS.md` contains the risk-engine architecture rule (line 31).
- Assessment contract (`src/risk/engine.ts`) carries `priority` (5 categories incl. `unable_to_assess`, `no_signal_detected`), `dataQuality`, evidence items with windows/versions, `engineVersion`/`rulesetVersion`/`configFingerprint` — everything Phase 6 needs.
- Persistence: `risk_assessments` is append-only (immutable triggers), org-scoped via trigger, RLS `can_access_senior`, insert audited. Denied attempts logged.
- Schema lives in `supabase/full_schema.sql` (single versioned file, no migrations dir) — Phase 6 changes go there plus a new `supabase/tests/rls_phase6.sql`.
- Known Phase 5 limitations (documented, non-blocking): assessment reads not audited; gradual-change false negatives; offline-only synthetic evaluation.

## Data model (new, in `supabase/full_schema.sql`)

1. **`review_cases`** — one *active* case per senior (partial unique index `WHERE status IN ('needs_review','in_review','follow_up_required')`), linked to the assessment that opened it (`opened_by_assessment_id`) and the latest assessment seen (`latest_assessment_id`). Fields: `id, senior_id, org_id (trigger-set), status, priority_at_open, opened_at, opened_by_assessment_id, latest_assessment_id, assigned_to (nullable, org member), created_at, updated_at, version`.
   - Status enum: `needs_review → in_review → follow_up_required → resolved | dismissed`. `dismissed` requires a reason; `resolved` requires an outcome note. Reopening creates a *new* case (history preserved); no silent auto-transitions.
2. **`review_case_events`** — append-only status history: `case_id, from_status, to_status, actor, reason, created_at` (immutable triggers like `risk_assessments`).
3. **`follow_up_tasks`** — `id, senior_id, org_id (trigger-set), review_case_id (nullable), title, notes, assigned_to, due_at (nullable), status, outcome_note, created_by, created_at, updated_at, completed_at, version`.
   - Status enum: `open → in_progress → completed | cancelled`. Completion requires `outcome_note`. Overdue is *derived* (`due_at < now() AND status IN ('open','in_progress')`), never stored.
4. **`follow_up_task_events`** — append-only task history.
5. All tables: `REVOKE ALL` from anon/authenticated, minimal GRANTs, RLS via `can_access_org`/`can_access_senior`, server-field triggers (org, actor, timestamps, version), audit triggers via `write_audit`, grants to `service_role` for privileged writes.
6. **SECURITY DEFINER mutation functions** (actor from `auth.uid()`, mirroring the roles/consent/audit pattern): `transition_review_case(case_id, to_status, reason)`, `create_follow_up_task(...)`, `transition_follow_up_task(task_id, to_status, outcome_note)`, `assign_review_case(case_id, assignee)`. Each validates transitions, org scope, assignee membership, writes history + audit. Clients get SELECT only; mutations only via these functions.
7. Regenerate `src/integrations/supabase/types.ts` to match.

## Server functions (`src/lib/review.functions.ts`, `src/lib/tasks.functions.ts`)

- `getOperationsSummary` — counts: awaiting review (`needs_review`), in review, follow-up required, overdue tasks, tasks due in 48h, cases with insufficient/stale assessments. Same org scope and filters as the queue so counts never contradict it.
- `listReviewQueue` — bounded (page size 25), org-scoped join of active cases + latest assessment + senior (display_name, record_code only) + next open task due date. Filters: priority category, data quality, review status, assignee; search on display_name/record_code (sanitized via existing `sanitizeSearch`); deterministic sort (priority rank, then assessment recency, then `id` tie-breaker).
- `getReviewCaseDetail` — case + current assessment (full `Assessment` result) + event history + linked tasks.
- Mutation wrappers calling the SECURITY DEFINER functions, all behind `requireSupabaseAuth`. No unrestricted fetch + client-side filtering anywhere.

## Pure workflow logic (`src/lib/review-workflow.ts`)

- Transition maps for case and task statuses, `isOverdue(dueAt, status, now)`, priority rank ordering, current-vs-superseded assessment selection (latest by `created_at`, `id` tie-break). Unit-tested, no I/O — mirrors the risk-engine purity rule.

## Routes & components

- `src/routes/_authenticated/index.tsx` becomes the real operations dashboard (today it is a Phase-0 placeholder): workload summary cards + review queue.
- `src/routes/_authenticated/follow-ups.tsx` — task list (open/overdue/due-soon/completed), filters, complete-with-outcome dialog.
- New components: `src/components/review/queue-table.tsx`, `summary-cards.tsx`, `case-detail-panel.tsx` (reuses Phase 5 `assessment-panel.tsx` evidence rendering), `review-actions.tsx` (status transitions with reason/outcome dialogs), `src/components/tasks/task-form.tsx`, `task-list.tsx`.
- Navigation: "Follow-ups" becomes available → `/follow-ups`; "Alerts" stays planned.
- All states via existing `states.tsx` (loading/error/empty); design tokens only, no hardcoded colors; keyboard-operable dialogs; `aria-live` status announcements.

## Authorization boundaries

- Every server function: `requireSupabaseAuth` + org/role checks via existing `can_access_org`/`can_access_senior`/`has_role`. Assignees validated as members of the same org. No client-supplied actor/org/role ever trusted. No `supabaseAdmin` for reads; privileged writes only inside DB functions.

## Audit

- Case opened/transitioned/dismissed/resolved, task created/assigned/status-changed/completed/cancelled → `write_audit` with actor, resource, outcome, reason metadata. No read auditing (matches Phase 5 policy). No separate audit dashboard.

## Tests

- Unit (`src/test/review-workflow.test.ts`): transition rules, overdue calc, priority ordering, superseded selection, validation, duplicate-submission guards.
- DB security (`supabase/tests/rls_phase6.sql`, rolled back): cross-tenant denial, unauthorized mutation denial, assignee scope, immutability of history tables, audit rows written.
- Browser E2E via Playwright: dashboard loads real records, filter/search, open case, transition persists after reload, create + complete task, unauthorized ID access denied, mobile width.

## Documentation & handoff

- `docs/PHASE-6-COORDINATOR-OPS.md` handoff; update `docs/PHASE-0-AUDIT.md` pointers and `AGENTS.md` with the Phase 6 architecture rule (review cases/tasks mutated only via SECURITY DEFINER functions; overdue derived, never stored).

## Explicitly out of scope (Phase boundary)

No AI summaries, WhatsApp, family portal, voice, calls, automated outbound contact, new ML, or risk-engine changes. No git commits (platform manages git state).
