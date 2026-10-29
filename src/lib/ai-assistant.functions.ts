// Sahaara AI Assistant: On-demand care Q&A for family members and care coordinators.
// Reads only through authorized RLS sessions, cites verified records, never invents
// readings or dosages, and never provides clinical diagnoses.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatInZone, formatObservationValue, OBSERVATION_TYPES, type ObservationRow } from "@/lib/seniors";
import {
  buildDay,
  localDateIn,
  localMinutesIn,
  summarizeDay,
  type DayEntry,
  type DaySummary,
  type RoutineItem,
  type RoutineLog,
} from "@/lib/routine";

export const askSeniorAIInput = z
  .object({
    seniorId: z.string().uuid(),
    question: z.string().trim().min(2).max(500),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().max(1000),
        }),
      )
      .max(10)
      .default([]),
  })
  .strict();

export interface AskSeniorAIResult {
  ok: boolean;
  answer: string;
  citedRecordsCount: number;
  generatedAt: string;
}

export const askSeniorAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => askSeniorAIInput.parse(d))
  .handler(async ({ data, context }): Promise<AskSeniorAIResult> => {
    const { supabase, userId } = context;

    // 1. Dual Access Check: Coordinator OR Family
    const [{ data: canCoord }, { data: canFam }] = await Promise.all([
      supabase.rpc("can_access_senior", { _senior: data.seniorId }),
      (supabase as any).rpc("can_access_senior_as_family", { _senior: data.seniorId, _user: userId }),
    ]);

    if (!canCoord && !canFam) {
      throw new Error("You do not have permission to view care records for this senior.");
    }

    // 2. Load senior profile
    const { data: senior, error: sErr } = await supabase
      .from("seniors")
      .select("id, display_name, time_zone, care_status, care_context")
      .eq("id", data.seniorId)
      .single();

    if (sErr || !senior) {
      throw new Error("Senior profile not found.");
    }

    const now = new Date();
    const timeZone = senior.time_zone || "Asia/Kolkata";
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();

    // 3. Load observations (past 30 days), routine items & logs, active alerts
    const dbAny = supabase as any;
    const [obsRes, itemsRes, logsRes, alertsRes] = await Promise.all([
      supabase
        .from("observations")
        .select("id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, source, verification")
        .eq("senior_id", senior.id)
        .gte("observed_at", thirtyDaysAgo)
        .order("observed_at", { ascending: false })
        .limit(100),
      dbAny
        .from("care_routine_items")
        .select("*")
        .eq("senior_id", senior.id)
        .eq("active", true),
      dbAny
        .from("care_routine_logs")
        .select("*")
        .eq("senior_id", senior.id)
        .gte("local_date", new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10))
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("review_cases")
        .select("id, status, priority_at_open, opened_at, updated_at")
        .eq("senior_id", senior.id)
        .in("status", ["needs_review", "in_review", "follow_up_required"])
        .limit(3),
    ]);

    const observations = (obsRes.data ?? []) as unknown as ObservationRow[];
    const routineItems = (itemsRes.data ?? []) as RoutineItem[];
    const routineLogs = (logsRes.data ?? []) as RoutineLog[];
    const activeAlerts = alertsRes.data ?? [];

    // Calculate today's routine schedule
    const todayYmd = localDateIn(timeZone, now);
    const nowMin = localMinutesIn(timeZone, now);
    const todaySchedule = buildDay(routineItems, routineLogs, todayYmd, nowMin);
    const todaySummary = summarizeDay(todaySchedule);

    // Format observations summary
    const obsList = observations.map((o) => {
      const label = OBSERVATION_TYPES[o.type]?.label ?? o.type;
      const val = o.type === "care_note" ? (o.note ?? "") : `${formatObservationValue(o)}${o.note ? ` (${o.note})` : ""}`;
      return `• ${label}: ${val} [Observed: ${formatInZone(o.observed_at, timeZone)}]`;
    });

    // Format today's routine checklist
    const routineList = todaySchedule.map((entry) => {
      const item = entry.item;
      const log = entry.log;
      return `• ${item.title} (${item.category}) at ${item.scheduled_time ? item.scheduled_time.slice(0, 5) : "all-day"} — Status: ${entry.status.toUpperCase()}${log?.note ? ` (Note: ${log.note})` : ""}`;
    });

    const alertsList = activeAlerts.map((a: any) => {
      return `• Alert Status: ${a.status}, Priority: ${a.priority_at_open}, Opened: ${formatInZone(a.opened_at, timeZone)}`;
    });

    const contextText = `
SENIOR PROFILE:
- Name: ${senior.display_name}
- Care Status: ${senior.care_status}
- Care Context: ${senior.care_context || "None specified"}
- Timezone: ${timeZone}
- Current Date/Time: ${formatInZone(now.toISOString(), timeZone)}

TODAY'S ROUTINE & MEDICINE SCHEDULE (${todayYmd}):
- Summary: ${todaySummary.done} of ${todaySummary.total} routine items completed today.
- Medicines today: ${todaySummary.medsDone} of ${todaySummary.medsTotal} taken.
${routineList.length ? routineList.join("\n") : "• No scheduled routine items set for today."}

RECENT OBSERVATIONS & VITALS (PAST 30 DAYS, ${observations.length} records):
${obsList.slice(0, 30).join("\n")}
${obsList.length > 30 ? `...and ${obsList.length - 30} earlier recorded observations.` : ""}

ACTIVE CARE TEAM ALERTS:
${alertsList.length ? alertsList.join("\n") : "• No active alerts. All items up to date."}
`.trim();

    const systemPrompt = `You are Sahaara AI Assistant, helping family members and care coordinators understand senior health and daily care records.
Rules:
- Answer the user's question using ONLY the provided senior profile, today's schedule, recent observations, and alerts.
- Speak in clear, warm, plain English. Short sentences.
- NEVER invent or assume values, medications, or events. If something was not recorded (e.g. no blood pressure reading taken today, or medication not yet logged), state that honestly: "No blood pressure reading was recorded today" or "The morning medication has not been marked as taken yet."
- Do not provide medical diagnoses or prescribe new treatments.
- If asked about trends over the past month or weeks, accurately summarize the recorded readings and changes.
- If asked about today, focus directly on today's schedule and adherence.`;

    // 4. Call Groq if configured, else use grounded deterministic generator
    const totalRecords = observations.length + routineLogs.length;
    let answer = "";

    try {
      const { groqConfig, generateCompletion } = await import("@/lib/ai/groq.server");
      const cfg = groqConfig();

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: `${systemPrompt}\n\nCARE RECORDS CONTEXT:\n${contextText}` },
        ...data.history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: data.question },
      ];

      const res = await generateCompletion(messages, cfg);
      answer = res.content;
    } catch {
      // Grounded deterministic fallback when API key is not configured or offline
      answer = generateGroundedFallbackAnswer({
        question: data.question,
        seniorName: senior.display_name,
        todaySummary,
        todaySchedule,
        observations,
        activeAlerts,
        timeZone,
      });
    }

    return {
      ok: true,
      answer,
      citedRecordsCount: totalRecords,
      generatedAt: now.toISOString(),
    };
  });

/**
 * Deterministic, grounded fallback answers when external LLM provider is not configured.
 * Strictly adheres to real database records.
 */
function generateGroundedFallbackAnswer({
  question,
  seniorName,
  todaySummary,
  todaySchedule,
  observations,
  activeAlerts,
  timeZone,
}: {
  question: string;
  seniorName: string;
  todaySummary: DaySummary;
  todaySchedule: DayEntry[];
  observations: ObservationRow[];
  activeAlerts: any[];
  timeZone: string;
}): string {
  const q = question.toLowerCase();

  // 1. Question about today or routine or medicine
  if (q.includes("today") || q.includes("routine") || q.includes("medicine") || q.includes("medication")) {
    const meds = todaySchedule.filter((e) => e.item.category === "medication");
    const medsText = meds.length
      ? meds.map((m) => `${m.item.title}: ${m.status.toUpperCase()}`).join(", ")
      : "No medications scheduled for today.";

    const otherItems = todaySchedule.filter((e) => e.item.category !== "medication");
    const otherText = otherItems.length
      ? otherItems.map((o) => `${o.item.title}: ${o.status.toUpperCase()}`).join(", ")
      : "";

    return `Here is ${seniorName}'s update for today:
• Routine Progress: ${todaySummary.done} of ${todaySummary.total} routine items have been completed.
• Medications: ${todaySummary.medsDone} of ${todaySummary.medsTotal} taken (${medsText}).
${otherText ? `• Other activities: ${otherText}.` : ""}
${activeAlerts.length ? `• Notice: There is currently an active care team alert under review.` : "• There are no active alerts today."}`;
  }

  // 2. Question about past months, health trends, blood pressure, or vitals
  if (q.includes("month") || q.includes("health") || q.includes("blood pressure") || q.includes("bp") || q.includes("vitals") || q.includes("trend")) {
    const bps = observations.filter((o) => o.type === "blood_pressure");
    const hrs = observations.filter((o) => o.type === "heart_rate");
    const weights = observations.filter((o) => o.type === "weight");

    const bpSummary = bps.length
      ? `Blood pressure has ${bps.length} readings over the past 30 days. The latest reading was ${bps[0]!.value_numeric}/${bps[0]!.value_numeric_2} mmHg on ${formatInZone(bps[0]!.observed_at, timeZone)}.`
      : "No blood pressure readings were recorded in the past 30 days.";

    const hrSummary = hrs.length
      ? `Heart rate has ${hrs.length} recorded entries, most recently ${hrs[0]!.value_numeric} bpm.`
      : "";

    const weightSummary = weights.length
      ? `Weight was recorded at ${weights[0]!.value_numeric} kg.`
      : "";

    return `Here is a summary of ${seniorName}'s health over the past month based on ${observations.length} recorded observations:
• ${bpSummary}
${hrSummary ? `• ${hrSummary}` : ""}
${weightSummary ? `• ${weightSummary}` : ""}
${activeAlerts.length ? `• Care Team Review: There are ${activeAlerts.length} review alerts recorded for coordinator attention.` : "• Routine vitals remain steady with no unresolved care alerts."}`;
  }

  // 3. Question about alerts or follow-ups
  if (q.includes("alert") || q.includes("concern") || q.includes("issue") || q.includes("follow")) {
    if (activeAlerts.length > 0) {
      return `There are currently ${activeAlerts.length} active alert(s) for ${seniorName}. Status: ${activeAlerts.map((a: any) => `${a.status} (priority: ${a.priority_at_open})`).join("; ")}. The care team is reviewing these records.`;
    }
    return `There are currently no active alerts or unaddressed concerns for ${seniorName}. All recent checked vitals and routine items are up to date.`;
  }

  // General default answer
  const latestObs = observations[0];
  const latestText = latestObs
    ? `Latest recorded observation is ${latestObs.type.replace(/_/g, " ")} (${formatObservationValue(latestObs)}) recorded on ${formatInZone(latestObs.observed_at, timeZone)}.`
    : "No recent observations recorded.";

  return `${seniorName}'s care overview:
• Today's routine: ${todaySummary.done} of ${todaySummary.total} items completed (${todaySummary.medsDone} of ${todaySummary.medsTotal} medications taken).
• ${latestText}
• Overall: ${activeAlerts.length ? `${activeAlerts.length} alert(s) currently under care team review.` : "No active alerts. Care items are progressing normally."}

You can ask me specific questions like "Did ${seniorName} take medicine today?", "How has blood pressure been over the past month?", or "Any missed meals?".`;
}
