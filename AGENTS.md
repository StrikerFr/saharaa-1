<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Sahaara architecture rules

- Stack is TanStack Start (not Next.js or React Router); the build target splits by environment — Lovable's pipeline builds Cloudflare Workers, any other build (`bun run build` on Vercel or CI) builds the Vercel Build Output bundle via `nitro.preset` in `vite.config.ts`. Why: one repo must keep both hosts deployable.
- Server code must run on both Cloudflare Workers and Node serverless functions: no filesystem writes, no Cloudflare-only bindings, and no build-time assumption about which host it lands on. Why: Node-only code breaks after publish, Worker-only code breaks on Vercel.
- Use Bun only (`bun.lock`) and never commit a competing npm/yarn lockfile. Why: avoid conflicting installs, and Vercel picks its installer from the lockfile that is present.

- No fake integrations or unlabelled demo data; missing credentials must show "not configured". Why: care-safety product.
- Audit and phase handoff live in `docs/PHASE-0-AUDIT.md`. Why: single source of verified baseline.
- App shell lives in `src/components/shell/`, wrapped around `<Outlet />` in `__root.tsx`; nav items come only from `src/lib/navigation.ts`. Why: one source for nav and active state.
- Pages use `Page`/`Section` from `components/shell/page.tsx` and status UI from `states.tsx`. Why: consistent layout without rebuilding.
- Roles, consent and audit are written only via SECURITY DEFINER functions that derive the actor from `auth.uid()`; clients get SELECT (+ `profiles.display_name` UPDATE) only. Why: prevents privilege escalation and forged audit.
- Every new table: REVOKE ALL from anon/authenticated, then grant minimally, enable RLS, and extend `supabase/tests/rls_matrix.sql`. Why: default schema grants were found to be too broad.
- Protected pages live under `src/routes/_authenticated/`. Why: one gate that re-validates the user.
- Care data (seniors, baselines, observations) is scoped by `can_access_org()` = coordinator/admin role + same organisation; server-owned columns are set by triggers, never sent by the client. Why: tenant isolation and unforgeable provenance.
- Observations and baselines are append-only; value shape lives in DB CHECKs (wrap in COALESCE(..., false)) mirrored in `src/lib/seniors.ts`. Why: NULLs silently pass CHECKs.
- Synthetic-data tooling lives in `src/synthetic/` + `scripts/`, never imported by app code; all randomness via seeded `rng.ts` streams. Why: reproducible datasets and no generator code in client bundles.
- Synthetic ingestion only via emitted SQL guarded by `sahaara.allow_synthetic_write`, a privileged session and a `TEST%` org; inserts are ON CONFLICT DO NOTHING, never deletes. Why: idempotent reruns that cannot touch real records.
- Ground-truth labels stay in `synthetic_ground_truth` (service-only) / `ground-truth.json`, never in observation or profile fields. Why: prevents label leakage into future risk-engine features.
- Risk engine core lives in `src/risk/` and must remain pure, deterministic, versioned, and zero-I/O (`assess(input, config)`); server execution and append-only persistence live in `src/lib/risk.functions.ts` guarded by `can_access_senior()`, immutable triggers, and audit logging; missing/stale data must never be presented as reassuring evidence ("no signal detected" != "safe"); future phases must consume the `Assessment` contract, never duplicating risk logic. Why: ensures reproducible, auditable decision support without clinical overreach or security bypasses.
- Review cases and follow-up tasks (Phase 6) are mutated only through SECURITY DEFINER functions (`open_review_case`, `transition_review_case`, `assign_review_case`, `create_follow_up_task`, `transition_follow_up_task`, `assign_follow_up_task`) that derive the actor from `auth.uid()`, validate transitions mirrored in `src/lib/review-workflow.ts`, and write append-only history plus audit; clients hold SELECT-only grants; one active case per senior (partial unique index); overdue is derived from `due_at` + status, never stored; completing a task never closes a case. Why: human decisions must be attributable, unforgeable, and distinct from both algorithmic suggestions and task outcomes.
- Alerts are review cases, not a separate table: `/alerts` lists `review_cases`; `src/lib/alerts.ts` decides (pure) whether a saved assessment opens/refreshes one via idempotent `open_review_case`; reopen creates a new case. Why: one alert system, history never overwritten.
- AI features (Phase 7) live in `src/lib/ai/` (pure schema/validation + `*.server.ts` provider adapters) and `src/lib/reports.functions.ts`; AI output is an unverified candidate cue in `report_cues`, and only the human `confirm_report_cue` function may write an observation (client_request_id = cue id); machine outputs are written by service-role functions that re-check the actor; audio is never stored; TTS reads only confirmed content. Why: AI must never become a record, score or alert without an attributable human decision.
- Charts use recharts via `src/components/charts/` with series built by pure `src/lib/charts.ts` (missing readings are gaps, never zeros; every chart has a text summary and value table); metric tiles come from `components/shell/metric.tsx`. Why: one honest, accessible visualization pattern.
- The AI wellbeing summary (`src/lib/ai/summary.ts` + `src/lib/summary.functions.ts`) is generated on demand from RLS-scoped reads, never persisted, must cite record ids, and rejects scores/percentages/diagnoses; the review level beside it always comes from the saved risk assessment. Why: AI narrative must never become a record or a risk score.
- Daily routine lives in `care_routine_items` + append-only `care_routine_logs` (newest log per item/day wins), written only via `save_routine_item`/`log_routine`; day/overdue/adherence logic is pure in `src/lib/routine.ts`; every log carries a `source` so future WhatsApp/call channels write through the same function; AI ("tell the AI") only proposes updates a human confirms (`source = ai_assist`); unrecorded is never shown as missed. Why: one interconnected, attributable daily-care record.
