import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jiqvjuquxrsglradhhpo.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG_ID = "7e570000-0000-4000-8000-0000000000a1";
const CREATOR_ID = "b6a65591-e29c-4f63-acf4-b3ccdc977fdb";

interface AlertDef {
  seniorId: string;
  seniorName: string;
  priority: "prompt_review_recommended" | "review_recommended" | "review_suggested";
  changedDomains: string[];
  alertReason: string;
  observations: Array<{
    type: string;
    value_numeric?: number | null;
    value_numeric_2?: number | null;
    value_text?: string | null;
    unit?: string | null;
    note?: string | null;
    observed_at: string;
  }>;
}

const ALERTS_TO_SEED: AlertDef[] = [
  {
    seniorId: "f04d791b-755d-5b24-8776-a62354e4de37", // Synthetic Leela 0002
    seniorName: "Synthetic Leela 0002",
    priority: "prompt_review_recommended",
    changedDomains: ["medication"],
    alertReason: "Critical: Multiple missed doses of Metformin & irregular fasting glucose",
    observations: [
      {
        type: "medication_event",
        value_text: "missed",
        note: "Metformin 500mg evening dose missed. Senior reported dizziness and fatigue.",
        observed_at: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      },
      {
        type: "medication_event",
        value_text: "missed",
        note: "Metformin 500mg evening dose missed yesterday as well.",
        observed_at: new Date(Date.now() - 38 * 3600 * 1000).toISOString(),
      },
    ],
  },
  {
    seniorId: "d93cf59e-228c-5bc1-92b7-6680782a0b03", // Synthetic Arjun 0004
    seniorName: "Synthetic Arjun 0004",
    priority: "prompt_review_recommended",
    changedDomains: ["blood_pressure", "medication"],
    alertReason: "High Priority: Elevated blood pressure (158/96 mmHg) & missed Metoprolol beta-blocker",
    observations: [
      {
        type: "blood_pressure",
        value_numeric: 158,
        value_numeric_2: 96,
        unit: "mmHg",
        note: "Morning systolic spike observed during home check. Senior feels headache.",
        observed_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      },
      {
        type: "medication_event",
        value_text: "missed",
        note: "Morning Metoprolol 25mg missed due to nausea.",
        observed_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      },
    ],
  },
  {
    seniorId: "b618f90d-095e-58d3-8b84-6ac16dafcfe3", // Synthetic Meera 0003
    seniorName: "Synthetic Meera 0003",
    priority: "review_recommended",
    changedDomains: ["mobility"],
    alertReason: "Mobility decline: Increased knee pain, requiring full physical assistance to stand",
    observations: [
      {
        type: "mobility",
        value_text: "needs_assistance",
        note: "Unable to rise from bed independently. Severe left knee stiffness.",
        observed_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
      },
      {
        type: "care_note",
        note: "Family reports Mrs. Meera refused to walk in the corridor today due to sharp knee pain.",
        observed_at: new Date(Date.now() - 17 * 3600 * 1000).toISOString(),
      },
    ],
  },
  {
    seniorId: "ec348932-ca90-5457-aa49-34355dedd3c7", // Synthetic Leela 0001
    seniorName: "Synthetic Leela 0001",
    priority: "review_suggested",
    changedDomains: ["hydration"],
    alertReason: "Hydration check: Fluid intake reduced below target over consecutive days",
    observations: [
      {
        type: "hydration",
        value_text: "reduced",
        note: "Refused evening coconut water and herbal tea. Complains of low thirst.",
        observed_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      },
    ],
  },
];

async function seedAlerts() {
  console.log("Seeding clinical observations, risk assessments, and active review case alerts...");

  for (const item of ALERTS_TO_SEED) {
    console.log(`\nProcessing Senior: ${item.seniorName}...`);

    // 1. Insert recent observations
    for (const obs of item.observations) {
      const { error: obsErr } = await supabase.from("observations").insert({
        senior_id: item.seniorId,
        type: obs.type,
        value_numeric: obs.value_numeric ?? null,
        value_numeric_2: obs.value_numeric_2 ?? null,
        value_text: obs.value_text ?? null,
        unit: obs.unit ?? null,
        note: obs.note ?? null,
        observed_at: obs.observed_at,
        source: "manual_entry",
        verification: "unverified",
        client_request_id: randomUUID(),
      });
      if (obsErr) {
        console.error("Failed to insert observation:", obsErr);
      }
    }

    // 2. Insert Risk Assessment
    const assessmentResult = {
      seniorId: item.seniorId,
      priority: item.priority,
      changedDomains: item.changedDomains,
      referenceTime: new Date().toISOString(),
      dataQuality: { status: "adequate", flags: [], assessableRules: 8, totalRules: 10 },
      evidence: item.changedDomains.map((domain) => ({
        domain,
        ruleId: `shift.${domain}`,
        ruleVersion: "1.0",
        title: domain === "medication" ? "Medication Missed / Non-Adherence Shift" : `${domain} Shift Detected`,
        category: "change_from_reference",
        status: "detected",
        contributes: true,
        observationTypes: [domain === "medication" ? "medication_event" : domain],
        window: { start: new Date(Date.now() - 14 * 86400000).toISOString(), end: new Date().toISOString() },
        referenceWindow: null,
        inputObservationIds: [],
        values: {},
        method: "robust_comparison",
        direction: "increase",
        explanation: item.alertReason,
        limitations: [],
      })),
    };

    const { data: assessment, error: assessErr } = await supabase
      .from("risk_assessments")
      .insert({
        senior_id: item.seniorId,
        org_id: ORG_ID,
        reference_time: new Date().toISOString(),
        engine_version: "sahaara-risk-engine/1.0.0",
        ruleset_version: "ruleset/2026-10.1",
        config_fingerprint: "cfg-0123456789abcdef",
        input_digest: `in-${item.seniorId.replace(/-/g, "").slice(0, 16)}`,
        priority: item.priority,
        data_quality: "adequate",
        changed_domains: item.changedDomains,
        result: assessmentResult,
        created_by: CREATOR_ID,
      })
      .select("id")
      .single();

    if (assessErr || !assessment) {
      console.error("Failed to insert assessment:", assessErr);
      continue;
    }

    console.log(`Created assessment ${assessment.id} (${item.priority})`);

    // 3. Upsert active Review Case (Alert)
    // Check if an active case exists
    const { data: existingCase } = await supabase
      .from("review_cases")
      .select("id")
      .eq("senior_id", item.seniorId)
      .in("status", ["needs_review", "in_review", "follow_up_required"])
      .maybeSingle();

    if (existingCase) {
      console.log(`Updating existing review case ${existingCase.id}...`);
      await supabase
        .from("review_cases")
        .update({
          latest_assessment_id: assessment.id,
          priority_at_open: item.priority,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCase.id);
    } else {
      console.log(`Opening new review case for ${item.seniorName}...`);
      const { data: newCase, error: caseErr } = await supabase
        .from("review_cases")
        .insert({
          senior_id: item.seniorId,
          org_id: ORG_ID,
          status: "needs_review",
          priority_at_open: item.priority,
          opened_by_assessment_id: assessment.id,
          latest_assessment_id: assessment.id,
          opened_by: CREATOR_ID,
        })
        .select("id")
        .single();

      if (caseErr || !newCase) {
        console.error("Failed to insert review case:", caseErr);
        continue;
      }

      // Add event log
      await supabase.from("review_case_events").insert({
        case_id: newCase.id,
        org_id: ORG_ID,
        from_status: null,
        to_status: "needs_review",
        actor_id: CREATOR_ID,
        reason: item.alertReason,
      });

      console.log(`Successfully opened review case ${newCase.id}`);
    }
  }

  console.log("\nAll 4 seniors now have active alert review cases in Supabase!");
}

seedAlerts().catch(console.error);
