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
- [ ] BLOCKED (after DB update): signed-in end-to-end check of submit → review → confirm → assessment

## UI/UX redesign (2026-10-28)
- [x] Shared page frame (breadcrumbs, compact header), metric tiles, chart components
- [x] Messages and Reports are real pages; phase badges removed from navigation
- [x] Overview: workload tiles linked to queues, attention queue, 14-day observation chart, recent observations
- [x] Senior profile: summary tiles + tabs (overview, observations, review & follow-ups, reports); trend charts; date-grouped, filterable history
- [ ] Dedicated redesign of Seniors directory, Alerts, Follow-ups, Account, Admin (only shared header changes applied so far)
- [ ] Signed-in browser check of redesigned screens (blocked: test browser cannot sign in to this database)

## Vercel readiness (2026-10-28)
- [x] `vite.config.ts` selects the deploy target: Cloudflare Workers inside Lovable's build, Vercel Build Output (`.vercel/output`, nodejs22.x functions) everywhere else
- [x] `vercel.json` pins `bun install` + `bun run build`; npm lockfile removed so Vercel installs with Bun
- [x] Vercel build verified locally: `config.json` v3, one catch-all function, static assets, no provider or service-role keys in the browser bundle
- [x] Voice-note cap lowered to 4 MB (Vercel rejects request bodies above ~4.5 MB) + test pinning it
- [x] `.gitignore` now covers `.env`, `.vercel/`, `*.tsbuildinfo`; README documents every Vercel env var
- [ ] BLOCKED (needs the user): set the env vars in Vercel project settings and redeploy
- [ ] BLOCKED (needs the user): add the Vercel origin to Supabase's auth redirect allow list; repoint `public/robots.txt` + `public/sitemap.xml` at the Vercel domain
- [ ] BLOCKED (needs the user): drop the already-committed `.env` from git with `git rm --cached .env`


## Daily routine (Today tab)
- [x] Schema supabase/phase8_routine.sql, pure logic + 7 tests, Today & routine tab (checklist, add/edit items, AI-suggested updates, 7-day chart)
- [ ] BLOCKED (user): run supabase/phase8_routine.sql in the SQL editor
- [ ] Later: WhatsApp bot + call channel writing via log_routine (source whatsapp/call)
