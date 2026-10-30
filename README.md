# Sahaara

> **AI-Assisted Early-Warning & Care-Coordination Platform for Seniors Living at Home.**  
> Designed for care coordinators, seniors, and authorized family members.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](#verification)
[![Test Suite](https://img.shields.io/badge/tests-299%20passing-brightgreen)](#verification)
[![TypeScript](https://img.shields.io/badge/typescript-strict%20clean-blue)](#stack)
[![Deploy Target](https://img.shields.io/badge/deploy-Vercel%20%2B%20Cloudflare-blueviolet)](#deploying-to-vercel)

---

## 🌟 Core Modules & Capabilities

### 1. ⌚ Smartwatch Live Health Monitoring (Fire-Boltt Legacy)
- **Showcased Wearable:** Fire-Boltt Legacy smartwatch (1.43" AMOLED, Stainless Steel dial, Bluetooth LE 5.2).
- **8 Continuous Biometric Cards:** Heart Rate (BPM), Blood Oxygen (SpO2 %), Stress Level (HRV RMSSD score 0–100), Sleep Architecture (Deep, Light, REM), Daily Steps, Caloric Burn, Distance, and Blood Pressure estimates.
- **Live Updating Stream:** Real-time stream with pause/resume controls, configurable intervals (3s, 5s, 10s, 30s), and natural physiological drift.
- **Hourly Health Updates Timeline:** Chronological hourly reports (e.g. 10:00 AM, 11:00 AM, 12:00 PM) with synthesized observation summaries and filters (Today, 24h, 7d, Custom Date).
- **Interactive Analytics:** Multi-tab Recharts dashboard covering diurnal rhythms, hypoxia thresholds, and normal reference ranges.
- **Anomaly Detection & Care Triage:** Rule-based detection (SpO2 < 92%, Tachycardia > 115 BPM, elevated BP) with coordinator triage workflow (`new` → `acknowledged` → `under_review` → `resolved`).
- **Health Data Ingestion:** Validated drag-and-drop JSON file import with schema preview and sample download.

### 2. 💬 Real Two-Way Twilio WhatsApp Integration & Groq AI
- **Two-Way Messaging:** Live coordinator inbox with free-form outbound messaging, Twilio official SDK delivery, and read receipts.
- **Groq Clinical Intent Routing:** Inbound messages from seniors and family are classified across routine confirmations, vitals updates, and general inquiries in English, Hindi, and Hinglish.
- **Privacy & Consent Protection:** E.164 phone number masking, explicit consent verification, and multi-tenant isolation.

### 3. 🗓️ Daily Care Routine & Voice Dictation
- **Scheduled Care Tracking:** Medicine, meals, vitals, hydration, and mobility tracking.
- **Groq NLP Interpretation:** Interprets natural language updates like *"subah ki BP wali dawai 9 baje li, lunch nahi kiya"* into structured routine logs.
- **Voice Dictation:** Hands-free speech-to-text recording powered by the Web Speech API and Groq Whisper.

### 4. 👨‍👩‍👧 Secure Family Portal & Voice Notes
- **Attributable Family Access:** Cryptographically verified single-use invitations.
- **Voice Reports:** Audio notes processed via Groq Whisper with pre-submission transcript editing.
- **Care Team Follow-ups:** Two-way coordination with family caregivers.

### 5. 🛡️ Deterministic Clinical Risk Engine
- **Pure & Auditable:** Zero-I/O rules engine (`assess(input, config)`) providing reproducible, versioned risk assessments across physiological and behavioural domains.
- **Human-in-the-Loop Reviews:** Unverified AI cues never become medical records or diagnoses without human review and attribution.

---

## 🔒 Care Safety & Architecture Principles

- **No Diagnostic Claims:** Consumer wearables and AI suggestions provide trend indications; acute decisions require clinical verification.
- **Unforgeable Provenance:** Roles, consent, and audit logs are governed by PostgreSQL `SECURITY DEFINER` functions deriving identity from `auth.uid()`.
- **Append-Only Records:** Telemetry, routine logs, baselines, and observations are append-only. History is never overwritten.
- **Multi-Tenant Isolation:** Care data is strictly gated by `can_access_org()` and `can_access_senior()`.

---

## 🛠️ Stack

- **Framework:** TanStack Start v1 (React 19, TypeScript strict)
- **Styling:** Tailwind CSS v4, Lucide Icons, shadcn/ui components
- **Visualizations:** Recharts interactive charts & custom SVG sparklines
- **Database & Auth:** Supabase PostgreSQL with Row Level Security (RLS)
- **AI & Speech Services:** Groq (LLM structured cues & Whisper STT), ElevenLabs (TTS read-aloud)
- **Communications:** Twilio WhatsApp Business API
- **Testing:** Vitest & Bun test runner

---

## 🚀 Local Development

### Prerequisites
- [Bun](https://bun.sh/) 1.4+
- Node.js 22+

### Setup
```bash
# Clone the repository
git clone https://github.com/StrikerFr/saharaa-1.git
cd saharaa-1

# Install dependencies with Bun
bun install

# Configure environment variables
cp .env.example .env

# Run local development server
bun run dev
```
Open [http://localhost:8080](http://localhost:8080) to access the application.

---

## 🧪 Verification & Testing

Run the full verification suite before pushing:

```bash
# 1. Typecheck strict check
bun x tsc --noEmit

# 2. Run unit and integration tests (299 tests)
bun test

# 3. Production build (Vercel Build Output)
bun run build
```

---

## 🌐 Deploying to Vercel

The application builds cleanly using the Vercel Build Output specification (`.vercel/output`):

1. Import the repository in **Vercel**.
2. Vercel automatically detects `vercel.json` with `bun install` and `bun run build`.
3. Configure the following environment variables in **Vercel → Settings → Environment Variables**:

| Variable | Scope | Purpose |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server | Supabase public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Privileged server-only mutations |
| `VITE_SUPABASE_URL` | Client | Browser Supabase URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Browser Supabase key |
| `GROQ_API_KEY` | Server | Groq LLM & Whisper speech-to-text |
| `TWILIO_ACCOUNT_SID` | Server | Twilio WhatsApp integration |
| `TWILIO_AUTH_TOKEN` | Server | Twilio authentication |
| `TWILIO_WHATSAPP_NUMBER` | Server | Twilio WhatsApp sender |
| `ELEVENLABS_API_KEY` | Server | Read-aloud accessibility |
| `ELEVENLABS_VOICE_ID` | Server | Configured ElevenLabs voice ID |

---

## 📄 License
Private & Confidential — Care Safety & Early-Warning Platform.
