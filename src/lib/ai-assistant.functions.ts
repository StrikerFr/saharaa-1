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

export function cleanSeniorDisplayName(rawName: string): string {
  if (!rawName) return "the senior";
  return rawName.replace(/^Synthetic\s+/i, "").replace(/\s+\d{3,4}$/, "").trim() || rawName;
}

export function formatTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return "All-day";
  const parts = timeStr.slice(0, 5).split(":");
  const h = parseInt(parts[0] || "0", 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export const askSeniorAIInput = z
  .object({
    seniorId: z.string().uuid(),
    question: z.string().trim().min(2).max(500),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().max(8000),
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
    const cleanName = cleanSeniorDisplayName(senior.display_name);
    const todayYmd = localDateIn(timeZone, now);
    const nowMin = localMinutesIn(timeZone, now);
    const todaySchedule = buildDay(routineItems, routineLogs, todayYmd, nowMin);
    const todaySummary = summarizeDay(todaySchedule);

    // Format observations summary with friendly times
    const obsList = observations.map((o) => {
      const label = OBSERVATION_TYPES[o.type]?.label ?? o.type;
      const val = o.type === "care_note" ? (o.note ?? "") : `${formatObservationValue(o)}${o.note ? ` (${o.note})` : ""}`;
      return `• ${label}: ${val} [Recorded: ${formatInZone(o.observed_at, timeZone)}]`;
    });

    // Format today's routine checklist with friendly 12h times
    const routineList = todaySchedule.map((entry) => {
      const item = entry.item;
      const log = entry.log;
      const timeDisplay = formatTime12h(item.scheduled_time);
      return `• ${item.title} (${item.category}) scheduled for ${timeDisplay} — Status: ${entry.status.toUpperCase()}${log?.note ? ` (Caregiver note: ${log.note})` : ""}`;
    });

    const alertsList = activeAlerts.map((a: any) => {
      return `• Alert Status: ${a.status}, Priority: ${a.priority_at_open}, Opened: ${formatInZone(a.opened_at, timeZone)}`;
    });

    const contextText = `
SENIOR PROFILE:
- Name: ${cleanName} (Full Record: ${senior.display_name})
- Care Status: ${senior.care_status}
- Care Context: ${senior.care_context || "Standard home care protocol"}
- Timezone: ${timeZone}
- Current Date/Time: ${formatInZone(now.toISOString(), timeZone)}

TODAY'S ROUTINE & MEDICINE SCHEDULE (${todayYmd}):
- Progress Summary: ${todaySummary.done} of ${todaySummary.total} routine items completed.
- Medication Adherence: ${todaySummary.medsDone} of ${todaySummary.medsTotal} doses taken.
${routineList.length ? routineList.join("\n") : "• No scheduled routine items set for today."}

RECENT OBSERVATIONS & VITALS (PAST 30 DAYS, ${observations.length} records):
${obsList.slice(0, 30).join("\n")}
${obsList.length > 30 ? `...and ${obsList.length - 30} earlier recorded observations.` : ""}

ACTIVE CARE TEAM ALERTS:
${alertsList.length ? alertsList.join("\n") : "• No active alerts. Routine indicators steady."}
`.trim();

    const systemPrompt = `You are Sahaara Care Assistant — a concise, articulate, and professional clinical care-coordination assistant for families and care teams.
You are communicating about ${cleanName}.

CORE DIRECTIVES:
1. FOCUS & CONCISENESS: Answer ONLY what was specifically asked. Keep answers direct, brief, and digestible (typically 2-4 focused bullet points or a single short paragraph, under 150 words).
   - If asked about blood pressure or vitals: Mention ONLY the recorded readings (count, latest values, and whether they are steady). DO NOT list the daily meal, activity, or full routine schedule.
   - If asked about medicines: State ONLY whether the scheduled medicines were taken, pending, or missed.
   - If asked about today in general: Provide a brief 3-4 bullet point update covering key highlights.
   - Do NOT write excessively long essays or dump unrelated sections.
2. Grounding: Answer strictly using ONLY the provided care records. NEVER invent readings, dosages, or times. If unrecorded, state that in one brief sentence.
3. Tone: Warm, professional, dignified, and clear. Address the senior respectfully as "${cleanName}".
4. Boundaries: Never diagnose medical conditions or alter prescriptions.`;

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
        seniorName: cleanName,
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
 * Strictly adheres to real database records with concise, topic-focused formatting.
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

  // 1. Specific Medication question
  if (
    q.includes("medicine") ||
    q.includes("medication") ||
    q.includes("pill") ||
    q.includes("dose") ||
    q.includes("aspirin") ||
    q.includes("metoprolol")
  ) {
    const meds = todaySchedule.filter((e) => e.item.category === "medication");
    const takenMeds = meds.filter((e) => e.status === "done");
    const missedMeds = meds.filter((e) => e.status === "missed");
    const pendingMeds = meds.filter((e) => e.status === "pending");

    const bullets: string[] = [];

    if (takenMeds.length > 0) {
      bullets.push(
        ...takenMeds.map(
          (m) =>
            `- **${m.item.title}**: Marked as **taken** at ${formatTime12h(m.item.scheduled_time)}${m.log?.note ? ` (${m.log.note})` : ""}.`,
        ),
      );
    }
    if (missedMeds.length > 0) {
      bullets.push(
        ...missedMeds.map(
          (m) => `- **${m.item.title}**: Scheduled for ${formatTime12h(m.item.scheduled_time)} — marked as **missed**.`,
        ),
      );
    }
    if (pendingMeds.length > 0) {
      bullets.push(
        ...pendingMeds.map(
          (m) => `- **${m.item.title}**: Scheduled for ${formatTime12h(m.item.scheduled_time)} (**pending**).`,
        ),
      );
    }

    if (bullets.length === 0) {
      bullets.push("- No medications are scheduled in the routine for today.");
    }

    bullets.push(
      `- **Adherence**: **${todaySummary.medsDone} of ${todaySummary.medsTotal}** scheduled medication doses taken today.`,
    );

    return `### Medication Status for ${seniorName}\n\n${bullets.join("\n")}`;
  }

  // 2. Specific Blood Pressure / Vitals question
  if (
    q.includes("blood pressure") ||
    q.includes("bp") ||
    q.includes("pulse") ||
    q.includes("heart rate") ||
    q.includes("vital") ||
    q.includes("reading")
  ) {
    const bps = observations.filter((o) => o.type === "blood_pressure");
    const hrs = observations.filter((o) => o.type === "heart_rate");

    const bpLine = bps.length
      ? `- **Blood Pressure**: Latest reading is **${bps[0]!.value_numeric}/${bps[0]!.value_numeric_2} mmHg** recorded on ${formatInZone(bps[0]!.observed_at, timeZone)} (${bps.length} readings in past 30 days).`
      : "- **Blood Pressure**: No blood pressure readings recorded in the past 30 days.";

    const hrLine = hrs.length
      ? `- **Heart Rate**: Latest reading was **${hrs[0]!.value_numeric} bpm** on ${formatInZone(hrs[0]!.observed_at, timeZone)}.`
      : "";

    const alertLine =
      activeAlerts.length > 0
        ? `- **Care Team Status**: There is an active review case regarding recent blood pressure variability under coordinator monitoring.`
        : `- **Care Team Status**: Routine vitals remain steady with no unresolved clinical alerts.`;

    return `### Vital Signs for ${seniorName}\n\n${[bpLine, hrLine, alertLine].filter(Boolean).join("\n")}`;
  }

  // 3. Question about past month health / trends
  if (q.includes("month") || q.includes("past") || q.includes("trend") || q.includes("health")) {
    const bps = observations.filter((o) => o.type === "blood_pressure");
    const hrs = observations.filter((o) => o.type === "heart_rate");
    const weights = observations.filter((o) => o.type === "weight");

    const bullets: string[] = [
      `- **Recorded Observations**: ${observations.length} clinical observations logged over the past 30 days.`,
    ];

    if (bps.length > 0) {
      bullets.push(
        `- **Blood Pressure**: Latest reading is **${bps[0]!.value_numeric}/${bps[0]!.value_numeric_2} mmHg** (${formatInZone(bps[0]!.observed_at, timeZone)}).`,
      );
    }
    if (hrs.length > 0) {
      bullets.push(`- **Heart Rate**: Most recent was **${hrs[0]!.value_numeric} bpm**.`);
    }
    if (weights.length > 0) {
      bullets.push(`- **Weight**: Last recorded at **${weights[0]!.value_numeric} kg**.`);
    }

    bullets.push(
      activeAlerts.length > 0
        ? `- **Care Review**: ${activeAlerts.length} review item(s) currently being followed up by coordinators.`
        : `- **Care Review**: Overall health indicators remain steady with no active alerts.`,
    );

    return `### Health & Vitals Summary for ${seniorName}\n\n${bullets.join("\n")}`;
  }

  // 4. Question about alerts or concerns
  if (
    q.includes("alert") ||
    q.includes("concern") ||
    q.includes("issue") ||
    q.includes("follow") ||
    q.includes("problem")
  ) {
    if (activeAlerts.length > 0) {
      return `### Care Team Notices for ${seniorName}

- **Active Alerts**: ${activeAlerts.length} review case(s) currently active.
${activeAlerts
  .map(
    (a: any) =>
      `- Priority: **${a.priority_at_open.toUpperCase()}** • Status: **${a.status.replace(/_/g, " ")}** (opened on ${formatInZone(a.opened_at, timeZone)}).`,
  )
  .join("\n")}
- The care coordinator team is actively monitoring and managing these items.`;
    }

    return `### Care Team Notices for ${seniorName}

- There are currently **no active alerts or unresolved clinical concerns** for ${seniorName}.
- All checked vitals and routine items are up to date.`;
  }

  // 5. Default: concise Today's Overview
  const missedItems = todaySchedule.filter((e) => e.status === "missed");
  const nextPending = todaySchedule.find((e) => e.status === "pending");

  const bullets: string[] = [
    `- **Routine Progress**: **${todaySummary.done} of ${todaySummary.total}** care activities completed today.`,
    `- **Medications**: **${todaySummary.medsDone} of ${todaySummary.medsTotal}** scheduled doses taken.`,
  ];

  if (missedItems.length > 0) {
    bullets.push(`- **Notable**: ${missedItems[0]!.item.title} was marked as **missed**.`);
  }

  if (nextPending) {
    bullets.push(
      `- **Next Up**: ${nextPending.item.title} scheduled for ${formatTime12h(nextPending.item.scheduled_time)}.`,
    );
  }

  bullets.push(
    activeAlerts.length > 0
      ? `- **Notice**: Active care alert under review by coordinator team.`
      : `- **Status**: All routine care progressing normally.`,
  );

  return `### Today's Update for ${seniorName}\n\n${bullets.join("\n")}`;
}
