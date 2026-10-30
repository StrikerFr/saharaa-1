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
const CREATOR_ID = "b6a65591-e29c-4f63-acf4-b3ccdc977fdb"; // Aryan garg profile

interface RoutineItemDef {
  category: "medication" | "meal" | "sleep" | "exercise" | "hydration" | "vitals" | "hygiene" | "other";
  title: string;
  details: string;
  time: string; // HH:MM:SS
  days: number[];
  doneNote?: string;
  sourceDefault?: "family" | "coordinator" | "care_worker" | "senior" | "ai_assist";
  skipChance?: number; // probability of missed/skipped on past days
}

interface SeniorPlan {
  id: string;
  name: string;
  code: string;
  items: RoutineItemDef[];
}

const SENIOR_PLANS: SeniorPlan[] = [
  {
    id: "ec348932-ca90-5457-aa49-34355dedd3c7",
    name: "Leela Sharma",
    code: "S2C23-0001",
    items: [
      {
        category: "hydration",
        title: "Morning Warm Water & Lemon",
        details: "1 glass warm water with a slice of lemon before breakfast",
        time: "07:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Finished 250ml warm water comfortably",
        sourceDefault: "family",
        skipChance: 0.05,
      },
      {
        category: "medication",
        title: "Amlodipine 5mg (BP)",
        details: "Take with water immediately after breakfast",
        time: "08:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken with breakfast, no stomach discomfort",
        sourceDefault: "family",
        skipChance: 0.02,
      },
      {
        category: "vitals",
        title: "Morning Blood Pressure Check",
        details: "Rest 5 mins before using digital arm cuff. Goal: systolic < 135",
        time: "08:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "BP logged: 126/78 mmHg, pulse 70 bpm",
        sourceDefault: "care_worker",
        skipChance: 0.05,
      },
      {
        category: "meal",
        title: "Breakfast: Warm Oats / Idli",
        details: "Soft, low sodium breakfast with almonds and tea",
        time: "09:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Ate full bowl of oatmeal and 1 cup of chai",
        sourceDefault: "family",
        skipChance: 0.02,
      },
      {
        category: "exercise",
        title: "Gentle Hallway Walk & Ankle Stretches",
        details: "15 minutes slow walk using cane, followed by ankle rotations",
        time: "10:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Completed 15 minutes walk with caregiver assistance",
        sourceDefault: "care_worker",
        skipChance: 0.1,
      },
      {
        category: "meal",
        title: "Lunch: Moong Dal Khichdi & Curd",
        details: "Soft consistency, easy digestion with homemade curd",
        time: "13:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Finished lunch with 1 katori curd",
        sourceDefault: "family",
        skipChance: 0.02,
      },
      {
        category: "sleep",
        title: "Afternoon Rest / Nap",
        details: "Elevate feet slightly on cushion for 45 minutes",
        time: "14:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Slept peacefully for 40 minutes",
        sourceDefault: "family",
        skipChance: 0.08,
      },
      {
        category: "hydration",
        title: "Evening Coconut Water / Herbal Tea",
        details: "Hydration check before sunset",
        time: "17:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Fresh tender coconut water consumed",
        sourceDefault: "coordinator",
        skipChance: 0.05,
      },
      {
        category: "meal",
        title: "Dinner: Vegetable Soup & Phulka",
        details: "Light dinner, low salt, completed before 8 PM",
        time: "19:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Finished warm soup and 1 soft phulka",
        sourceDefault: "family",
        skipChance: 0.03,
      },
      {
        category: "medication",
        title: "Atorvastatin 10mg & Calcium",
        details: "Night dose with half glass warm milk",
        time: "20:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken on schedule with warm milk",
        sourceDefault: "family",
        skipChance: 0.03,
      },
    ],
  },
  {
    id: "f04d791b-755d-5b24-8776-a62354e4de37",
    name: "Ramesh Patel",
    code: "S2C23-0002",
    items: [
      {
        category: "vitals",
        title: "Fasting Blood Sugar Check",
        details: "Record fasting capillary glucose before any tea or food",
        time: "07:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Fasting sugar: 114 mg/dL",
        sourceDefault: "senior",
        skipChance: 0.12,
      },
      {
        category: "medication",
        title: "Thyronorm 50mcg (Thyroid)",
        details: "Empty stomach with plain water. Wait 30 mins before tea",
        time: "07:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken on empty stomach",
        sourceDefault: "senior",
        skipChance: 0.05,
      },
      {
        category: "meal",
        title: "Diabetic Breakfast: Besan Cheela & Sprouts",
        details: "High protein, low glycemic index, unsweetened tea",
        time: "08:15:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Good appetite, ate full breakfast",
        sourceDefault: "care_worker",
        skipChance: 0.05,
      },
      {
        category: "medication",
        title: "Metformin 500mg (Morning)",
        details: "Take immediately after breakfast",
        time: "08:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken with breakfast plate",
        sourceDefault: "care_worker",
        skipChance: 0.08,
      },
      {
        category: "hydration",
        title: "Mid-Morning Water Bottle Check",
        details: "Ensure at least 500ml water consumed by mid-morning",
        time: "11:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Refilled water flask, drank 400ml",
        sourceDefault: "ai_assist",
        skipChance: 0.15,
      },
      {
        category: "meal",
        title: "Lunch: Multigrain Roti, Dal & Lauki",
        details: "Balanced portion with fiber and green sabzi",
        time: "13:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Finished lunch completely",
        sourceDefault: "care_worker",
        skipChance: 0.05,
      },
      {
        category: "exercise",
        title: "Balcony Stroll & Breathing Exercise",
        details: "15 minutes slow walk, 10 deep diaphragmatic breaths",
        time: "16:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Walked 12 minutes in shaded balcony",
        sourceDefault: "care_worker",
        skipChance: 0.22, // fatigue leads to occasional skipped exercise
      },
      {
        category: "meal",
        title: "Dinner: Steamed Roti & Paneer Bhurji",
        details: "High protein light dinner",
        time: "20:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Ate light dinner",
        sourceDefault: "care_worker",
        skipChance: 0.05,
      },
      {
        category: "medication",
        title: "Metformin 500mg (Night)",
        details: "Post-dinner blood sugar stabilization dose",
        time: "20:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken after dinner",
        sourceDefault: "care_worker",
        skipChance: 0.08,
      },
    ],
  },
  {
    id: "b618f90d-095e-58d3-8b84-6ac16dafcfe3",
    name: "Meera Joshi",
    code: "S2C23-0003",
    items: [
      {
        category: "hygiene",
        title: "Morning Warm Bath & Joint Warmup",
        details: "Warm water bath assisted by caregiver to relieve knee stiffness",
        time: "07:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Warm water soak relieved morning joint stiffness",
        sourceDefault: "care_worker",
        skipChance: 0.05,
      },
      {
        category: "meal",
        title: "Breakfast: Vegetable Poha & Boiled Egg",
        details: "Fresh warm poha with peanuts and protein",
        time: "08:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Good appetite, finished breakfast",
        sourceDefault: "family",
        skipChance: 0.03,
      },
      {
        category: "medication",
        title: "Paracetamol 650mg & Glucosamine",
        details: "Post-breakfast joint relief tablet",
        time: "09:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken with water after breakfast",
        sourceDefault: "family",
        skipChance: 0.04,
      },
      {
        category: "exercise",
        title: "Knee Isometric Physio Stretches",
        details: "10 seated leg extensions and quad contractions on couch",
        time: "10:15:00",
        days: [1, 2, 3, 4, 5], // weekdays
        doneNote: "Completed full physiotherapy routine with physiotherapist",
        sourceDefault: "care_worker",
        skipChance: 0.1,
      },
      {
        category: "hydration",
        title: "Midday Spiced Buttermilk (Chaas)",
        details: "Low salt digestive hydration, rich in probiotics",
        time: "12:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Enjoyed 1 glass of fresh buttermilk",
        sourceDefault: "family",
        skipChance: 0.08,
      },
      {
        category: "meal",
        title: "Lunch: Phulka, Yellow Dal & Tinda",
        details: "Soft phulka with ghee, turmeric yellow dal",
        time: "13:15:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Ate 2 phulkas and dal",
        sourceDefault: "family",
        skipChance: 0.04,
      },
      {
        category: "sleep",
        title: "Afternoon Rest with Knee Elevation",
        details: "Cushion under knees, 45 minutes resting",
        time: "14:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Rested comfortably for 50 minutes",
        sourceDefault: "family",
        skipChance: 0.05,
      },
      {
        category: "exercise",
        title: "Verandah Walker Walk (10 mins)",
        details: "Supported walk with four-wheel walker in courtyard",
        time: "17:15:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Walked 8 minutes with walker, no dizziness",
        sourceDefault: "coordinator",
        skipChance: 0.12,
      },
      {
        category: "meal",
        title: "Dinner: Vegetable Dalia (Broken Wheat)",
        details: "Warm and easy to digest, with carrots and peas",
        time: "19:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Finished warm bowl of dalia",
        sourceDefault: "family",
        skipChance: 0.03,
      },
      {
        category: "medication",
        title: "Calcium + Vitamin D3 Tablet",
        details: "Take with half glass of warm turmeric milk",
        time: "21:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken before bed with warm milk",
        sourceDefault: "family",
        skipChance: 0.04,
      },
    ],
  },
  {
    id: "d93cf59e-228c-5bc1-92b7-6680782a0b03",
    name: "Arjun Verma",
    code: "S2C23-0004",
    items: [
      {
        category: "vitals",
        title: "Morning Pulse & BP Check",
        details: "Sit upright, check resting heart rate and blood pressure",
        time: "07:15:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "BP: 122/76 mmHg, Pulse: 64 bpm",
        sourceDefault: "senior",
        skipChance: 0.05,
      },
      {
        category: "medication",
        title: "Metoprolol 25mg & Aspirin 75mg",
        details: "Cardiac protection dose. Take with breakfast",
        time: "08:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Taken with morning breakfast",
        sourceDefault: "family",
        skipChance: 0.02,
      },
      {
        category: "meal",
        title: "Breakfast: Rolled Oats with Walnuts & Apple",
        details: "Heart-healthy breakfast, no added sugar, dash of cinnamon",
        time: "08:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Ate full bowl with walnuts and green tea",
        sourceDefault: "family",
        skipChance: 0.02,
      },
      {
        category: "exercise",
        title: "Park Walking (20 mins)",
        details: "Brisk continuous walking in neighborhood park",
        time: "09:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Completed 20 mins brisk walk, felt energetic",
        sourceDefault: "senior",
        skipChance: 0.08,
      },
      {
        category: "hydration",
        title: "Midday Water Intake Tracking",
        details: "Fluid intake tracking — target 1.8 Liters across the day",
        time: "11:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Drank 500ml water bottle",
        sourceDefault: "ai_assist",
        skipChance: 0.07,
      },
      {
        category: "meal",
        title: "Lunch: Steamed Rice, Palak Dal & Fish/Paneer",
        details: "Lean protein, leafy greens, low sodium",
        time: "13:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Nutritious lunch finished",
        sourceDefault: "family",
        skipChance: 0.03,
      },
      {
        category: "sleep",
        title: "Post-Lunch Rest in Recliner",
        details: "Quiet rest or reading for 40 minutes",
        time: "14:15:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Rested in recliner for 35 mins",
        sourceDefault: "senior",
        skipChance: 0.06,
      },
      {
        category: "vitals",
        title: "Evening SpO2 & Heart Rate Check",
        details: "Pulse oximeter check on index finger",
        time: "17:00:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "SpO2: 98%, Heart Rate: 68 bpm",
        sourceDefault: "coordinator",
        skipChance: 0.05,
      },
      {
        category: "meal",
        title: "Dinner: Multigrain Roti & Mixed Veggies",
        details: "Early heart-healthy dinner, low oil",
        time: "19:30:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Light dinner finished before 8 PM",
        sourceDefault: "family",
        skipChance: 0.03,
      },
      {
        category: "medication",
        title: "Rosuvastatin 10mg & Ramipril 2.5mg",
        details: "Take at bedtime with water",
        time: "20:45:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        doneNote: "Night cardiac medications taken on time",
        sourceDefault: "family",
        skipChance: 0.02,
      },
    ],
  },
];

function getDatesList(daysBack: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

async function run() {
  console.log("Starting synthetic daily routine seeding for 4 seniors...");

  const dates = getDatesList(7); // past 7 days up to today
  const today = dates[dates.length - 1]!;
  console.log(`Generating logs from ${dates[0]} to ${today} (${dates.length} days)`);

  let totalItemsCreated = 0;
  let totalLogsCreated = 0;

  for (const plan of SENIOR_PLANS) {
    console.log(`\n--- Seeding Senior: ${plan.name} (${plan.code}) ---`);

    // 1. Create Routine Items
    const insertedItems: Array<{ id: string; def: RoutineItemDef }> = [];

    for (const def of plan.items) {
      const { data: item, error: itemErr } = await supabase
        .from("care_routine_items")
        .insert({
          senior_id: plan.id,
          org_id: ORG_ID,
          category: def.category,
          title: def.title,
          details: def.details,
          scheduled_time: def.time,
          days_of_week: def.days,
          active: true,
          created_by: CREATOR_ID,
        })
        .select("id")
        .single();

      if (itemErr || !item) {
        console.error(`Failed to insert item ${def.title}:`, itemErr);
        continue;
      }

      totalItemsCreated++;
      insertedItems.push({ id: item.id, def });
    }

    console.log(`Created ${insertedItems.length} routine items for ${plan.name}`);

    // 2. Generate Daily Logs for the last 7 days + today
    const logsToInsert: Array<{
      item_id: string;
      senior_id: string;
      org_id: string;
      local_date: string;
      status: "done" | "missed" | "skipped" | "pending";
      done_at: string | null;
      note: string | null;
      source: string;
      recorded_by: string;
      client_request_id: string;
      created_at: string;
    }> = [];

    for (const date of dates) {
      const weekday = isoWeekday(date);
      const isToday = date === today;

      for (const { id: itemId, def } of insertedItems) {
        if (!def.days.includes(weekday)) continue; // Not scheduled for this weekday

        const [schedH, schedM] = def.time.split(":").map(Number) as [number, number];

        if (isToday) {
          // For today (2026-10-29 local time is morning ~11:45 AM):
          // Morning items (schedH <= 11) are marked 'done'
          // Items after 11:30 AM are left pending so the user can demonstrate interactively!
          if (schedH <= 11) {
            const doneTime = new Date(`${date}T${String(schedH).padStart(2, "0")}:${String(schedM + 5).padStart(2, "0")}:00+05:30`);
            logsToInsert.push({
              item_id: itemId,
              senior_id: plan.id,
              org_id: ORG_ID,
              local_date: date,
              status: "done",
              done_at: doneTime.toISOString(),
              note: def.doneNote || null,
              source: def.sourceDefault || "family",
              recorded_by: CREATOR_ID,
              client_request_id: randomUUID(),
              created_at: doneTime.toISOString(),
            });
          }
          // Items after 11:00 remain pending (no log row, or pending status)
        } else {
          // Past days: realistic distribution based on skipChance
          const rand = Math.random();
          const isMissed = rand < (def.skipChance || 0.05);
          const isSkipped = !isMissed && rand < (def.skipChance || 0.05) * 1.5;

          if (isMissed) {
            logsToInsert.push({
              item_id: itemId,
              senior_id: plan.id,
              org_id: ORG_ID,
              local_date: date,
              status: "missed",
              done_at: null,
              note: "Missed scheduled window",
              source: "coordinator",
              recorded_by: CREATOR_ID,
              client_request_id: randomUUID(),
              created_at: `${date}T22:00:00+05:30`,
            });
          } else if (isSkipped) {
            logsToInsert.push({
              item_id: itemId,
              senior_id: plan.id,
              org_id: ORG_ID,
              local_date: date,
              status: "skipped",
              done_at: null,
              note: "Intentionally deferred per senior preference",
              source: def.sourceDefault || "family",
              recorded_by: CREATOR_ID,
              client_request_id: randomUUID(),
              created_at: `${date}T18:00:00+05:30`,
            });
          } else {
            // Done
            const variance = Math.floor(Math.random() * 20) - 5; // -5 to +15 mins
            const actualMinute = Math.max(0, Math.min(59, schedM + variance));
            const doneTime = new Date(`${date}T${String(schedH).padStart(2, "0")}:${String(actualMinute).padStart(2, "0")}:00+05:30`);

            logsToInsert.push({
              item_id: itemId,
              senior_id: plan.id,
              org_id: ORG_ID,
              local_date: date,
              status: "done",
              done_at: doneTime.toISOString(),
              note: def.doneNote || null,
              source: def.sourceDefault || "family",
              recorded_by: CREATOR_ID,
              client_request_id: randomUUID(),
              created_at: doneTime.toISOString(),
            });
          }
        }
      }
    }

    // Batch insert logs
    console.log(`Inserting ${logsToInsert.length} logs for ${plan.name}...`);
    const BATCH_SIZE = 50;
    for (let i = 0; i < logsToInsert.length; i += BATCH_SIZE) {
      const batch = logsToInsert.slice(i, i + BATCH_SIZE);
      const { error: logErr } = await supabase.from("care_routine_logs").insert(batch);
      if (logErr) {
        console.error(`Error inserting logs batch for ${plan.name}:`, logErr);
      } else {
        totalLogsCreated += batch.length;
      }
    }
  }

  console.log(`\n Seeding Complete!`);
  console.log(`Total Routine Items created: ${totalItemsCreated}`);
  console.log(`Total Routine Logs created: ${totalLogsCreated}`);
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

