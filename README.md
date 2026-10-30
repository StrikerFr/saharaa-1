<div align="center">

# 🌿 Sahaara

### **Intelligent Senior Care. Connected Health. Compassionate Support.**

*An AI-powered early-warning, health telemetry, and care-coordination platform connecting seniors living at home, family caregivers, and clinical care coordinators.*

---

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](#-verification--testing)
[![Test Suite](https://img.shields.io/badge/tests-299%20passing-brightgreen?style=flat-square)](#-verification--testing)
[![TypeScript](https://img.shields.io/badge/typescript-strict%20clean-blue?style=flat-square)](#-technology-stack--4-layer-architecture)
[![Deploy Target](https://img.shields.io/badge/deploy-Vercel%20%2B%20Cloudflare-blueviolet?style=flat-square)](#-deploying-to-vercel)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20RLS-336791?style=flat-square)](#layer-3-data-and-synchronization)
[![AI Engine](https://img.shields.io/badge/ai-Groq%20%2B%20Ollama%20Qwen3-FF6F00?style=flat-square)](#-ai-models--ai-architecture)

---

</div>

## 📸 Platform Interface Showcase

Below are authentic screenshots from the active Sahaara production workspace:

### 1. ⌚ Live Health Monitoring & Fire-Boltt Legacy Telemetry (`/monitoring`)
![Sahaara Live Health Monitoring & Fire-Boltt Legacy Telemetry](assets/readme/4.jpeg)
*Real-time dashboard displaying connected Fire-Boltt Legacy smartwatch telemetry (BLE 5.2, 84% battery), 8 continuous biometric metric cards with trend sparklines, previous reading comparisons, and physiological status badges.*

---

### 2. 👤 Senior Care Profile & Health Intelligence Overview
![Sahaara Senior Profile Overview](assets/readme/1.jpeg)
*Comprehensive senior profile showing operational workload tiles, review status from the deterministic risk engine, unverified AI summary of the last 14 days, and unified navigation tabs including Live Health Monitoring.*

---

### 3. 💬 Ask Sahaara AI — Context-Grounded Conversational Care Assistant
![Ask Sahaara AI Conversational Assistant](assets/readme/2.jpeg)
*Interactive care assistant grounded in live verified records, answering coordinator queries regarding medication adherence, schedule progress, and pending daily tasks.*

---

### 4. 🩺 Latest Observations & Personalized Baseline Matrix
![Latest Observations and Personalized Baselines](assets/readme/3.jpeg)
*Transparent comparison of latest physiological and behavioral observations against individual senior baselines. Explicitly reinforces that baseline values represent personal reference points rather than assumed clinical normality.*

---

### 5. 📜 Chronological Observation History & Attributable Audit Log
![Observation History and Audit Trail](assets/readme/5.jpeg)
*Append-only chronological observation feed with delayed-entry tags, care team member attribution, and immutable audit timestamps.*

---

## 📋 Table of Contents

1. [Platform Interface Showcase](#-platform-interface-showcase)
2. [Project Overview](#-project-overview)
3. [Implementation & Architecture Status Matrix](#-implementation--architecture-status-matrix)
4. [Technology Stack — 4-Layer Architecture](#-technology-stack--4-layer-architecture)
   - [Layer 1: Capture and Communication](#layer-1-capture-and-communication)
   - [Layer 2: Local AI & Inference](#layer-2-local-ai--inference)
   - [Layer 3: Data and Synchronization](#layer-3-data-and-synchronization)
   - [Layer 4: Presentation and Processing](#layer-4-presentation-and-processing)
5. [Wearable Health Monitoring & Smartwatch Integration (Fire-Boltt Legacy)](#-wearable-health-monitoring--smartwatch-integration)
6. [AI Models & AI Architecture](#-ai-models--ai-architecture)
7. [Complete System Architecture Diagrams](#-complete-system-architecture-diagrams)
8. [Environment Variables Reference](#-environment-variables-reference)
9. [Setup & Local Development Guide](#-setup--local-development-guide)
10. [Repository Structure](#-repository-structure)
11. [Care Safety & Clinical Guardrails](#-care-safety--clinical-guardrails)
12. [Verification & Testing](#-verification--testing)
13. [Deploying to Vercel](#-deploying-to-vercel)

---

## 💡 Project Overview

**Sahaara** is a comprehensive, production-grade senior-care coordination platform. As elderly populations age in place at home, care teams face high fragmentation: missed medications, undetected nocturnal desaturations, isolation, and unmonitored mobility decline. 

Sahaara bridges this gap by unifying:
- **Continuous Wearable Telemetry:** Live biometric monitoring using the **Fire-Boltt Legacy smartwatch** (optical PPG heart rate, SpO2, HRV stress, sleep stages, steps, and blood pressure trends).
- **Two-Way Twilio WhatsApp Communication:** Direct coordinator messaging, automated medication check-ins, and Groq-powered clinical intent parsing in **English, Hindi, and Hinglish**.
- **Voice Wellness & Routine Dictation:** Speech-to-text recording with Whisper STT for seniors and caregivers to update daily routines by voice.
- **Deterministic Risk Engine:** A pure, zero-I/O rules engine that detects early behavioral and physiological decline without autonomous clinical diagnosis.
- **Family Portal:** Cryptographically invited family members access verified vitals timelines, receive care updates, and respond to coordinator follow-up requests.
- **Attributable Human-in-the-Loop Triage:** AI outputs remain unverified cues until confirmed by a human coordinator; immutable database audit logs guarantee unforgeable record provenance.

---

## 📊 Implementation & Architecture Status Matrix

To provide total engineering transparency, every platform component is labeled with its exact implementation status:
- <kbd>**IMPLEMENTED**</kbd> — Fully verified in repository source code, covered by tests, and working in production.
- <kbd>**PARTIALLY IMPLEMENTED**</kbd> — Functional code exists in repository, with mock/bridge fallback or hybrid cloud adapter.
- <kbd>**PLANNED**</kbd> — Target architecture designed for standalone microservice/on-premise deployment.

| Architectural Component | Target Role in Architecture | Repository Status | Active Implementation Path |
| :--- | :--- | :--- | :--- |
| **Twilio WhatsApp Integration** | Layer 1: Capture & Messaging | <kbd>**IMPLEMENTED**</kbd> | `src/lib/twilio.server.ts`, `src/lib/whatsapp.server.ts` |
| **Whisper STT** | Layer 1: Voice-to-Text | <kbd>**IMPLEMENTED**</kbd> | Cloud Groq Whisper API (`src/lib/ai/groq.server.ts`) |
| **Smartwatch Dashboard** | Layer 4: Live Telemetry Display | <kbd>**IMPLEMENTED**</kbd> | `src/components/wearables/wearable-health-dashboard.tsx` |
| **Smartwatch Data Engine** | Layer 3: Biometrics & Anomalies | <kbd>**IMPLEMENTED**</kbd> | `src/lib/wearables.ts`, `supabase/phase11_wearables.sql` |
| **JSON Health Ingestion** | Layer 1: Telemetry Upload | <kbd>**IMPLEMENTED**</kbd> | `src/components/wearables/json-import-modal.tsx` |
| **Deterministic Risk Engine** | Layer 2: Clinical Risk Evaluation | <kbd>**IMPLEMENTED**</kbd> | `src/risk/engine.ts`, `src/risk/rules.ts` (Zero-I/O Pure TS) |
| **PostgreSQL + RLS** | Layer 3: Data Source of Truth | <kbd>**IMPLEMENTED**</kbd> | Supabase PostgreSQL (`supabase/full_schema.sql`) |
| **Family Portal & Invites** | Layer 4: Caregiver Access | <kbd>**IMPLEMENTED**</kbd> | `src/routes/_authenticated/family.tsx` |
| **Daily Care Routine & Voice**| Layer 4: Routine Logging | <kbd>**IMPLEMENTED**</kbd> | `src/components/seniors/daily-routine.tsx` |
| **ElevenLabs TTS** | Layer 1: Read-Aloud Accessibility | <kbd>**IMPLEMENTED**</kbd> | `src/lib/ai/elevenlabs.server.ts` |
| **Ollama + Qwen3** | Layer 2: Local AI Inference | <kbd>**PLANNED**</kbd> *(Target Local LLM)* | Coexists with Groq Llama 3.3/GPT-OSS (`src/lib/ai/groq.server.ts`) |
| **FastAPI Microservice** | Layer 2: Python AI Orchestrator | <kbd>**PLANNED**</kbd> *(Target Service)* | Currently handled by TanStack Start server functions |
| **Android Health Connect** | Layer 1: Hardware Background Bridge| <kbd>**PLANNED**</kbd> *(Target Mobile Bridge)*| BLE data model & JSON ingestion active |
| **IndexedDB Offline Cache** | Layer 3: Local Browser Offline Store| <kbd>**PARTIALLY IMPLEMENTED**</kbd> | React Query persistent storage + client memory buffer |
| **MinIO S3 Storage** | Layer 3: Private Audio Object Store | <kbd>**PLANNED**</kbd> *(Target S3)* | Transient audio buffer (capped at 4MB) + secure client streaming |
| **Docker Compose** | Infrastructure: Local Orchestration | <kbd>**PLANNED**</kbd> | Deployed on Vercel Build Output + Cloudflare Workers |

---

## 🏗️ Technology Stack — 4-Layer Architecture

The Sahaara platform follows a modular 4-layer architecture separating data capture, edge AI processing, secure relational persistence, and presentation.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SAHAARA 4-LAYER SYSTEM ARCHITECTURE                  │
├────────────────────────────────────────────────────────────────────────┤
│ LAYER 1: CAPTURE & COMMUNICATION                                       │
│  • Fire-Boltt Legacy Smartwatch (BLE Telemetry & Biometrics)           │
│  • Twilio WhatsApp Business API (Inbound/Outbound Two-Way Webhooks)   │
│  • Whisper Speech-to-Text (Voice Notes & Routine Audio Dictation)      │
│  • Senior & Family Web Interfaces (Cryptographic Token Access)         │
├────────────────────────────────────────────────────────────────────────┤
│ LAYER 2: LOCAL & CLOUD AI ORCHESTRATION                                │
│  • Deterministic Sahaara Risk Engine (Pure TypeScript, Zero-I/O)       │
│  • Ollama + Qwen3 [Target] / Groq Llama 3.3 [Active] (NLP Extraction)  │
│  • Physiological Anomaly Rule Evaluator (SpO2, Tachycardia, BP spikes)  │
│  • FastAPI Python Microservice [Target Service Layer]                  │
├────────────────────────────────────────────────────────────────────────┤
│ LAYER 3: DATA & SYNCHRONIZATION                                        │
│  • PostgreSQL with Row Level Security (RLS) & Append-Only Triggers     │
│  • Security Definer Stored Procedures (Attributable Actor Context)     │
│  • IndexedDB Browser Cache [Client Sync Queue]                         │
│  • MinIO Private Object Storage [Target Audio/Doc Vault]               │
├────────────────────────────────────────────────────────────────────────┤
│ LAYER 4: PRESENTATION & PROCESSING                                     │
│  • TanStack Start v1 / Next.js + React 19 Strict Type Safety           │
│  • Tailwind CSS v4 + shadcn/ui + Recharts High-Res Visualizations      │
│  • Live Health Monitoring Dashboard (`/monitoring` & Senior Tab)       │
│  • Background Schedulers & Nitro Serverless Task Workers               │
└────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Capture and Communication
- **WhatsApp via Twilio `[IMPLEMENTED]`:** 
  Twilio's official SDK powers two-way messaging between coordinators, seniors, and family members. Inbound webhooks verify SHA-1 signatures with `x-twilio-signature`, deduplicate incoming packets via `MessageSid`, and persist chats under tenant-isolated database rows with E.164 phone number privacy masking.
- **Whisper Speech-to-Text `[IMPLEMENTED]`:** 
  Audio recordings from seniors or caregivers (e.g. daily routine reports or care concerns) are validated for audio signatures, capped at 4 MB (complying with Vercel serverless request limits), and transcribed into text using Groq's Whisper API (`whisper-large-v3-turbo`).
- **Ollama Runtime `[PLANNED]`:** 
  Target edge architecture for hosting local open-weights language models offline in home care hubs without cloud dependencies.
- **Senior & Family Access `[IMPLEMENTED]`:** 
  Family caregivers access the platform through single-use cryptographic invitation tokens (`src/routes/_authenticated/invite.tsx`), bypassing generic signup barriers while preserving strict multi-tenant authorization.

### Layer 2: Local AI & Inference
- **Ollama + Qwen3 `[PLANNED / Target Architecture]`:** 
  The target local language model architecture specifies **Qwen3 (Qwen2.5:7b-instruct)** running locally via Ollama. It provides private, zero-cloud conversational understanding across **Hindi, English, and Hinglish**, extracting structured care cues without transmitting patient data across public networks.
- **Groq Cloud LLM Coexistence `[IMPLEMENTED]`:** 
  In the active deployment, server-side Groq integration (`src/lib/ai/groq.server.ts`) executes high-speed inference for conversational intent routing, care question answering, and daily routine NLP updates.
- **Deterministic Sahaara Risk Engine `[IMPLEMENTED]`:** 
  A pure, zero-I/O rules engine (`src/risk/engine.ts`). It computes versioned, reproducible risk assessments across physiological vitals, behavioral observations, and medication adherence. Missing or stale data is flagged as operational uncertainty—never falsely presented as reassuring evidence.
- **FastAPI + Python `[PLANNED / Target Architecture]`:** 
  The planned backend microservice to host Python-based bio-signal processing algorithms, continuous ECG/PPG wave analysis, and local model orchestration.

### Layer 3: Data and Synchronization
- **PostgreSQL `[IMPLEMENTED]`:** 
  Central relational database powered by PostgreSQL with Row Level Security (RLS). Every table revokes default public access, grants minimal permissions to `authenticated`, and uses `SECURITY DEFINER` procedures that derive the actor strictly from `auth.uid()`.
- **IndexedDB `[PARTIALLY IMPLEMENTED]`:** 
  Browser storage for client-side offline caching and resilient state hydration when coordinators work in rural areas with intermittent cellular connectivity.
- **MinIO `[PLANNED / Target Architecture]`:** 
  Target S3-compatible private object store to archive senior audio voice notes and legal consent documents with strict access token gating.

### Layer 4: Presentation and Processing
- **TanStack Start / Next.js + React 19 `[IMPLEMENTED]`:** 
  High-performance full-stack framework with React 19, strict TypeScript, and Vite/Nitro build pipelines deploying simultaneously to Vercel Build Output and Cloudflare Workers.
- **Live Health Monitoring Dashboard `[IMPLEMENTED]`:** 
  Real-time telemetry control center (`/monitoring`) with senior switching, live biometrics cards, hourly report timeline, and Recharts trends (see screenshot [4.jpeg](#1--live-health-monitoring--fire-boltt-legacy-telemetry-monitoring)).
- **Workers and Scheduler `[IMPLEMENTED]`:** 
  Nitro serverless background tasks and cron endpoints manage scheduled medication reminders, overdue review escalation, and hourly report rollups.

---

## ⌚ Wearable Health Monitoring & Smartwatch Integration

<div align="center">
  <img src="assets/readme/fire-boltt-legacy.jpg" alt="Fire-Boltt Legacy Smartwatch" width="380" style="border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);" />
  <p><em>The Fire-Boltt Legacy Smartwatch showcased in Sahaara's Live Health Monitoring System.</em></p>
</div>

Sahaara showcases the **Fire-Boltt Legacy smartwatch** as its flagship consumer health wearable. The integration combines optical sensor biometrics with continuous telemetry monitoring designed specifically for senior care safety.

### Genuine Device Specifications
- **Model:** Fire-Boltt Legacy (068 Luxe Edition)
- **Display:** 1.43" AMOLED Display, 466×466 px High-Resolution
- **Chassis:** Stainless Steel Dial with Dual Strap Hardware
- **Connectivity:** Bluetooth Low Energy (BLE) 5.2
- **Battery:** 330 mAh Lithium-Polymer (~7 days standby)
- **Sensor Array:** Continuous Biometric Optical PPG Heart Rate, Red & Infrared Pulse Oximeter (SpO2), 3-Axis Accelerometer, and HRV Sympathetic Stress Sensor.

### 8 Monitored Health Metrics
1. **Heart Rate (BPM):** Continuous PPG optical pulse detection with resting bradycardia (<52 BPM) and tachycardia (>115 BPM) thresholds.
2. **Blood Oxygen (SpO2 %):** Dual-wavelength optical reflectance saturation with critical hypoxia alert threshold (<92%).
3. **Stress Level (HRV RMSSD):** Continuous beat-to-beat variability scored 0–100 (*Relaxed*, *Low*, *Normal*, *Mild*, *Elevated*).
4. **Sleep Duration & Architecture:** Total sleep duration with phase segmentation (*Deep Restorative*, *Light*, *REM Dream*, and *Awake*).
5. **Daily Steps:** Accelerometer stride filter distinguishing ambulatory walking from non-ambulatory gestures.
6. **Calories Burned:** Combined active exertion and basal metabolic rate (kcal).
7. **Distance Travelled:** Calibrated stride distance in kilometers.
8. **Blood Pressure (mmHg):** Non-invasive optical pulse transit time estimate (systolic/diastolic) with hypertensive warning guardrail (≥145/92 mmHg).

### Smartwatch Telemetry Data Pipeline

```
┌───────────────────────────────────────────────┐
│        Fire-Boltt Legacy Smartwatch           │
│  (Optical PPG, SpO2, Accelerometer, HRV)      │
└───────────────────────┬───────────────────────┘
                        │ Bluetooth LE 5.2
                        ▼
┌───────────────────────────────────────────────┐
│     Companion Mobile Application / Gateway    │
│    (Da Fit / Fire-Boltt Health Companion)     │
└───────────────────────┬───────────────────────┘
                        │ Android Health Connect / BLE Sync [Planned Bridge]
                        ▼
┌───────────────────────────────────────────────┐
│        Sahaara Ingestion API Gateway          │
│  (Validates Senior ID, Device MAC, Packets)   │
└───────────────────────┬───────────────────────┘
                        │ Append-Only SQL Ingestion
                        ▼
┌───────────────────────────────────────────────┐
│        PostgreSQL Wearable Database           │
│   (wearable_devices, telemetry_readings)      │
└───────────────────────┬───────────────────────┘
                        │ Real-Time Subscription / Live Stream
                        ▼
┌───────────────────────────────────────────────┐
│    Live Health Monitoring Web Dashboard       │
│  (8 Metric Cards, Hourly Feed, Recharts Wave) │
└───────────────────────────────────────────────┘
```

> **Important Hardware & Telemetry Notice:**  
> The Fire-Boltt Legacy smartwatch communicates over Bluetooth LE with companion smartphone software. The watch does **not** expose a direct public cloud API to third-party web browsers. In Sahaara:
> - The live biometrics engine, database schema, anomaly rules, 24-hour diurnal baselines, and drag-and-drop JSON health file import are **`IMPLEMENTED`**.
> - Direct background synchronization via an Android Health Connect native bridge represents the **`PLANNED`** hardware adapter.
> - Consumer smartwatch readings provide physiological trend signals and are **never** treated as definitive clinical diagnoses without calibrated medical cuff/oximeter confirmation.

---

## 🧠 AI Models & AI Architecture

Sahaara employs a hybrid AI architecture designed for low-latency triage, conversational ease, and clinical safety.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SAHAARA AI PIPELINE                             │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Component                │ Implementation Details                      │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Target Local LLM         │ Ollama + Qwen3 (Qwen2.5:7b-instruct)        │
│ Cloud LLM (Active)       │ Groq API (openai/gpt-oss-20b, Llama 3.3)   │
│ Speech-to-Text (STT)     │ Whisper Large v3 Turbo                      │
│ Text-to-Speech (TTS)     │ ElevenLabs Multilingual v2                  │
│ Clinical Risk Engine     │ Deterministic Pure TypeScript (Zero-I/O)    │
│ Anomaly Detection Engine │ Rule-based Physiological Guardrails         │
└──────────────────────────┴─────────────────────────────────────────────┘
```

### 1. Ollama + Qwen3 (Local AI Inference) `[PLANNED]`
- **Local Deployment:** Runs on-premise or edge server via Ollama (`http://localhost:11434`), eliminating public cloud data egress for sensitive senior health dialogue.
- **Multilingual Support:** Evaluated for nuanced comprehension of English, Hindi, and colloquial Hinglish (e.g. *"Dawai le li par subah se thodi ghabrahat ho rahi hai"*).
- **Structured Output:** Emits strict JSON schemas matching Sahaara cue definitions.

### 2. Groq Cloud LLM `[IMPLEMENTED]`
- **Active Service:** Serves as the primary production LLM engine in cloud deployments.
- **Functions:** Powers two-way WhatsApp intent classification, senior profile wellbeing summaries, and conversational care Q&A (see screenshot [2.jpeg](#3--ask-sahaara-ai--context-grounded-conversational-care-assistant)).
- **Strict Fallback:** Includes deterministic rule-based routine parsing fallback if the external API reaches rate limits or network timeouts.

### 3. Whisper Speech-to-Text `[IMPLEMENTED]`
- **Audio Validation:** Enforces strict header checks (MP3, WAV, M4A, OGG) and rejects payloads exceeding 4 MB.
- **Human Editing Gate:** Transcripts are surfaced in the UI for coordinator confirmation or correction before entering the clinical record.

### 4. Deterministic Sahaara Risk Engine `[IMPLEMENTED]`
- **Zero-I/O Architecture:** Pure mathematical and logical function `assess(input, config) -> Assessment`.
- **Domain Coverage:** Evaluates vitals (BP, SpO2, HR), cognitive status, mobility, nutrition, and medication adherence.
- **Uncertainty Principle:** If data is missing or stale, the engine surfaces an operational review alert for information gathering. It **never** treats absence of data as evidence of patient safety.

---

## 📐 Complete System Architecture Diagrams

### Diagram A: Overall Sahaara 4-Layer Architecture

```mermaid
flowchart TD
    subgraph L1["Layer 1: Capture & Communication"]
        W[Fire-Boltt Legacy Watch] -->|BLE Telemetry| APP[Companion App / Gateway]
        WA[Twilio WhatsApp] -->|Webhook / API| WB[Inbound Gateway]
        MIC[Voice Dictation / STT] -->|Audio Packets| STT[Whisper Audio Engine]
        FAM[Senior & Family Portal] -->|Invites & Notes| FP[Family Web Service]
    end

    subgraph L2["Layer 2: Local & Cloud AI"]
        WB --> AI_GATE{Intent Classifier}
        AI_GATE -->|Cloud Mode| GROQ[Groq Llama 3.3 / GPT-OSS]
        AI_GATE -->|Local Mode| OLLAMA[Ollama + Qwen3]
        STT --> CUE[Clinical Cue Extractor]
        RE[Deterministic Risk Engine] -->|Zero-I/O Rules| ASSESS[Risk Assessments]
    end

    subgraph L3["Layer 3: Data & Synchronization"]
        DB[(PostgreSQL Database)]
        RLS[Row Level Security & Audit Triggers]
        IDB[IndexedDB Browser Cache]
        MINIO[MinIO Private Object Storage]
        DB --- RLS
    end

    subgraph L4["Layer 4: Presentation & Processing"]
        DASH[Coordinator Operations Dashboard]
        MON[Live Health Monitoring Dashboard]
        ALERT[Anomaly & Review Queue]
        CRON[Nitro Tasks & Background Schedulers]
    end

    L1 --> L2
    L2 --> L3
    L3 --> L4
    L4 -->|Coordinator Actions| L3
```

---

### Diagram B: WhatsApp Two-Way AI Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Senior as Senior / Family
    participant Twilio as Twilio WhatsApp API
    participant Webhook as Sahaara Webhook Gateway
    participant AI as Groq / Qwen3 Classifier
    participant DB as PostgreSQL (RLS)
    actor Coord as Care Coordinator

    Senior->>Twilio: Inbound WhatsApp ("Dawai 9 baje li, BP normal hai")
    Twilio->>Webhook: Signed HTTP POST (x-twilio-signature)
    Webhook->>Webhook: Verify signature & deduplicate MessageSid
    Webhook->>DB: Persist raw message & resolve masked identity
    Webhook->>AI: Classify intent (Medication, Vitals, General)
    AI-->>Webhook: Structured Routine Cue (medication=done, time=09:00)
    Webhook->>DB: Update daily routine log (source: whatsapp)
    Webhook->>Twilio: Automated confirmation reply
    Twilio-->>Senior: "Thank you! Your morning medication has been recorded."
    DB->>Coord: Real-time update in Coordinator Inbox & Review Queue
```

---

### Diagram C: Voice Transcription & AI Cue Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Coordinator / Senior
    participant UI as Audio Voice Recorder
    participant Server as Audio Validation Server
    participant Whisper as Whisper STT Engine
    participant LLM as Cue Extraction LLM
    participant Gate as Human Confirmation Gate
    participant DB as PostgreSQL

    User->>UI: Record speech note (English, Hindi, Hinglish)
    UI->>Server: Submit audio blob (Max 4 MB)
    Server->>Server: Verify audio header & length
    Server->>Whisper: Transcribe audio stream
    Whisper-->>Server: Raw transcript text
    Server->>LLM: Extract clinical cues (Schema: cues.v1)
    LLM-->>Server: Candidate cues array (Observations, Vitals)
    Server-->>UI: Display transcript & candidate cues for human review
    User->>Gate: Confirm / Edit / Reject extracted cues
    Gate->>DB: Write permanent observation (client_request_id = cue_id)
    Note over DB: Unconfirmed AI suggestions are NEVER written to medical records
```

---

### Diagram D: Smartwatch-to-Cloud Telemetry Pipeline

```mermaid
flowchart LR
    WATCH["Fire-Boltt Legacy\n(AMOLED 1.43, PPG Sensor)"] -->|BLE 5.2| PHONE["Companion App /\nAndroid Sync Bridge"]
    PHONE -->|Telemetry JSON| API["Sahaara Ingestion API\n(/api/wearables)"]
    JSON_FILE["Manual JSON Export\n(Health Data Import)"] -->|File Upload| API
    API -->|Validate Schema| ZOD{Zod Validation}
    ZOD -->|Valid| DB[("PostgreSQL\n(wearable_health_readings)")]
    ZOD -->|Invalid| ERR["Reject with Schema Notice"]
    DB --> ENGINE["Physiological Anomaly\nRule Engine"]
    ENGINE -->|SpO2 < 92% or HR > 115| ALERTS["Care Anomaly Alert\n(wearable_health_alerts)"]
    DB --> DASH["Live Health Monitoring Dashboard\n(8 Metric Cards & Hourly Timeline)"]
```

---

### Diagram E: PostgreSQL Relational Schema Architecture

```mermaid
erDiagram
    organizations ||--o{ seniors : scopes
    organizations ||--o{ profiles : employs
    seniors ||--o{ wearable_devices : pairs
    seniors ||--o{ wearable_health_readings : logs
    seniors ||--o{ wearable_health_alerts : raises
    seniors ||--o{ care_routine_items : schedules
    care_routine_items ||--o{ care_routine_logs : tracks
    seniors ||--o{ observations : records
    seniors ||--o{ review_cases : triggers
    review_cases ||--o{ follow_up_tasks : creates
    seniors ||--o{ whatsapp_conversations : maintains
    whatsapp_conversations ||--o{ whatsapp_messages : contains

    wearable_health_readings {
        uuid id PK
        uuid senior_id FK
        timestamp timestamp
        int heart_rate
        int spo2
        int stress_score
        int bp_systolic
        int bp_diastolic
        int steps
        int calories
        numeric distance_km
        string source
    }

    wearable_health_alerts {
        uuid id PK
        uuid senior_id FK
        string metric
        string severity
        string status
        string current_value
        string reason
        string recommendation
        timestamp detected_at
    }
```

---

### Diagram F: Hourly Health Processing & Anomaly Alert Workflow

```mermaid
flowchart TD
    TICK["Hourly Processing Trigger\n(Nitro Task / Chrono Worker)"] --> PULL["Aggregate 60-min Telemetry Readings\nfor Senior"]
    PULL --> CALC["Compute Hourly Medians & Maxima\n(HR, SpO2, BP, Stress, Steps)"]
    CALC --> SUMMARY["Synthesize Hourly Observation\n('10:00 AM — HR 76 BPM, SpO2 98%, Activity normal')"]
    SUMMARY --> STORE["Write to Hourly Health Timeline\n(hourlyReports state)"]
    CALC --> RULES{"Check Clinical Thresholds"}
    RULES -->|SpO2 < 92%| CRIT["Create Critical Alert\n(Hypoxia Warning)"]
    RULES -->|HR > 115 BPM| WARN["Create Warning Alert\n(Tachycardia Event)"]
    RULES -->|BP >= 145/92| ATTN["Create Attention Alert\n(Hypertensive Surge)"]
    RULES -->|Normal| NORM["Log Routine Normal State"]
    CRIT & WARN & ATTN --> QUEUE["Surface on Coordinator Triage Panel"]
    QUEUE --> TRIAGE{"Coordinator Action"}
    TRIAGE -->|Acknowledge| ACK["Status: Acknowledged"]
    TRIAGE -->|Under Review| REV["Status: Under Review"]
    TRIAGE -->|Verify with Cuff| RES["Status: Resolved + Audit Notes"]
```

---

### Diagram G: Offline-First Synchronization Architecture

```mermaid
flowchart TD
    SUB["User Action\n(Vitals, Routine, Observation)"] --> NET{"Network Available?"}
    NET -->|Yes| POST["Direct Server Function\n(PostgreSQL + RLS)"]
    NET -->|No / Intermittent| IDB["Write to Local Queue\n(IndexedDB / LocalStorage)"]
    IDB --> BADGE["Display Offline Status Banner"]
    ONLINE["Network Restored Event\n(window.navigator.onLine)"] --> DRAIN["Drain Local Sync Queue"]
    DRAIN --> IDEM{"Idempotent Check\n(client_request_id)"}
    IDEM -->|New| COMMIT["Execute Transaction & Write DB"]
    IDEM -->|Duplicate| DROP["Discard Duplicate Packet"]
    COMMIT --> CLEAR["Clear Synced Items from Local Queue"]
```

---

## 🔐 Environment Variables Reference

| Variable Name | Category | Scope | Status | Required? | Purpose & Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `APP_URL` | Application | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Public deployment URL used for webhooks and auth callbacks (e.g. `https://saharaa-1.vercel.app`). |
| `NODE_ENV` | Application | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Runtime environment (`development`, `production`, `test`). |
| `VITE_SUPABASE_URL` | PostgreSQL | Client | <kbd>**IMPLEMENTED**</kbd> | Required | Public Supabase endpoint inlined into browser bundle. Obtain from Supabase Project Settings. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | PostgreSQL | Client | <kbd>**IMPLEMENTED**</kbd> | Required | Public API key for client-side queries. Obtain from Supabase API settings. |
| `SUPABASE_URL` | PostgreSQL | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Server-side Supabase URL. Identical to `VITE_SUPABASE_URL`. |
| `SUPABASE_PUBLISHABLE_KEY` | PostgreSQL | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Server-side API key for auth token verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | PostgreSQL | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Privileged service key for append-only risk engine writes. **Never expose to client.** |
| `DATABASE_URL` | PostgreSQL | Server | <kbd>**PLANNED**</kbd> | Optional | Direct Postgres connection string for standalone microservices (`postgresql://user:pass@host:5432/db`). |
| `OLLAMA_BASE_URL` | Local AI | Server | <kbd>**PLANNED**</kbd> | Optional | Host URL for local Ollama daemon (defaults to `http://localhost:11434`). |
| `OLLAMA_MODEL` | Local AI | Server | <kbd>**PLANNED**</kbd> | Optional | Model identifier to pull and run locally (e.g. `qwen2.5:7b-instruct`). |
| `GROQ_API_KEY` | Cloud AI | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Groq Cloud API key for low-latency WhatsApp routing and cue extraction. Obtain from console.groq.com. |
| `GROQ_LLM_MODEL` | Cloud AI | Server | <kbd>**IMPLEMENTED**</kbd> | Optional | Groq chat completion model (defaults to `openai/gpt-oss-20b` or `llama-3.3-70b-versatile`). |
| `GROQ_STT_MODEL` | Cloud AI | Server | <kbd>**IMPLEMENTED**</kbd> | Optional | Groq speech-to-text model (defaults to `whisper-large-v3-turbo`). |
| `TWILIO_ACCOUNT_SID` | WhatsApp | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Twilio account SID. Obtain from Twilio Console. |
| `TWILIO_AUTH_TOKEN` | WhatsApp | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Twilio authentication token for webhook signature verification. |
| `TWILIO_WHATSAPP_NUMBER` | WhatsApp | Server | <kbd>**IMPLEMENTED**</kbd> | Required | Verified Twilio WhatsApp sender (e.g. `whatsapp:+17372508034`). |
| `ELEVENLABS_API_KEY` | Speech Synthesis| Server | <kbd>**IMPLEMENTED**</kbd> | Optional | ElevenLabs API key for senior read-aloud features. |
| `ELEVENLABS_VOICE_ID` | Speech Synthesis| Server | <kbd>**IMPLEMENTED**</kbd> | Optional | Verified ElevenLabs voice ID (e.g. `21m00Tcm4TlvDq8ikWAM`). |
| `ELEVENLABS_TTS_MODEL_ID` | Speech Synthesis| Server | <kbd>**IMPLEMENTED**</kbd> | Optional | ElevenLabs model ID (`eleven_multilingual_v2`). |
| `MINIO_ENDPOINT` | Storage | Server | <kbd>**PLANNED**</kbd> | Optional | S3-compatible private MinIO endpoint for audio archival. |
| `REDIS_URL` | Queue / Worker | Server | <kbd>**PLANNED**</kbd> | Optional | Redis connection URL for background scheduled jobs. |

---

## 🚀 Setup & Local Development Guide

### Prerequisites
- **Node.js:** v22.0.0 or higher
- **Bun:** v1.4.0 or higher ([Install Bun](https://bun.sh/))
- **Git**

### Step-by-Step Installation

```bash
# 1. Clone the repository
git clone https://github.com/StrikerFr/saharaa-1.git
cd saharaa-1

# 2. Install dependencies strictly using Bun
bun install

# 3. Configure local environment variables
cp .env.example .env

# Open .env and populate your Supabase and provider credentials.
# Minimum required for local dev:
# VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
```

### Database Initialization
Apply the consolidated schemas to your PostgreSQL / Supabase project in order:
1. `supabase/full_schema.sql` (Base tables, RLS functions, audit triggers)
2. `supabase/phase7_reports.sql` (AI reports and cues)
3. `supabase/phase8_routine.sql` (Daily routines and care scheduling)
4. `supabase/phase9_family_portal.sql` (Family invitations and portal access)
5. `supabase/phase10_whatsapp.sql` (Twilio WhatsApp conversations and masked identities)
6. `supabase/phase11_wearables.sql` (Smartwatch telemetry readings and anomaly alerts)

### Starting Development Server
```bash
bun run dev
```
The application will launch at **`http://localhost:8080`**.

---

## 📁 Repository Structure

```
saharaa-1/
├── assets/
│   └── readme/                       # Project documentation visuals & screenshots
│       ├── 1.jpeg                    # Senior Profile & Care Overview
│       ├── 2.jpeg                    # Ask Sahaara AI Conversational Assistant
│       ├── 3.jpeg                    # Latest Observations & Baselines Matrix
│       ├── 4.jpeg                    # Live Health Monitoring Dashboard (Fire-Boltt)
│       ├── 5.jpeg                    # Observation History & Audit Log
│       ├── fire-boltt-legacy.jpg     # Fire-Boltt Legacy front showcase
│       └── fire-boltt-legacy-angle.jpg
├── docs/                             # Phase handoffs & audit specifications
├── public/                           # Static assets, webmanifest, robots.txt, sitemap
│   └── wearables/                    # Served wearable device product images
├── scripts/                          # Synthetic patient generators & seed scripts
│   ├── seed-demo-data.ts             # Seeds realistic senior biometrics & baselines
│   └── synthetic.ts                  # Deterministic synthetic data generator
├── src/
│   ├── components/
│   │   ├── ai/                       # Senior AI chat & conversational interfaces
│   │   ├── charts/                   # Recharts wrappers & custom SVG sparklines
│   │   ├── family/                   # Family portal components & voice notes
│   │   ├── messages/                 # WhatsApp conversation inbox & free-form composer
│   │   ├── reports/                  # Human review gate & voice recorder components
│   │   ├── review/                   # Coordinator triage & review case panels
│   │   ├── seniors/                  # Senior profiles, baseline manager, routine checklist
│   │   ├── shell/                    # App shell, navigation sidebar, metric cards
│   │   ├── ui/                       # Accessible shadcn/ui primitives
│   │   └── wearables/                # Fire-Boltt Legacy dashboard, biometrics grid,
│   │                                 # hourly timeline, Recharts suite & JSON import modal
│   ├── integrations/
│   │   └── supabase/                 # Supabase client, auth middleware & types
│   ├── lib/
│   │   ├── ai/                       # Groq LLM/STT, ElevenLabs TTS & prompt engineering
│   │   ├── alerts.ts                 # Alert generation rules & lifecycle logic
│   │   ├── routine.ts                # Care routine schedule rules & pure calculations
│   │   ├── twilio.server.ts          # Twilio SDK adapter & webhook signature validation
│   │   ├── wearables.ts              # Biometric types, physiological ranges, anomaly rules
│   │   ├── wearables.functions.ts    # Server functions for smartwatch telemetry & import
│   │   └── whatsapp-ai.server.ts     # Multilingual Groq clinical intent processing pipeline
│   ├── risk/                         # Pure deterministic clinical risk engine (Zero-I/O)
│   ├── routes/                       # TanStack Router file-based route definitions
│   │   ├── _authenticated/
│   │   │   ├── monitoring.tsx        # Live Health Monitoring Dashboard route (/monitoring)
│   │   │   ├── seniors.$seniorId.index.tsx # Senior profile tabs (includes Wearables tab)
│   │   │   ├── messages.tsx          # Real two-way WhatsApp inbox route
│   │   │   ├── family.tsx            # Secure Family Portal route
│   │   │   └── ...                   # Alerts, Follow-ups, Reports routes
│   └── test/                         # 21 comprehensive Vitest test suites (299 tests)
├── supabase/                         # Production SQL migrations & RLS test matrices
│   ├── phase11_wearables.sql         # Smartwatch telemetry & alerts migration
│   └── ...
├── .env.example                      # Complete environment configuration template
├── package.json                      # Project dependencies & scripts
├── tsconfig.json                     # Strict TypeScript compiler options
└── vite.config.ts                    # Vite build configuration (Vercel & Nitro)
```

---

## 🛡️ Care Safety & Clinical Guardrails

1. **Non-Diagnostic Policy:**  
   Sahaara explicitly does not diagnose medical conditions, alter dosages, or dispatch emergency services autonomously. All physiological readings (including smartwatch vitals) represent trend indications.
2. **Attributable Decision Making:**  
   AI models generate candidate cues—never permanent medical records. Permanent observations require explicit coordinator confirmation via `confirm_report_cue`.
3. **Uncertainty as Alert:**  
   Missing or stale telemetry is treated as operational uncertainty. The system prompts coordinators to investigate rather than assuming silence equals safety.
4. **Tenant Isolation & Provenance:**  
   Row Level Security ensures care organizations can never inspect cross-tenant records. Every database update carries immutable timestamps and user attribution derived from `auth.uid()`.

---

## 🧪 Verification & Testing

Sahaara enforces 100% type-safety and comprehensive test coverage.

```bash
# 1. Strict TypeScript type check
bun x tsc --noEmit

# 2. Run full test suite (21 test suites, 299 tests)
bun test

# 3. Production serverless bundle compilation
bun run build
```

**Test Suite Coverage Summary:**
- **Wearables & Biometrics (`wearables.test.ts`):** 14 tests verifying Zod import schemas, physiological anomaly rules (hypoxia, tachycardia, HTN), and diurnal baseline generators.
- **WhatsApp Two-Way & Identity (`whatsapp-*.test.ts`):** 35 tests covering signature verification, phone privacy masking, and Groq clinical intent routing.
- **Deterministic Risk Engine (`risk-engine.test.ts`):** Verifies zero-I/O pure assessment reproducibility and domain weighting.
- **Family Portal Security (`family.test.ts`):** 21 tests validating single-use invitation tokens and role isolation.
- **Total:** **299 passing tests, 0 failures.**

---

## 🌐 Deploying to Vercel

Sahaara is pre-configured for automated continuous deployment on **Vercel**:

1. Push your branch to GitHub and import the repository into **Vercel**.
2. Vercel automatically honors `vercel.json` and builds via Bun into the `.vercel/output` format.
3. In **Project Settings → Environment Variables**, configure the server-side credentials listed in the [Environment Variables Reference](#-environment-variables-reference).
4. Add your Vercel deployment domain to your Supabase project's **Auth → URL Configuration → Redirect URLs** (e.g. `https://your-deployment.vercel.app/**`).
5. Deploy!

---

<div align="center">
  <p><strong>Sahaara — Intelligent Senior Care. Connected Health. Compassionate Support.</strong></p>
  <p><em>Built with care for seniors and the dedicated teams who support them.</em></p>
</div>
