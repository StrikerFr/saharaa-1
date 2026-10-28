# Sahaara — Phase 2: Database, Authentication & Security

Date: 2026-10-27 (UTC). Every result below was observed in this session.

## Decisions

- **Backend:** Lovable Cloud (managed Postgres + Auth), one instance serves preview and published app. There is no separate test database — see blockers.
- **Migrations:** `drizzle/migrations/0000_identity_roles_consent_audit.sql`, `0001_tighten_table_privileges.sql` (the platform's versioned migration location). Never edit applied files; add new ones.
- **Organizations:** not implemented. The product plan does not yet define a tenant boundary; one implicit organization is assumed. Decide before Phase 3 adds senior records.
- **Provisioning:** email/password self sign-up with email confirmation. New accounts get a profile and **no role** ("Access pending"). Roles are granted only by an admin through `admin_set_role`.
- **First admin:** must be granted by the project owner by running, once, in the backend SQL runner:
  `insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = '<owner email>';`
  There is deliberately no in-app bootstrap (it would be an escalation path).

## Schema

| Table             | Purpose                                                                                                                       | Client privileges                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `profiles`        | display name, account status; auto-created on sign-up                                                                         | SELECT; UPDATE of `display_name` only |
| `user_roles`      | `admin`/`coordinator`/`senior`/`family`, `granted_by`                                                                         | SELECT only                           |
| `consent_records` | subject, recorded_by, recipient category + optional recipient, purpose, scope, status, effective/withdrawn timestamps & actor | SELECT only                           |
| `audit_events`    | actor, action, resource, outcome, correlation id, ≤2 KB metadata                                                              | SELECT only (admins)                  |

Writes to roles/consent/audit happen only through `SECURITY DEFINER` functions with fixed `search_path`, each deriving the actor from `auth.uid()`:
`admin_set_role`, `grant_consent`, `withdraw_consent`, `my_roles`, `has_role`. `write_audit` and trigger functions are not executable by any client role.

Constraints: enums for role/status/purpose/scope; withdrawal fields consistent with status; family consent requires a named recipient; one active consent per (subject, recipient, purpose, scope); consent terms immutable (withdraw and re-grant); withdrawn is final; audit rows blocked from UPDATE/DELETE/TRUNCATE by trigger.

## Authorization matrix

| Action                                | Anonymous | Signed-in (no role)              | Admin               |
| ------------------------------------- | --------- | -------------------------------- | ------------------- |
| Read own profile / roles              | ✗         | ✓                                | ✓                   |
| Read others' profiles / roles         | ✗         | ✗                                | ✓                   |
| Edit own display name                 | ✗         | ✓                                | ✓                   |
| Edit account status, others' profiles | ✗         | ✗                                | ✗ (not exposed)     |
| Grant/revoke roles                    | ✗         | ✗                                | ✓ (not own admin)   |
| Grant/withdraw own consent            | ✗         | ✓                                | ✓ (also for others) |
| Read consents                         | ✗         | where subject or named recipient | ✓                   |
| Read audit trail                      | ✗         | ✗                                | ✓                   |
| Write/alter audit                     | ✗         | ✗                                | ✗                   |

Coordinator/senior/family roles exist but grant nothing extra yet; their data access arrives with the tables they govern.

## Verification

| Check                                                                                                                   | Result                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RLS matrix `supabase/tests/rls_matrix.sql` (run as real `authenticated`/`anon` roles with throwaway users, rolled back) | **Pass** — 30 checks, 0 "ALLOWED!". First run found 2 defects (users could update `account_status`; anon had table privileges) → fixed in migration 0001 → re-run passed |
| `bun run test`                                                                                                          | Pass — 3 files, 17 tests (redirect safety, password rule, error masking, role-gated nav)                                                                                 |
| `bunx tsgo --noEmit`                                                                                                    | Pass                                                                                                                                                                     |
| `bun run lint`                                                                                                          | Pass — 0 errors (generated `src/integrations/supabase/**` now excluded)                                                                                                  |
| `bun run build`                                                                                                         | Pass                                                                                                                                                                     |
| Browser: `/admin`, `/account` signed out → `/auth?redirect=…`                                                           | Pass                                                                                                                                                                     |
| Browser: empty / wrong credentials / short password errors                                                              | Pass, safe messages                                                                                                                                                      |
| Browser: `/reset-password` without link → "invalid or expired"                                                          | Pass                                                                                                                                                                     |
| axe-core on `/auth`                                                                                                     | 0 violations                                                                                                                                                             |
| Backend security linter                                                                                                 | 5 warnings: signed-in users can execute the 5 definer functions — intentional, each checks `auth.uid()`/admin internally                                                 |

**Not verified (blocked):** real sign-up → email confirmation → sign-in → sign-out flow, password reset email, admin UI against a real admin. No test inbox or test accounts exist, and creating accounts in the only (shared) backend was avoided.

## Known limitations / risks

- Denied attempts inside definer functions raise an error, which rolls back their "denied" audit row; only successful privileged actions are durably audited. (Phase 11: log denials via a separate path.)
- Database owners (platform admins) can still disable triggers — audit is append-only for the app, not tamper-proof.
- No separate test/staging database (preview and live share one backend).
- Leaked-password (HIBP) check not confirmed on; enable in Auth settings → Email.
- Session lives in browser storage (platform default).
- Google Fonts remain third-party.

## Status

**PASS WITH DOCUMENTED BLOCKERS** — end-to-end email flows unverified.
