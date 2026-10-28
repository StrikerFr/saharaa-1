# Sahaara — Phase 0 Audit & Handoff

Audit date: 2026-10-27 (UTC). Every result below was observed in this session.

## 1. Repository audit

- **State:** freshly initialized template. No Sahaara features, pages, API routes, database, auth or integrations exist yet.
- **Git:** branch `edit/edt-46014395-…`; 3 commits (`template`, `Work in progress`, `Changes`); working tree clean before Phase 0 edits. Git state is managed by the Lovable platform (agent does not commit manually).
- **Framework:** TanStack Start v1 (React 19, file-based routing in `src/routes/`), Vite 8, Tailwind CSS v4 (`src/styles.css`), shadcn/ui primitives (49 files in `src/components/ui/`), Zod 3, Vitest 4 + Testing Library + jsdom.
- **Runtime target:** Cloudflare Workers (edge), via Nitro build output.
- **Package manager:** Bun (`bun.lock`). Do not add npm/yarn/pnpm lockfiles.
- **Routes:** `/` only — still the blank template placeholder.
- **Server code:** none beyond template entry (`src/server.ts`, `src/start.ts`).
- **Env usage:** no `process.env` / `import.meta.env` references in `src/`.
- **CI/CD:** no `.github/` workflows. Deployment is via Lovable Publish.
- **Database/Auth:** none connected (Lovable Cloud not enabled).
- **Secrets scan:** no env files tracked; no credential-like literals found in tracked source.
- **TypeScript:** `strict: true`.

## 2. Architecture assessment

| Target                     | Actual                       | Decision                                                                                                                                                                                                       |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js App Router         | TanStack Start v1            | **Keep TanStack Start.** The Lovable platform fixes this stack; replacing it is not possible here. Equivalent concepts: file routes, `createServerFn` server functions, server routes under `src/routes/api/`. |
| Vercel functions           | Cloudflare Workers (workerd) | Keep. Constraint: server code must be Workers-compatible (no Node-only native modules, no long-running processes).                                                                                             |
| Supabase Postgres/Auth/RLS | Not yet enabled              | Enable Lovable Cloud (managed Supabase) in the first phase that needs persistence/auth.                                                                                                                        |
| Zod                        | Zod 3.25 installed           | Keep; see risk R3.                                                                                                                                                                                             |
| Vitest                     | Present, 1 routing test      | Keep.                                                                                                                                                                                                          |
| Playwright                 | Not a project dependency     | Available in the agent sandbox for verification; add as project tests only if needed later.                                                                                                                    |
| ESLint + Prettier          | Present                      | Keep.                                                                                                                                                                                                          |

**Deferred compatibility questions:** speech-to-text / AI note processing (use Lovable AI Gateway, server-side); WhatsApp Business API webhooks (server route under `src/routes/api/public/`, signature verification required); phone calls (provider TBD; verify Workers compatibility); anomaly detection must be rules-based TypeScript runnable on Workers or precomputed.

## 3. Baseline verification matrix

| Command                       | Run? | Result                                                                                                                |
| ----------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`                | Yes  | **Passed** — 0 errors, 6 warnings (`react-refresh/only-export-components` in shadcn ui files; pre-existing, harmless) |
| `bunx tsgo --noEmit`          | Yes  | **Passed** (exit 0)                                                                                                   |
| `bun run test`                | Yes  | **Passed** — 1 file, 1 test                                                                                           |
| `bun run build`               | Yes  | **Passed** (exit 0, Nitro output generated)                                                                           |
| `bunx prettier --check .`     | Yes  | **Failed (minor)** — `AGENTS.md`, `src/routes/README.md` not formatted; platform-managed files, left untouched        |
| Integration / E2E tests       | No   | Not applicable — none configured                                                                                      |
| CI checks                     | No   | Not applicable — no CI configured                                                                                     |
| Dependency vulnerability scan | Yes  | **Findings** — see R3/R4                                                                                              |
| Database / auth checks        | No   | Blocked — no backend connected yet                                                                                    |

Reproduce: `bun install && bun run lint && bunx tsgo --noEmit && bun run test && bun run build`.

## 4. Environment audit

- No environment variables are currently required.
- `.env.example` added documenting the variables future phases will introduce (names only).
- `.gitignore` previously did **not** exclude `.env` files — fixed in Phase 0.
- Rules: `VITE_*` variables are public (bundled to browser); everything else is server-only and must be read inside server handlers via `process.env`. Missing integration credentials must surface as an explicit "not configured" state, never a fake success.

## 5. Change summary

| File                    | Why                                                                          |
| ----------------------- | ---------------------------------------------------------------------------- |
| `.gitignore`            | Exclude `.env`, `.env.*` (keep `.env.example`) to prevent committing secrets |
| `.env.example`          | Safe template of future variable names                                       |
| `docs/PHASE-0-AUDIT.md` | This audit and handoff                                                       |
| `README.md`             | Sahaara overview, setup and verification commands                            |
| `AGENTS.md`             | Architecture rules for future phases                                         |

No application code, UI or dependencies were changed.

## 6. Risk register

| ID  | Risk                                                                                                             | Severity                                                                  | Phase                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| R1  | Target stack named Next.js/Vercel; actual is TanStack Start/Cloudflare                                           | Medium (documentation/expectation)                                        | Resolved by decision above                                                    |
| R2  | `.env` files were not git-ignored                                                                                | Medium                                                                    | Fixed in Phase 0                                                              |
| R3  | Zod 3.25.76 advisory (memory exhaustion on oversized constrained collections); fix only in Zod 4 (major upgrade) | High per advisory; low practical exposure today (no input validation yet) | Evaluate Zod 4 upgrade before first server-side validation of untrusted input |
| R4  | Transitive advisories (js-yaml, source-map-js) via build tooling (`@tanstack/react-start`, `@tailwindcss/vite`)  | High per advisory; build-time only                                        | Track upstream releases; no direct fix                                        |
| R5  | No auth, RBAC, RLS, consent or audit logging                                                                     | Critical before any real data                                             | Auth/security phases                                                          |
| R6  | Health-adjacent data; risk of real PII in demo                                                                   | High                                                                      | All phases — synthetic data only, labelled                                    |
| R7  | WhatsApp/telephony webhooks are public endpoints                                                                 | High                                                                      | Messaging phase — verify signatures                                           |
| R8  | No CI                                                                                                            | Low                                                                       | Optional later                                                                |
| R9  | Prettier drift in 2 platform files                                                                               | Low                                                                       | Ignore                                                                        |

## 7. Phase 1 handoff — Design System & Application Shell

Constraints to preserve:

- Keep TanStack Start, `src/routes/__root.tsx` shell, Bun, Tailwind v4 tokens in `src/styles.css` (oklch, semantic tokens only — no hardcoded colors in components).
- Load web fonts via `<link>` in `__root.tsx`, never remote `@import` in CSS.
- Replace the placeholder at `/`; give every route its own `head()` metadata.
- Keep `bun run lint`, type check, tests and build green.
- No fake data presented as real; any demo data must be visibly labelled "Synthetic".

Design principles (from the referenced sites — inspiration only, never copied):

- Calm, warm, human, trustworthy, professional identity.
- Bold composed typography, generous whitespace, precise spacing, restrained palette.
- Purposeful motion only; respect `prefers-reduced-motion`.
- Clinical clarity first: urgent alerts must be instantly scannable; effects never obscure them.
- Large readable text and controls for seniors/family; WCAG AA contrast minimum.
- No 3D/WebGL unless it earns its performance and usability cost.
- Always show uncertainty, consent status and the "not a medical diagnosis" boundary.

## 8. Git checkpoint

Commits are created automatically by the Lovable platform after this change set; the agent does not run stateful git commands. Changes are limited to the five files above.

## 9. Completion decision

**PASS WITH DOCUMENTED BLOCKERS** — foundation builds, type-checks, lints and tests cleanly. Blockers: no backend connected (database/auth checks not runnable), Zod advisory pending a deliberate major-version decision.
