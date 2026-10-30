# Roadmap

- [x] Alerts module: /alerts route, alert generation from assessments, nav badge removed (see docs/ALERTS-MODULE.md)

## Phase 6

- [x] Verify Phase 5 gate (typecheck, build, tests, AGENTS.md rule, contract) — PASS
- [x] Schema: review_cases, review_case_events, follow_up_tasks, follow_up_task_events + SECURITY DEFINER mutation functions + RLS/grants/audit in supabase/full_schema.sql
- [x] Phase 6 row types (src/lib/review.ts; generated types.ts is platform-protected)
- [x] Pure workflow logic src/lib/review-workflow.ts + unit tests (18 tests)
- [x] Server functions: summary, queue, case detail, mutations, task list
- [x] Dashboard route (operations overview + queue on /)
- [x] Follow-ups route + task components
- [x] Review actions (transitions, dismiss/resolve with reason)
- [x] Case detail panel on senior profile + open-case action
- [x] Navigation updates (Follow-ups available)
- [x] RLS/security tests supabase/tests/rls_phase6.sql (prepared; NOT RUN — no DB connection in sandbox)
- [x] Browser verification (Playwright, signed-out gating + mobile)
- [x] Lint, typecheck, build, full test suite — all PASS
- [x] docs/PHASE-6-COORDINATOR-OPS.md handoff + AGENTS.md rule
- [x] Final gate report

## Blockers carried to Phase 7
- Apply Phase 6 schema to the live external Supabase project (no PG* connection in sandbox)
- Run supabase/tests/rls_phase6.sql against staging
- Authenticated E2E of the dashboard flow (needs a coordinator test account)

## Phase 7
- [x] Groq LLM cue extraction (strict schema cues.v1) — live-tested on synthetic EN/Hinglish/Hindi
- [x] Groq STT voice notes (25 MB, format + signature checks, audio not stored) — live-tested
- [x] ElevenLabs read-aloud of confirmed content — live-tested
- [x] Human review page: confirm / edit / reject / clarification / retry / transcript correction
- [x] Schema supabase/phase7_reports.sql + rls_phase7.sql; 30 unit tests
- [x] Schema applied; rls_phase7.sql all 11 checks pass (2026-10-28)
- [x] Signed-in end-to-end check of submit → review → confirm → assessment

## UI/UX Redesign
- [x] Shared page frame (breadcrumbs, compact header), metric tiles, chart components
- [x] Messages and Reports are real pages; phase badges removed from navigation
- [x] Overview: workload tiles linked to queues, attention queue, 14-day observation chart, recent observations
- [x] Senior profile: summary tiles + tabs (overview, observations, review & follow-ups, reports); trend charts; date-grouped, filterable history
- [x] Clean visual typography, accessibility, high-contrast cards, and responsive layouts

## Vercel Readiness
- [x] `vite.config.ts` selects the deploy target: Cloudflare Workers inside Lovable's build, Vercel Build Output (`.vercel/output`, nodejs22.x functions) everywhere else
- [x] `vercel.json` pins `bun install` + `bun run build`; npm lockfile removed so Vercel installs with Bun
- [x] Vercel build verified locally: `config.json` v3, one catch-all function, static assets, no provider or service-role keys in the browser bundle
- [x] Voice-note cap lowered to 4 MB (Vercel rejects request bodies above ~4.5 MB) + test pinning it
- [x] `.gitignore` covers `.env`, `.vercel/`, `*.tsbuildinfo`, `.lovable/`; README documents every Vercel env var

## Phase 8 — Daily Routine & Care Scheduling
- [x] Schema `supabase/phase8_routine.sql`, pure logic + tests, Today & routine tab (checklist, add/edit items, 7-day chart)
- [x] Groq AI NLP interpretation for multilingual daily care updates (English, Hindi, Hinglish)
- [x] Voice dictation (Web Speech API + Groq Whisper STT) for hands-free routine logging

## Phase 9 — Secure Family Portal & Voice Notes
- [x] Schema `supabase/phase9_family_portal.sql` + `supabase/tests/rls_phase9.sql` (single-use cryptographic invitations, least-privilege family access grants, `follow_up_tasks` family visibility).
- [x] Domain types and contracts `src/lib/family.ts` + 21 unit & validation tests in `src/test/family.test.ts`.
- [x] Server functions `src/lib/family.functions.ts` (`listFamilySeniors`, `getFamilyDashboard`, `submitFamilyReport`, `respondFamilyTask`, `createFamilyInvitation`, `acceptFamilyInvitation`, `listSeniorFamilyMembers`, `revokeFamilyAccess`).
- [x] Browser voice note recorder `src/components/reports/voice-recorder.tsx` (MediaRecorder API, timer, preview player, 4MB Vercel cap, audio signature validation).
- [x] Groq Whisper STT + pre-submission transcript review & editing `src/components/family/family-report-modal.tsx`.
- [x] Dedicated Family Portal route `src/routes/_authenticated/family.tsx` (senior switcher, verified vitals timeline, care team follow-up responder, submission history with status tracking, ElevenLabs TTS).
- [x] Single-use invitation acceptance route `src/routes/_authenticated/invite.tsx`.
- [x] Coordinator family manager embedded in senior profile tabs `src/routes/_authenticated/seniors.$seniorId.index.tsx` (`Family & Caregivers` tab).
- [x] Navigation updated: `Family Portal` destination added in `src/lib/navigation.ts`.

## Phase 10 — Real Two-Way Twilio WhatsApp Integration
- [x] Schema `supabase/phase10_whatsapp.sql` + `supabase/tests/rls_phase10_whatsapp.sql` (consent tracking, masked identities, idempotency).
- [x] Twilio Official SDK integration with signature verification, deduplication, and webhook endpoints (`src/lib/twilio.server.ts`, `src/lib/whatsapp-webhook.server.ts`).
- [x] Free-form outbound text composer with delivery status indicators (`src/components/messages/conversation-view.tsx`, `src/lib/whatsapp.server.ts`).
- [x] Inbound message clinical routing powered by Groq (`src/lib/whatsapp-ai.server.ts`): handles routine confirmations, vitals updates, and general inquiries in English, Hindi, and Hinglish.
- [x] Senior profile WhatsApp tab with linked phone management, verification status, and recent activity.

## Phase 11 — Fire-Boltt Legacy Smartwatch Live Health Monitoring
- [x] Schema `supabase/phase11_wearables.sql` (devices, biometrics telemetry, anomaly alerts, immutable audit triggers, RLS).
- [x] Hardware panel showcasing the **Fire-Boltt Legacy smartwatch** with product photos, BLE connection status, battery meter, and sync controls.
- [x] 8 real-time biometric cards: Heart Rate, SpO2, Stress (HRV), Sleep architecture, Daily steps, Caloric burn, Distance, Blood Pressure.
- [x] Live updating telemetry simulation with pause/resume controls, configurable polling frequencies, and natural physiological drift.
- [x] **Hourly Health Updates** chronological timeline with per-hour observation summaries and filters (Today, 24h, 7d, Custom).
- [x] Recharts analytics suite for 24h multi-metric trends with reference thresholds.
- [x] Anomaly detection rule engine with severity levels and coordinator triage workflow.
- [x] JSON health data import with strict schema validation, sample template download, and live stream integration.
- [x] Navigation: Dedicated `/monitoring` route with Senior Profile selector and profile-embedded `Live Health Monitoring` tab.
