# Alerts module (Phase 5 nav item)

Root cause of the "Phase 5" badge: `src/lib/navigation.ts` hard-coded Alerts as `status: "planned"`; no `/alerts` route existed.

Decision: an alert = a `review_cases` row (Phase 6). No second alert table.

| Requested state | Implemented as |
|---|---|
| Open | `needs_review` |
| Acknowledged | `in_review` |
| Assigned | `assigned_to` via `assign_review_case` (not a status) |
| Escalated | `follow_up_required` ("Escalated to follow-up") — no separate escalation state |
| Resolved / Dismissed | `resolved` / `dismissed`, reason required (DB-enforced) |
| Reopened | new case via `open_review_case` on the newest assessment; closed case + history untouched |

Generation (`runRiskAssessment`): review_* or `unable_to_assess` → `open_review_case` (idempotent, one active case per senior). `no_signal_detected` only refreshes an active alert's evidence; it never creates or closes one. Failure to raise is returned as `alert: "failed"`, never hides the saved assessment.

No schema changes. Limitations: no distinct "escalated" status (needs a migration); authenticated end-to-end and `supabase/tests/rls_phase6.sql` not run from the sandbox (no DB session/connection).
