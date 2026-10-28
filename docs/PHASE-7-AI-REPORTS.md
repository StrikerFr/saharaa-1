# Phase 7 — AI text understanding, voice notes and read-aloud

Status: **PARTIALLY COMPLETE — blocked on database update** (see "Blockers").

## What it does
Coordinators submit a written report or a voice note about a senior (profile → "Reports & voice notes").
- Voice notes are transcribed by Groq STT. The transcript is labelled *machine transcript · unverified*;
  the reviewer can correct it, then explicitly starts AI analysis.
- Written reports are analysed immediately by the Groq LLM.
- The LLM returns *candidate cues*, shown as **Unverified AI suggestion**. A reviewer confirms (editing
  description/type/value/time/source), rejects (optional reason), or marks the report as needing clarification.
- Only `confirm_report_cue` writes an observation, into the existing `observations` table with
  `verification = 'unverified'` and `client_request_id = cue id` (double-clicks/retries return the same row).
  The existing Phase 5 engine sees it on the next assessment run; Phase 6 alerts follow from that. No
  risk score, alert or task is touched by AI.
- "Read confirmed summary aloud" sends only confirmed cue descriptions (no name, no raw report) to ElevenLabs.

## Providers and models
| Capability | Provider | Model | Verified |
|---|---|---|---|
| LLM | Groq | `openai/gpt-oss-20b` (strict `json_schema`) | Live: listed for the account; strict output worked on 8 synthetic sentences incl. Hinglish and Hindi |
| STT | Groq | `whisper-large-v3-turbo` | Live: listed; transcribed a 3.3 s synthetic Hindi clip |
| STT comparison | Groq | `whisper-large-v3` | Listed for the account; not tested |
| TTS | ElevenLabs | `eleven_multilingual_v2`, voice `z2gqnDU9fuyk5pvu5Cwx` ("sahaaraa", generated) | Live: model lists Hindi + English; one mixed English/Hindi clip generated |

Free-tier facts observed (2026-10-28): ElevenLabs account tier `free`, 10,000 characters/month (≈1,150 used
after testing). Groq returned HTTP 429 after ~8 quick LLM calls — the free tier is rate-limited per minute.
Groq's documented free-tier STT upload limit is 25 MB; formats flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm.
The app caps uploads at 4 MB (`src/lib/ai/audio.ts`) so a voice note stays inside the ~4.5 MB serverless
request-body limit on Vercel.

Exact Groq per-model RPM/TPM/RPD values were **not** verified for this account — check
https://console.groq.com/settings/limits. Check ElevenLabs credits at https://elevenlabs.io/app/subscription.

## Environment (server-only, stored as project secrets)
Required for AI: `GROQ_API_KEY`. Optional: `GROQ_LLM_MODEL` (default `openai/gpt-oss-20b`), `GROQ_STT_MODEL`
(default `whisper-large-v3-turbo`). Read-aloud needs all of `ELEVENLABS_API_KEY`, `ELEVENLABS_TTS_MODEL_ID`,
`ELEVENLABS_VOICE_ID`. Without them the app works; the UI shows "not configured" and reports are still saved.

## Failure behaviour
Typed reports are saved before analysis, so a provider failure leaves the report readable with an
"Analysis failed" state and a retry button. LLM calls: 30 s timeout, one retry only for timeout/network/5xx or
output that fails validation; 401/403/404/413/429 are never retried. STT: 120 s timeout, no retry, nothing is
stored on failure. TTS: 30 s timeout, no retry, max 1,200 characters. Error codes (not payloads) are stored and audited.
Throttle: 30 reports per user per hour (database-enforced).

## Validation
`src/lib/ai/cues.ts` defines schema `cues.v1` (Zod, `.strict()`), the JSON Schema sent to Groq, and post-checks:
measurements and time phrases not found verbatim in the report are removed; non-verbatim evidence is flagged;
category values impossible for the cue type are dropped. Stored cues are re-validated on read. Denied, past,
hedged or unknown cues pre-fill as care notes, never as structured symptoms. The model never supplies ids,
statuses or roles — those come from the authenticated request and the database.

## Security, retention
- Tables `care_reports`, `report_cues`, `care_report_events`: RLS by `can_access_org`, SELECT-only for clients.
- Human actions run as the caller (actor = `auth.uid()`); machine outputs are written by service-role-only
  functions after the server verified the caller, and those functions re-check the actor's org/role.
- Audit: `care_report.submitted`, `.extracted`, `.extraction_failed`, `.transcript_corrected`,
  `.clarification_requested`, `.tts_generated`, `report_cue.confirmed`, `report_cue.rejected`, plus the existing
  `observation.recorded`.
- **Audio is never stored** (`audio_retained` is constrained to false). Transcripts, corrections and cues are kept
  with the report until the senior record is deleted (cascade). Report text is sent to Groq; confirmed summaries to
  ElevenLabs. Review those providers' data policies before using real data. No compliance claim is made.

## Tests
- `bunx vitest run` — mocked adapters + rules (`src/test/ai-phase7.test.ts`, 30 tests). No network.
- `supabase/tests/rls_phase7.sql` — run in the SQL editor after applying the update; expect only
  `ok`/`denied` in `TEST_RESULTS`.
- Opt-in live smoke (spends free-tier quota): `bun scripts/ai-smoke.ts llm|tts|stt`. Synthetic text only.

## Blockers / limitations
1. **`supabase/phase7_reports.sql` is not applied** (REST returns 404 for `care_reports`). Until applied, the
   reports section shows "Reports aren't set up in the database yet". Apply it in the Supabase SQL editor, then run
   `rls_phase7.sql`.
2. No signed-in browser end-to-end run was possible (no session in the sandbox, tables missing).
3. Whisper wrote English words in Devanagari when the clip was mostly Hindi; reviewers should correct transcripts.
4. Groq does not expose a language-confidence value; none is shown. "Low quality" is a hint from segment stats.
5. Confirmed observations do not auto-run an assessment; use "Run assessment" on the profile (existing Phase 5 flow).
6. Voice recording in-browser is not included; users upload an audio file.
