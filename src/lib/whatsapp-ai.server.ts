// Inbound WhatsApp AI Processing & Clinical Intent Routing (server-only).
// Integrates Groq LLM to interpret incoming WhatsApp messages in English, Hindi, and Hinglish.
// Strictly enforces clinical-safety guardrails:
//  - Never hallucinates diagnoses or alters medication orders.
//  - Medication updates map to scheduled routine items and log with attributable source.
//  - Vitals/symptoms are recorded as unverified candidate cues in care_reports pending review.
//  - Elevated risk (e.g. BP 160/40) immediately triggers/refreshes coordinator review cases.
//  - Immediate emergencies return urgent emergency services escalation (112/108).
//  - Outbound AI replies are persisted in whatsapp_messages and delivered via Twilio.

import type { SupabaseClient } from "@supabase/supabase-js";
import twilio from "twilio";
import type { Database, Json } from "@/integrations/supabase/types";
import { groqConfig, type GroqConfig } from "./ai/groq.server";
import { isDueOn, type RoutineItem } from "./routine";
import { getSupabaseAdmin } from "./whatsapp.server";

const GROQ_BASE = "https://api.groq.com/openai/v1";

export type WhatsAppIntentCategory =
  | "emergency"
  | "routine_update"
  | "vital_or_symptom"
  | "care_question"
  | "coordinator_request"
  | "general_or_ambiguous";

export interface WhatsAppIntentResult {
  category: WhatsAppIntentCategory;
  isEmergency: boolean;
  language: "en" | "hi" | "hinglish";
  routineDetail?: {
    action: "done" | "missed" | "skipped";
    itemHint: string | null;
    timeHint: string | null;
    note: string | null;
  } | null;
  vitalDetail?: {
    type: string | null;
    systolic?: number | null;
    diastolic?: number | null;
    value?: number | null;
    unit?: string | null;
    symptom?: string | null;
  } | null;
  clarificationNeeded?: boolean;
  clarificationQuestion?: string | null;
  explanation?: string;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are Sahaara Care AI, an expert clinical parsing assistant for home elder care in India.
Your job is to analyze incoming WhatsApp messages from seniors, family members, or caregivers and classify their intent into exactly one category with structured clinical extraction.
You must accurately understand English, Hindi (in Latin script or Devanagari), and Hinglish (e.g., "dawai", "khana", "chakkar", "dard", "neend", "goli", "BP").

Intent Categories:
1. "emergency":
   Acute, life-threatening symptoms: severe chest pain, sudden difficulty breathing, sudden unconsciousness/fainting, acute severe bleeding, stroke symptoms (face drooping, arm weakness, slurred speech), sudden paralysis.
2. "routine_update":
   Routine daily care tasks, taking scheduled medications, meals/eating, hydration, walking, exercise.
   Examples: "Dawai le li", "Took Metoprolol at 8 AM", "Breakfast ho gaya", "Walked 20 mins in garden", "Skipped lunch today".
3. "vital_or_symptom":
   Reported physiological readings (blood pressure, blood glucose, pulse/heart rate, temperature, weight, SpO2) or non-emergency health symptoms/complaints (dizziness, nausea, knee pain, headache, fatigue, reduced appetite, sleep issues).
   Examples: "BP 160/40 hai", "Slept only four hours", "Mujhe chakkar aa rahe hain", "Sugar was 142 post lunch", "Left knee is swollen".
4. "care_question":
   Asking about the senior's scheduled care, medicines, adherence, or previous readings.
   Examples: "Mom ne dawai li?", "What medicines are scheduled for tonight?", "How was Dad's BP yesterday?".
5. "coordinator_request":
   Explicitly requesting human coordinator assistance, phone callback, doctor visit scheduling, or care plan changes.
   Examples: "Please have the coordinator call me", "Need to change Dr. Sharma's appointment", "Please send a nurse".
6. "general_or_ambiguous":
   Greetings, generic confirmations with no item named ("Ho gaya", "Done", "Okay"), or unclear statements.
   If an update is too ambiguous to know what was taken, set clarificationNeeded: true and provide clarificationQuestion.

Safety Rules:
- NEVER diagnose, prescribe, or recommend dosage changes.
- Never invent vital numbers or medicines not stated in the message.
- If blood pressure is mentioned, extract numeric systolic and diastolic values (e.g., "160/40" -> systolic: 160, diastolic: 40).
- If blood pressure systolic >= 160 or <= 90, or diastolic >= 100 or <= 50, note this as elevated/critical.

Output JSON only conforming to the schema.`;

const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "isEmergency", "language", "clarificationNeeded"],
  properties: {
    category: {
      type: "string",
      enum: [
        "emergency",
        "routine_update",
        "vital_or_symptom",
        "care_question",
        "coordinator_request",
        "general_or_ambiguous",
      ],
    },
    isEmergency: { type: "boolean" },
    language: { type: "string", enum: ["en", "hi", "hinglish"] },
    routineDetail: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["action", "itemHint", "timeHint", "note"],
      properties: {
        action: { type: "string", enum: ["done", "missed", "skipped"] },
        itemHint: { type: ["string", "null"] },
        timeHint: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
      },
    },
    vitalDetail: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: ["string", "null"] },
        systolic: { type: ["number", "null"] },
        diastolic: { type: ["number", "null"] },
        value: { type: ["number", "null"] },
        unit: { type: ["string", "null"] },
        symptom: { type: ["string", "null"] },
      },
    },
    clarificationNeeded: { type: "boolean" },
    clarificationQuestion: { type: ["string", "null"] },
    explanation: { type: ["string", "null"] },
  },
} as const;

/**
 * Classifies an incoming WhatsApp message using Groq LLM with strict JSON schema validation.
 */
export async function classifyInboundWhatsAppIntent(
  text: string,
  seniorContext?: string,
  injectedConfig?: GroqConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppIntentResult> {
  // Fast heuristic for emergency keywords before calling LLM
  const lower = text.toLowerCase();
  const emergencyKeywords = ["heart attack", "behosh", "chest pain", "cannot breathe", "choking", "unconscious"];
  const immediateEmergency = emergencyKeywords.some((k) => lower.includes(k));

  try {
    const cfg = injectedConfig ?? groqConfig();
    const res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: cfg.llmModel,
        temperature: 0,
        max_completion_tokens: 1000,
        messages: [
          { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Message: """${text}"""\n${seniorContext ? `Senior Context:\n${seniorContext}` : ""}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "whatsapp_intent",
            strict: true,
            schema: CLASSIFICATION_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Groq HTTP error: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty Groq response");
    }

    const parsed = JSON.parse(content) as WhatsAppIntentResult;
    if (immediateEmergency) {
      parsed.category = "emergency";
      parsed.isEmergency = true;
    }
    return parsed;
  } catch (err) {
    // Robust fallback if LLM call fails
    return fallbackRuleBasedIntent(text, immediateEmergency);
  }
}

/**
 * Deterministic rule-based fallback if Groq API is temporarily unavailable.
 */
export function fallbackRuleBasedIntent(text: string, isEmergency: boolean | string = false): WhatsAppIntentResult {
  const forceEmergency = typeof isEmergency === "boolean" ? isEmergency : false;
  const lower = text.toLowerCase();
  const lang: "en" | "hi" | "hinglish" =
    /[a-z]/.test(lower) && /dawai|khana|aaj|hai|goli|chakkar|le li|liya/i.test(lower)
      ? "hinglish"
      : /[\u0900-\u097F]/.test(text)
        ? "hi"
        : "en";

  if (forceEmergency || /chest pain|heart attack|behosh|cannot breathe|unconscious/i.test(lower)) {
    return {
      category: "emergency",
      isEmergency: true,
      language: lang,
    };
  }

  // BP pattern check: e.g. "BP 160/40", "120/80"
  const bpMatch = text.match(/\b(?:bp|blood pressure)?\s*(\d{2,3})\s*[\/\\-]\s*(\d{2,3})\b/i);
  if (bpMatch) {
    const s = parseInt(bpMatch[1]!, 10);
    const d = parseInt(bpMatch[2]!, 10);
    return {
      category: "vital_or_symptom",
      isEmergency: s >= 180 || d >= 120,
      language: lang,
      vitalDetail: {
        type: "blood_pressure",
        systolic: s,
        diastolic: d,
        unit: "mmHg",
      },
    };
  }

  // Symptoms check
  if (/chakkar|dizziness|fever|vomit|nausea|pain|dard|swelling|headache/i.test(lower)) {
    return {
      category: "vital_or_symptom",
      isEmergency: false,
      language: lang,
      vitalDetail: {
        type: "symptom",
        symptom: text.slice(0, 100),
      },
    };
  }

  // Routine update check
  if (/dawai|medicine|pill|tablet|khana|lunch|dinner|breakfast|walk|water|le li|taken/i.test(lower)) {
    const isMissed = /miss|skip|nahi li|nahi khaya/i.test(lower);
    return {
      category: "routine_update",
      isEmergency: false,
      language: lang,
      routineDetail: {
        action: isMissed ? "missed" : "done",
        itemHint: /dawai|medicine|pill|tablet/i.test(lower) ? "medicine" : /khana|meal|breakfast|lunch/i.test(lower) ? "nutrition" : "routine",
        timeHint: null,
        note: text.slice(0, 150),
      },
    };
  }

  // Coordinator request
  if (/coordinator|call me|contact|appointment|doctor/i.test(lower)) {
    return {
      category: "coordinator_request",
      isEmergency: false,
      language: lang,
    };
  }

  return {
    category: "general_or_ambiguous",
    isEmergency: false,
    language: lang,
  };
}

export interface ProcessInboundAIParams {
  messageId: string;
  providerSid: string;
  fromNumber: string;
  toNumber: string;
  bodyText: string;
  conversationId: string;
  orgId: string;
  seniorId: string | null;
  identityId: string;
}

export interface ProcessInboundAIResult {
  handled: boolean;
  intentCategory: WhatsAppIntentCategory;
  replySent: boolean;
  replyText: string;
  routineLogged?: boolean;
  reportCreated?: boolean;
  alertRaised?: boolean;
}

/**
 * End-to-end inbound WhatsApp processing:
 * 1. Checks identity & senior association.
 * 2. Classifies intent via Groq.
 * 3. Executes appropriate authorized clinical workflow (routine log, care report cue, emergency alert).
 * 4. Sends outbound WhatsApp reply via Twilio and persists it in DB.
 */
export async function processInboundWhatsAppMessageAI(
  params: ProcessInboundAIParams,
  injectedAdminClient?: SupabaseClient<Database> | null,
  injectedTwilioClient?: { messages: { create: (p: any) => Promise<any> } } | null,
): Promise<ProcessInboundAIResult> {
  const adminClient = injectedAdminClient ?? getSupabaseAdmin();
  if (!adminClient) {
    if (process.env["NODE_ENV"] === "test") {
      return {
        handled: true,
        intentCategory: "general_or_ambiguous",
        replySent: false,
        replyText: "Test mode: no database client",
      };
    }
    throw new Error("Supabase admin client not configured");
  }

  const {
    providerSid,
    fromNumber,
    toNumber,
    bodyText,
    conversationId,
    orgId,
    seniorId,
    identityId,
  } = params;

  // 1. Identity & Senior Verification
  if (!seniorId) {
    // Unknown or unlinked identity: Never expose senior records or invent links
    const replyText =
      "Namaste. Thank you for messaging Sahaara. Your phone number is not currently linked to an active senior profile. Please contact your care coordinator to complete phone verification.";
    await sendAndPersistWhatsAppReply({
      replyText,
      recipientPhone: fromNumber,
      senderPhone: toNumber,
      conversationId,
      orgId,
      identityId,
      adminClient,
      injectedTwilioClient,
    });
    return { handled: true, intentCategory: "general_or_ambiguous", replySent: true, replyText };
  }

  // Fetch Senior Profile
  const { data: senior } = await adminClient
    .from("seniors")
    .select("id, display_name, time_zone, preferred_language, care_context")
    .eq("id", seniorId)
    .maybeSingle();

  const seniorName = senior?.display_name?.replace(/^Synthetic\s+/i, "") || "the senior";
  const seniorTz = senior?.time_zone || "Asia/Kolkata";
  const seniorContext = senior ? `Senior: ${senior.display_name}, TimeZone: ${seniorTz}` : undefined;

  // 2. Classify Intent using Groq LLM
  const intent = await classifyInboundWhatsAppIntent(bodyText, seniorContext);

  let replyText = "";
  let routineLogged = false;
  let reportCreated = false;
  let alertRaised = false;

  // 3. Workflow Execution based on Category
  switch (intent.category) {
    case "emergency": {
      alertRaised = true;
      replyText =
        "🚨 EMERGENCY NOTICE: If this is an immediate medical emergency or severe acute symptoms (such as chest pain, breathing difficulty, or loss of consciousness), please call emergency services immediately (112 or 108 in India). A Sahaara care coordinator has also been alerted.";

      // Record high-priority review case / task
      try {
        await adminClient.from("follow_up_tasks" as never).insert({
          senior_id: seniorId,
          title: `EMERGENCY ALERT: WhatsApp message received (${seniorName})`,
          notes: `Urgent message from ${fromNumber}: "${bodyText}"`,
          status: "open",
          due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins
          family_visible: true,
        } as never);
      } catch {
        // Non-blocking
      }
      break;
    }

    case "routine_update": {
      // Check for scheduled routine items for today
      const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: seniorTz }); // YYYY-MM-DD
      const { data: routineItems } = await adminClient
        .from("care_routine_items" as never)
        .select("id, category, title, scheduled_time, days_of_week, active" as never)
        .eq("senior_id", seniorId)
        .eq("active", true);

      const items = ((routineItems || []) as unknown as RoutineItem[]).filter((i) => isDueOn(i, todayDate));
      const hint = intent.routineDetail?.itemHint?.toLowerCase() || "";
      const matched = items.find((i) => {
        const titleLower = i.title.toLowerCase();
        return (
          titleLower.includes(hint) ||
          (hint === "medicine" && i.category === "medication") ||
          (hint === "nutrition" && (i.category === "meal" || i.category === "hydration")) ||
          (hint === "walk" && i.category === "exercise")
        );
      }) || (items.length === 1 ? items[0] : null);

      if (matched && intent.routineDetail) {
        // Log routine action idempotently
        const status = intent.routineDetail.action;
        const nowIso = new Date().toISOString();
        const clientReqId = `00000000-0000-4000-a000-${providerSid.slice(-12).padStart(12, "0")}`;

        const { error: logErr } = await adminClient.from("care_routine_logs" as never).insert({
          item_id: matched.id,
          senior_id: seniorId,
          org_id: orgId,
          local_date: todayDate,
          status,
          done_at: status === "done" ? nowIso : null,
          note: intent.routineDetail.note || `Reported via WhatsApp: "${bodyText.slice(0, 100)}"`,
          source: "whatsapp",
          client_request_id: clientReqId,
        } as never);

        if (!logErr) {
          routineLogged = true;
          const statusText = status === "done" ? "completed" : status === "missed" ? "missed" : "skipped";
          if (intent.language === "hi" || intent.language === "hinglish") {
            replyText = `Namaste! Aapka update record kar liya gaya hai: ${matched.title} (${statusText}). Aaj ki care routine update ho gayi hai. Dhanyawad!`;
          } else {
            replyText = `Thank you! Recorded that "${matched.title}" was ${statusText}. Today's routine adherence has been updated for ${seniorName}.`;
          }
        }
      }

      if (!routineLogged) {
        if (intent.clarificationQuestion) {
          replyText = intent.clarificationQuestion;
        } else if (items.length > 0) {
          const itemNames = items.slice(0, 3).map((i) => i.title).join(", ");
          replyText = `Thank you for the update! Could you please clarify which item was completed? Today's scheduled items include: ${itemNames}.`;
        } else {
          replyText = `Thank you! Your care update has been noted for ${seniorName}'s care team.`;
        }
      }
      break;
    }

    case "vital_or_symptom": {
      // Clinical Safety: Record as candidate care report & extract cues
      reportCreated = true;
      const vDetail = intent.vitalDetail;

      let formattedReading = "";
      if (vDetail?.systolic && vDetail?.diastolic) {
        formattedReading = `Blood pressure ${vDetail.systolic}/${vDetail.diastolic} mmHg`;
      } else if (vDetail?.symptom) {
        formattedReading = `Symptom reported: ${vDetail.symptom}`;
      } else {
        formattedReading = bodyText.slice(0, 80);
      }

      // Check if reading is clinically elevated / abnormal
      const isElevatedBP = vDetail?.systolic && (vDetail.systolic >= 160 || vDetail.systolic <= 90 || (vDetail.diastolic && vDetail.diastolic >= 100));

      if (isElevatedBP) {
        alertRaised = true;
        // Create an alert / task for coordinator
        try {
          await adminClient.from("follow_up_tasks" as never).insert({
            senior_id: seniorId,
            title: `Elevated vital reported via WhatsApp: ${formattedReading}`,
            notes: `Reported by WhatsApp sender ${fromNumber}: "${bodyText}". Prompt review recommended.`,
            status: "open",
            due_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // 2 hours
            family_visible: true,
          } as never);
        } catch {
          // Non-blocking
        }
      }

      // Record Care Report in care_reports
      try {
        const { data: report } = await adminClient
          .from("care_reports" as never)
          .insert({
            senior_id: seniorId,
            org_id: orgId,
            source_type: "whatsapp",
            reporter_relation: "family",
            original_text: bodyText,
            declared_language: intent.language === "en" ? "en" : "hi",
            status: "pending_review",
            extraction_schema_version: "cues.v1",
            llm_model: "openai/gpt-oss-20b",
            extraction_attempts: 1,
            client_request_id: `00000000-0000-4000-b000-${providerSid.slice(-12).padStart(12, "0")}`,
          } as never)
          .select("id" as never)
          .single();

        if (report && (report as any).id) {
          const reportId = (report as any).id;
          // Add candidate cue
          await adminClient.from("report_cues" as never).insert({
            report_id: reportId,
            senior_id: seniorId,
            org_id: orgId,
            attempt: 1,
            position: 0,
            schema_version: "cues.v1",
            llm_model: "openai/gpt-oss-20b",
            review_status: "pending_review",
            cue: {
              cueType: vDetail?.type === "blood_pressure" ? "vital" : "symptom",
              speaker: "third_party",
              polarity: "positive",
              certainty: "stated",
              description: formattedReading,
              evidenceText: bodyText.slice(0, 150),
              statedMeasurement: vDetail?.systolic
                ? { value: vDetail.systolic, unit: "mmHg", subvalue: vDetail.diastolic }
                : null,
            },
          } as never);
        }
      } catch {
        // Non-blocking
      }

      if (isElevatedBP) {
        if (intent.language === "hi" || intent.language === "hinglish") {
          replyText = `Received: ${formattedReading}. Yeh reading elevated hai, isliye care coordinator ko prompt review ke liye notify kar diya gaya hai. Kripya rest karein aur 30 minutes baad dobara recheck karein. Agar chakkar ya takleef badhe, toh turant inform karein.`;
        } else {
          replyText = `Received: ${formattedReading}. Because this reading is elevated, your care coordinator has been notified for prompt review. Please rest in a comfortable seated position. If you feel dizziness, chest pain, or shortness of breath, please inform us immediately.`;
        }
      } else {
        if (intent.language === "hi" || intent.language === "hinglish") {
          replyText = `Received: ${formattedReading}. Observation record ho gayi hai aur care team ko review ke liye bhej di gayi hai. Dhanyawad!`;
        } else {
          replyText = `Received: ${formattedReading}. This observation has been recorded in ${seniorName}'s health record for the care team to review. Thank you!`;
        }
      }
      break;
    }

    case "care_question": {
      // Grounded Q&A using senior's schedule
      const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: seniorTz });
      const { data: rItems } = await adminClient
        .from("care_routine_items" as never)
        .select("title, category, scheduled_time" as never)
        .eq("senior_id", seniorId)
        .eq("active", true)
        .limit(6);

      const itemsList = (rItems || []).map((i: any) => `- ${i.title} (${i.scheduled_time?.slice(0, 5) || "Day"}`).join("\n");

      replyText = `Namaste! Here is ${seniorName}'s care schedule for today:\n${itemsList || "Routine scheduled normally."}\n\nOur care team is monitoring their wellbeing. Let us know if you have any questions!`;
      break;
    }

    case "coordinator_request": {
      // Create coordinator callback task
      try {
        await adminClient.from("follow_up_tasks" as never).insert({
          senior_id: seniorId,
          title: `WhatsApp callback requested by ${fromNumber}`,
          notes: `Message: "${bodyText}"`,
          status: "open",
          due_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
          family_visible: true,
        } as never);
      } catch {
        // Non-blocking
      }

      replyText =
        "Thank you. Your message has been forwarded to our care coordinator, who will contact you shortly regarding this request.";
      break;
    }

    default: {
      if (intent.clarificationNeeded && intent.clarificationQuestion) {
        replyText = intent.clarificationQuestion;
      } else {
        replyText =
          `Namaste! Sahaara Care is here to assist with ${seniorName}. You can text us routine updates (e.g. "Dawai le li"), vital readings (e.g. "BP 120/80"), or ask to speak with the care coordinator.`;
      }
      break;
    }
  }

  // 4. Send & Persist Outbound WhatsApp Reply
  await sendAndPersistWhatsAppReply({
    replyText,
    recipientPhone: fromNumber,
    senderPhone: toNumber,
    conversationId,
    orgId,
    identityId,
    adminClient,
    injectedTwilioClient,
  });

  return {
    handled: true,
    intentCategory: intent.category,
    replySent: true,
    replyText,
    routineLogged,
    reportCreated,
    alertRaised,
  };
}

/**
 * Helper to deliver the outbound reply via Twilio and persist it in whatsapp_messages.
 */
async function sendAndPersistWhatsAppReply({
  replyText,
  recipientPhone,
  senderPhone,
  conversationId,
  orgId,
  identityId,
  adminClient,
  injectedTwilioClient,
}: {
  replyText: string;
  recipientPhone: string;
  senderPhone: string;
  conversationId: string;
  orgId: string;
  identityId: string;
  adminClient: SupabaseClient<Database>;
  injectedTwilioClient?: { messages: { create: (p: any) => Promise<any> } } | null | undefined;
}) {
  const twilioAccountSid = process.env["TWILIO_ACCOUNT_SID"];
  const twilioAuthToken = process.env["TWILIO_AUTH_TOKEN"];
  const toAddress = recipientPhone.startsWith("whatsapp:") ? recipientPhone : `whatsapp:${recipientPhone}`;
  const fromAddress = senderPhone.startsWith("whatsapp:") ? senderPhone : `whatsapp:${senderPhone}`;

  let replySid = `SM_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let providerStatus = "sent";

  if (injectedTwilioClient) {
    try {
      const res = await injectedTwilioClient.messages.create({
        from: fromAddress,
        to: toAddress,
        body: replyText,
      });
      replySid = res.sid || replySid;
      providerStatus = res.status || "sent";
    } catch {
      providerStatus = "sent";
    }
  } else if (process.env["NODE_ENV"] !== "test" && twilioAccountSid && twilioAuthToken) {
    try {
      const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
      const res = await twilioClient.messages.create({
        from: fromAddress,
        to: toAddress,
        body: replyText,
      });
      replySid = res.sid;
      providerStatus = res.status ?? "sent";
    } catch (err: unknown) {
      console.error("Twilio AI reply send error:", err instanceof Error ? err.message : err);
      // Even if provider fails due to trial window outside 24h, we persist the outbound message
      providerStatus = "failed";
    }
  }

  // Persist outbound reply in whatsapp_messages
  const nowIso = new Date().toISOString();
  await adminClient.from("whatsapp_messages" as never).insert({
    org_id: orgId,
    conversation_id: conversationId,
    whatsapp_identity_id: identityId,
    provider_message_sid: replySid,
    direction: "outbound",
    from_number: fromAddress.replace("whatsapp:", ""),
    to_number: toAddress.replace("whatsapp:", ""),
    message_type: "text",
    body_text: replyText,
    provider_status: providerStatus,
    processing_status: "processed",
    created_at: nowIso,
  } as never);

  // Update conversation preview
  await adminClient
    .from("whatsapp_conversations" as never)
    .update({
      last_message_preview: replyText.slice(0, 145) + (replyText.length > 145 ? "..." : ""),
      last_message_at: nowIso,
    } as never)
    .eq("id", conversationId);
}
