# Sahaara

AI-assisted early-warning and care-coordination platform for seniors living at home. Intended users: care coordinators, seniors, and authorized family members.

**Safety boundaries:** Sahaara does not diagnose, prescribe, or replace clinicians or emergency services. It separates observations from interpretations and states uncertainty. Demo data is synthetic and labelled.

**Current state:** Phases 0–7 are implemented (orgs/roles and consent, seniors and observations, synthetic datasets, the risk engine, review cases and follow-up tasks, alerts, AI reports with speech-to-text and read-aloud, and the current-status summary). `roadmap.md` and `docs/` carry the per-phase status and handoffs; `docs/PHASE-0-AUDIT.md` is the verified baseline audit.

## Stack

TanStack Start v1 (React 19, TypeScript strict), Vite, Tailwind CSS v4, shadcn/ui, Zod, Vitest. Data lives in an external Supabase project (schema in `supabase/`, migrations mirrored in `drizzle/migrations/`). Two build targets are configured: Cloudflare Workers (what Lovable Publish uses) and Vercel — see `vite.config.ts`.

## Local development

Prerequisites: Node 22+, Bun 1.4+.

```sh
bun install
cp .env.example .env   # fill in the values for your Supabase project
bun run dev            # http://localhost:8080
```

## Verification

```sh
bun run lint
bunx tsgo --noEmit   # or: bunx tsc --noEmit
bun run test
bun run build
```

`bun run build` outside a Lovable build produces the Vercel Build Output bundle in `.vercel/output`; inside Lovable's own build pipeline it targets Cloudflare Workers instead.

## Deploying to Vercel

1. Push this repository to GitHub and import it in Vercel (or run `vercel` from the CLI).
2. `vercel.json` already pins `bun install` and `bun run build`. The build writes `.vercel/output`, which Vercel serves directly — routing, server functions and static assets all come from there, so no extra Vercel routing config is needed.
3. Add the environment variables below in **Vercel → Project → Settings → Environment Variables**, then redeploy so the browser bundle is rebuilt with them.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | server reads, auth middleware | same project as the client keys |
| `SUPABASE_PUBLISHABLE_KEY` | server-side auth | `SUPABASE_ANON_KEY` also works |
| `SUPABASE_SERVICE_ROLE_KEY` | server-owned writes (assessments, AI output) | privileged; server-only, never `VITE_` |
| `VITE_SUPABASE_URL` | browser client | public, inlined at build time |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser client | public, inlined at build time |
| `GROQ_API_KEY` | AI reports, transcription | server-only |
| `GROQ_LLM_MODEL`, `GROQ_STT_MODEL` | optional overrides | defaults `openai/groq`-listed `openai/gpt-oss-20b` / `whisper-large-v3-turbo` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_TTS_MODEL_ID`, `ELEVENLABS_VOICE_ID` | read-aloud | all three required, or the feature shows as "not configured" |

### Before the first sign-in on Vercel

- Add the deployment origin to Supabase's **Auth → URL Configuration** allow list, e.g. `https://<your-project>.vercel.app/**`, and set the Site URL there. Without it, email links and OAuth callbacks bounce back to the old host.
- `public/robots.txt` and `public/sitemap.xml` still name `https://little-sprout-starter.lovable.app`. Point both at the Vercel origin (or your custom domain) so search engines index the right host.
- Voice notes are capped at 4 MB (`src/lib/ai/audio.ts`) because Vercel rejects serverless request bodies above ~4.5 MB. Groq itself accepts up to 25 MB; the smaller cap keeps the app honest on both hosts.
- The Vercel build does **not** touch the database. Apply `supabase/` schema/migrations (or `drizzle/migrations/`) to the Supabase project yourself, and run `supabase/tests/rls_matrix.sql`, `supabase/tests/rls_phase6.sql` and `supabase/tests/rls_phase7.sql` against it.
- `.env` is local-only and git-ignored. If an early commit tracked it, drop it from the repository once with `git rm --cached .env` and commit the removal; the values then live only in Vercel's project settings and your local file.
