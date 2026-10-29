# Phase 9 — Secure Family Portal, Caregiver Experience & Voice Notes

Status: **IMPLEMENTED & VERIFIED** (180/180 Vitest suite passing; TypeScript check 0 errors; production build succeeded).

---

## 1. Objective and Scope

Phase 9 provides an accessible, secure family-facing and caregiver experience in Sahaara. Authorized family members can monitor their linked seniors' daily wellbeing, view verified observations, read approved care updates, record voice notes with browser STT transcription, and respond to care team follow-ups.

Strict non-goals (intentionally omitted):
- **No WhatsApp integration** (Phase 8 postponed).
- **No automated telephony / Twilio calls** (scheduled for a subsequent phase).
- **No unlabelled mock data** or fake integrations.
- **No permanent audio file storage** (audio is processed in memory and discarded).

---

## 2. Family Authorization & Multi-Senior Access Model

1. **Explicit Linking Only**: Family members NEVER discover seniors through search or personal attributes. A senior is accessible to a user if and only if:
   - The user has an active grant in `public.senior_family_members` (`can_access_senior_as_family(senior_id, auth.uid()) = true`), OR
   - The user is a Care Coordinator / Admin with org access (`can_access_org(org_id) = true`).
2. **Single-Use Cryptographic Invitations**:
   - Coordinators generate an invitation link (`/invite?token=...`) with a 24-byte random hexadecimal token (48 hex chars).
   - The raw token is hashed using SHA-256 (`token_hash`) before storage in `public.family_invitations`.
   - Invitations expire automatically in 7 days and become invalid immediately upon first acceptance (`status = 'accepted'`).
3. **Role Segregation & Least Privilege**:
   - Accepting an invitation assigns the `'family'` role in `public.user_roles`.
   - Family members cannot access coordinator-only routes (`/alerts`, `/follow-ups`, `/seniors`, `/reports`, `/messages`).
   - Clients hold `SELECT`-only privileges on all Phase 9 tables. All mutations run through `SECURITY DEFINER` functions with fixed `search_path = public` that derive the actor from `auth.uid()`.

---

## 3. Database Schema & RLS Matrix

The migration is defined in [`supabase/phase9_family_portal.sql`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/supabase/phase9_family_portal.sql):

- **`public.senior_family_members`**:
  - `(senior_id, user_id)` unique composite constraint.
  - Granular permission flags: `can_view_updates`, `can_view_observations`, `can_submit_reports`, `can_view_tasks`.
  - State: `active`, `revoked`, `expired`.
  - Audited revocation: `revoked_by`, `revoked_at`, `revocation_reason`.
  - RLS: `can_access_org(org_id) OR user_id = auth.uid()`.
- **`public.family_invitations`**:
  - `token_hash` unique index (SHA-256 digest).
  - Status: `pending`, `accepted`, `revoked`, `expired`.
  - RLS: `can_access_org(org_id) OR lower(invited_email) = lower(auth.jwt()->>'email')`.
- **`public.follow_up_tasks` Extensions**:
  - `family_visible` boolean (default `false`).
  - `family_response` text (max 2000 chars), `family_responded_at`, `family_responded_by`.
- **SECURITY DEFINER RPCs**:
  - `create_family_invitation(_senior, _email, _relationship, _token_hash)`
  - `accept_family_invitation(_token_hash)`
  - `revoke_family_access(_senior, _user, _reason)`
  - `respond_family_task(_task, _response)`
- **Verification Matrix**:
  - [`supabase/tests/rls_phase9.sql`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/supabase/tests/rls_phase9.sql) verifies invitation generation, stranger denial, family access linking, unlinked cross-senior isolation, and access revocation in a self-rolling-back test transaction.

---

## 4. Family Voice Notes & AI Guardrails

1. **Browser Recording Component** ([`src/components/reports/voice-recorder.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/components/reports/voice-recorder.tsx)):
   - HTML5 `MediaRecorder` API with timer and live playback preview.
   - Fallback audio file picker (`.mp3, .m4a, .wav, .webm, .ogg`).
   - Client and server side audio sniff checks ([`src/lib/ai/audio.ts`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/lib/ai/audio.ts)) capped at 4MB to adhere to Vercel serverless request limits.
2. **Groq Whisper STT & Human Correction** ([`src/components/family/family-report-modal.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/components/family/family-report-modal.tsx)):
   - Audio is transcribed via `transcribeAudio` using Groq Whisper (`whisper-large-v3-turbo`).
   - The user is presented with the machine transcript in an editable review textarea: *"Review and correct your voice note transcript before submitting."*
   - Audio bytes are discarded immediately after transcription (`audio_retained: false`).
3. **Clinical Safety Guarantee**:
   - Family report submissions delegate to `submitTextReport` with `relation = 'family'`.
   - Groq LLM extracts candidate cues under schema `cues.v1`.
   - **Candidate cues remain pending**: Family members cannot confirm cues or directly write to `observations`. Only an authorized human Care Coordinator can confirm candidate cues into official observation records.

---

## 5. UI Routes & Navigation

1. **`/family`** ([`src/routes/_authenticated/family.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/routes/_authenticated/family.tsx)):
   - **Senior Switcher**: Supports caregivers with access to multiple seniors (or coordinators previewing the portal).
   - **Today & Routine Tab** ([`src/components/family/family-routine-summary.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/components/family/family-routine-summary.tsx)):
     - 4 KPI metric cards: Today's Routine Adherence, Medications taken today, 7-Day Routine Consistency Score, and Weekly completed events.
     - 7-Day visual progress bars breaking down daily routine adherence.
     - Today's checklist with category icons, scheduled times, status badges (`Done`, `Overdue`, `Upcoming`, `Missed`), and quick family "Mark Done" action (`source: 'family'`).
   - **Wellbeing & Updates Tab** ([`src/components/family/family-wellbeing-card.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/components/family/family-wellbeing-card.tsx)):
     - On-demand 14-day AI wellbeing narrative citing verified observations, highlighting today's notes, monitored areas, and recommended checks.
     - ElevenLabs Text-to-Speech audio read-aloud button for family members.
     - Care Team Follow-ups & Requests card where family members can submit responses to coordinator inquiries.
   - **Observations Tab**:
     - Verified vitals and measurements cards with timestamps, values, and care notes.
     - Complete observation history table.
   - **Voice Notes & Reports Tab**:
     - Audio recorder with live transcription preview and text editing.
     - Family submission history with coordinator review status pills.
2. **`/invite?token=...`** ([`src/routes/_authenticated/invite.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/routes/_authenticated/invite.tsx)):
   - Single-click invitation verification and acceptance.
   - Auto-redirects to `/family` upon successful authorization.
3. **Coordinator Family Manager** ([`src/components/seniors/senior-family-manager.tsx`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/components/seniors/senior-family-manager.tsx)):
   - Embedded as a dedicated tab (`"Family & Caregivers"`) on senior profiles (`/seniors/$seniorId`).
   - Coordinators can invite caregivers with specific relationship labels and revoke existing access grants.
4. **App Navigation** ([`src/lib/navigation.ts`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/lib/navigation.ts)):
   - Added `"Family Portal"` destination (`/family`).
   - Pure family users are restricted from coordinator-only links.

---

## 6. Verification and Test Results

- **Unit & Integration Suite**: [`src/test/family.test.ts`](file:///c:/Users/aryan/Downloads/saharaa-1-main/saharaa-1-main/src/test/family.test.ts) (21 tests).
  - Tests SHA-256 token hashing, whitespace trimming, distinct hashes.
  - Tests input validation schemas (`createFamilyInviteInput`, `acceptFamilyInviteInput`, `respondFamilyTaskInput`, `submitFamilyReportInput`).
  - Tests date formatting across time zones.
  - Tests relationship integrity constants.
- **Full Vitest Suite**: 180 passing tests across 13 test files.
- **TypeScript**: `bun x tsc --noEmit` exited 0.
- **Production Build**: `bun run build` generated client bundle and Nitro Vercel serverless functions without errors.

