/**
 * Wearable Health Telemetry & Fire-Boltt Legacy Integration Module
 *
 * Provides:
 * - Domain types and Zod validation schemas for wearable metrics
 * - Physiological threshold definitions and anomaly detection
 * - Hourly rollup calculations and clinical summary generators
 * - JSON import parsing and schema verification
 * - Deterministic, realistic 24-hour telemetry generator
 */

import { z } from "zod";

export type ConnectionStatus = "connected" | "disconnected" | "syncing" | "standby";
export type StressCategory = "relaxed" | "low" | "normal" | "mild" | "elevated" | "high";
export type AlertSeverity = "critical" | "warning" | "attention" | "info";
export type AlertStatus = "new" | "acknowledged" | "under_review" | "resolved";
export type WearableMetricType =
  | "heart_rate"
  | "spo2"
  | "blood_pressure"
  | "stress"
  | "sleep"
  | "steps"
  | "calories"
  | "distance";

export interface WearableDevice {
  id: string;
  seniorId: string;
  deviceName: string;
  deviceModel: string;
  macAddress: string;
  connectionStatus: ConnectionStatus;
  batteryLevel: number;
  firmwareVersion: string;
  lastSyncAt: string;
  images: string[];
}

export interface WearableReading {
  id?: string | undefined;
  timestamp: string;
  heartRate: number;
  spo2: number;
  stressScore: number;
  stressCategory: StressCategory;
  bpSystolic: number;
  bpDiastolic: number;
  steps: number;
  calories: number;
  distanceKm: number;
  sleepMinutes?: number | undefined;
  sleepDeepMinutes?: number | undefined;
  sleepLightMinutes?: number | undefined;
  sleepRemMinutes?: number | undefined;
  source: string;
}

export interface HourlyHealthReport {
  id: string;
  hourLabel: string;
  timestamp: string;
  heartRate: number;
  spo2: number;
  bpSystolic: number;
  bpDiastolic: number;
  stressScore: number;
  stressCategory: StressCategory;
  steps: number;
  calories: number;
  distanceKm: number;
  unusualVariation: string | null;
  summary: string;
  activityLevel: "resting" | "light" | "active" | "sedentary";
}

export interface WearableAlert {
  id: string;
  seniorId: string;
  metric: "heart_rate" | "spo2" | "blood_pressure" | "stress" | "sleep" | "inactivity";
  title: string;
  severity: AlertSeverity;
  status: AlertStatus;
  currentValue: string;
  previousValue?: string | undefined;
  reason: string;
  recommendation: string;
  detectedAt: string;
  resolvedAt?: string | null | undefined;
  resolvedBy?: string | null | undefined;
  notes?: string | null | undefined;
}

/** Standard Physiological Normal Reference Ranges */
export const PHYSIOLOGICAL_RANGES = {
  heartRate: {
    minNormal: 60,
    maxNormal: 100,
    unit: "BPM",
    criticalHigh: 120,
    criticalLow: 50,
    label: "Heart Rate",
  },
  spo2: {
    minNormal: 95,
    maxNormal: 100,
    unit: "%",
    criticalLow: 91,
    warningLow: 94,
    label: "Blood Oxygen",
  },
  bloodPressure: {
    targetSystolic: 120,
    targetDiastolic: 80,
    stage1Systolic: 130,
    stage1Diastolic: 85,
    stage2Systolic: 140,
    stage2Diastolic: 90,
    criticalSystolic: 160,
    unit: "mmHg",
    label: "Blood Pressure",
  },
  stress: {
    relaxedMax: 29,
    normalMax: 59,
    mildMax: 79,
    unit: "Score (0-100)",
    label: "Stress Level",
  },
  sleep: {
    recommendedHours: 7,
    unit: "hours",
    label: "Sleep Duration",
  },
  steps: {
    dailyTarget: 6000,
    unit: "steps",
    label: "Daily Steps",
  },
} as const;

/** Fire-Boltt Legacy Specification Profile */
export const FIRE_BOLTT_LEGACY_INFO = {
  name: "Fire-Boltt Legacy",
  subtitle: "Stainless Steel Edition · Bluetooth LE 5.2",
  display: "1.43\" AMOLED Display, 466×466 px High Res",
  batteryCapacity: "330 mAh Lithium-Polymer (~7 days standby)",
  sensors: [
    "Biometric Optical PPG Heart Rate Sensor",
    "Pulse Oximeter SpO2 Red & Infrared Sensor",
    "3-Axis High Precision Accelerometer",
    "Continuous HRV Stress Sensor",
  ],
  images: [
    "/wearables/fire-boltt-legacy-1.jpg",
    "/wearables/fire-boltt-legacy-2.jpg",
  ],
};

/** Zod Schema for Importing Health Telemetry */
export const wearableReadingSchema = z.object({
  timestamp: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  heartRate: z.number().int().min(30).max(250),
  spo2: z.number().int().min(70).max(100),
  stressScore: z.number().int().min(0).max(100).default(25),
  stressCategory: z
    .enum(["relaxed", "low", "normal", "mild", "elevated", "high"])
    .default("normal"),
  bpSystolic: z.number().int().min(60).max(250).default(120),
  bpDiastolic: z.number().int().min(40).max(150).default(80),
  steps: z.number().int().min(0).default(0),
  calories: z.number().int().min(0).default(0),
  distanceKm: z.number().min(0).default(0),
  sleepMinutes: z.number().int().min(0).optional(),
  sleepDeepMinutes: z.number().int().min(0).optional(),
  sleepLightMinutes: z.number().int().min(0).optional(),
  sleepRemMinutes: z.number().int().min(0).optional(),
  source: z.string().default("fire_boltt_legacy"),
});

export const wearableImportPayloadSchema = z.object({
  seniorId: z.string().uuid().optional(),
  deviceModel: z.string().default("Fire-Boltt Legacy"),
  exportedAt: z.string().optional(),
  readings: z.array(wearableReadingSchema).min(1, "At least one reading is required"),
});

export type WearableImportPayload = z.infer<typeof wearableImportPayloadSchema>;

/** Derive stress category from raw score */
export function deriveStressCategory(score: number): StressCategory {
  if (score <= 25) return "relaxed";
  if (score <= 45) return "low";
  if (score <= 65) return "normal";
  if (score <= 80) return "mild";
  if (score <= 90) return "elevated";
  return "high";
}

/** Check a reading against physiological rules to flag anomalies */
export function detectReadingAnomalies(
  current: WearableReading,
  previous?: WearableReading | null,
): Omit<WearableAlert, "id" | "seniorId">[] {
  const anomalies: Omit<WearableAlert, "id" | "seniorId">[] = [];

  // SpO2 rules
  if (current.spo2 < PHYSIOLOGICAL_RANGES.spo2.criticalLow) {
    anomalies.push({
      metric: "spo2",
      title: "Critically Low SpO2 Detected",
      severity: "critical",
      status: "new",
      currentValue: `${current.spo2}%`,
      previousValue: previous ? `${previous.spo2}%` : undefined,
      reason: `Blood oxygen saturation dropped to ${current.spo2}%, which is below the critical threshold of 92%.`,
      recommendation: "Immediate coordinator follow-up required. Confirm senior's breathing comfort and verify with calibrated pulse oximeter.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  } else if (current.spo2 < PHYSIOLOGICAL_RANGES.spo2.warningLow) {
    anomalies.push({
      metric: "spo2",
      title: "Mild Desaturation (SpO2 93-94%)",
      severity: "warning",
      status: "new",
      currentValue: `${current.spo2}%`,
      previousValue: previous ? `${previous.spo2}%` : undefined,
      reason: `SpO2 reading of ${current.spo2}% is below optimal baseline (>=95%).`,
      recommendation: "Check sensor snugness on senior's wrist and observe for persistent dips over the next 30 minutes.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  }

  // Heart Rate rules
  if (current.heartRate > 115) {
    anomalies.push({
      metric: "heart_rate",
      title: "Elevated Heart Rate (Tachycardia)",
      severity: current.heartRate > 130 ? "critical" : "warning",
      status: "new",
      currentValue: `${current.heartRate} BPM`,
      previousValue: previous ? `${previous.heartRate} BPM` : undefined,
      reason: `Heart rate recorded at ${current.heartRate} BPM during moderate or resting activity.`,
      recommendation: "Assess if senior was engaged in exercise, hydration level, or feels palpitations. Contact caregiver if resting HR remains >115.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  } else if (current.heartRate < 52) {
    anomalies.push({
      metric: "heart_rate",
      title: "Low Resting Heart Rate (Bradycardia)",
      severity: "warning",
      status: "new",
      currentValue: `${current.heartRate} BPM`,
      previousValue: previous ? `${previous.heartRate} BPM` : undefined,
      reason: `Heart rate dipped to ${current.heartRate} BPM.`,
      recommendation: "Verify whether senior is asleep or resting. Check for dizziness, fatigue, or beta-blocker dosage timing.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  }

  // Blood Pressure rules
  if (current.bpSystolic >= 145 || current.bpDiastolic >= 92) {
    anomalies.push({
      metric: "blood_pressure",
      title: "Elevated Blood Pressure Reading",
      severity: current.bpSystolic >= 160 ? "critical" : "attention",
      status: "new",
      currentValue: `${current.bpSystolic}/${current.bpDiastolic} mmHg`,
      previousValue: previous ? `${previous.bpSystolic}/${previous.bpDiastolic} mmHg` : undefined,
      reason: `Wearable optical BP estimated ${current.bpSystolic}/${current.bpDiastolic} mmHg, exceeding standard norm (<130/85).`,
      recommendation: "Request senior to rest quietly for 5 minutes and perform a calibrated cuff blood pressure verification.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  }

  // Stress spikes
  if (current.stressScore >= 80) {
    anomalies.push({
      metric: "stress",
      title: "Elevated Physiological Stress Level",
      severity: "attention",
      status: "new",
      currentValue: `${current.stressScore}/100 (${current.stressCategory})`,
      previousValue: previous ? `${previous.stressScore}/100` : undefined,
      reason: `HRV analysis detected elevated sympathetic activity (stress score ${current.stressScore}).`,
      recommendation: "Suggest relaxation or hydration break. Review whether recent physical exertion or anxiety triggered the surge.",
      detectedAt: current.timestamp,
      resolvedAt: undefined,
      resolvedBy: undefined,
      notes: undefined,
    });
  }

  return anomalies;
}

/** Simulate subtle, natural physiological drift for live monitoring */
export function applyLiveMetricDrift(current: WearableReading): WearableReading {
  // Gradual random walk with mean reversion
  const hrDrift = (Math.random() - 0.49) * 2; // -1 to +1
  const targetHR = 74;
  const hrDelta = Math.round(hrDrift + (targetHR - current.heartRate) * 0.1);
  const newHR = Math.max(62, Math.min(95, current.heartRate + hrDelta));

  // SpO2 stays steady 97-99%
  const spo2Rand = Math.random();
  let newSpO2 = current.spo2;
  if (spo2Rand > 0.85) newSpO2 = Math.min(99, newSpO2 + 1);
  else if (spo2Rand < 0.15) newSpO2 = Math.max(97, newSpO2 - 1);

  // Stress score subtle drift
  const stressDelta = Math.round((Math.random() - 0.5) * 3);
  const newStress = Math.max(15, Math.min(65, current.stressScore + stressDelta));

  // Blood pressure minor oscillation
  const sysDelta = Math.round((Math.random() - 0.5) * 2);
  const diaDelta = Math.round((Math.random() - 0.5) * 1.5);
  const newSys = Math.max(115, Math.min(130, current.bpSystolic + sysDelta));
  const newDia = Math.max(72, Math.min(84, current.bpDiastolic + diaDelta));

  // Steps increase slightly during awake hours (e.g. +2 to +8 every few ticks)
  const stepAdd = Math.random() > 0.6 ? Math.floor(Math.random() * 5) + 1 : 0;
  const newSteps = current.steps + stepAdd;
  const newCalories = current.calories + (stepAdd > 0 ? Math.round(stepAdd * 0.04) : 0);
  const newDist = parseFloat((current.distanceKm + stepAdd * 0.00075).toFixed(2));

  return {
    ...current,
    timestamp: new Date().toISOString(),
    heartRate: newHR,
    spo2: newSpO2,
    stressScore: newStress,
    stressCategory: deriveStressCategory(newStress),
    bpSystolic: newSys,
    bpDiastolic: newDia,
    steps: newSteps,
    calories: newCalories,
    distanceKm: newDist,
  };
}

/**
 * Generate a deterministic 24-hour baseline history for a senior
 * Allows coordinators to visualize full diurnal patterns (sleep dips, daytime activity, post-lunch vitals)
 */
export function generate24HourMockTelemetry(seniorName: string = "Senior"): {
  device: WearableDevice;
  readings: WearableReading[];
  hourlyReports: HourlyHealthReport[];
  initialAlerts: WearableAlert[];
} {
  const now = new Date();
  const readings: WearableReading[] = [];
  const hourlyReports: HourlyHealthReport[] = [];

  const device: WearableDevice = {
    id: "dev-fireboltt-legacy-001",
    seniorId: "mock-senior-id",
    deviceName: `${seniorName}'s Smart Watch Legacy`,
    deviceModel: "Fire-Boltt Legacy",
    macAddress: "FB:8C:44:A2:91:D8",
    connectionStatus: "connected",
    batteryLevel: 84,
    firmwareVersion: "v2.4.18-BLE",
    lastSyncAt: new Date(now.getTime() - 25 * 1000).toISOString(),
    images: FIRE_BOLTT_LEGACY_INFO.images,
  };

  let cumulativeSteps = 0;
  let cumulativeCalories = 1200; // basal

  // Generate 24 hourly data points backward from current hour
  for (let h = 23; h >= 0; h--) {
    const reportDate = new Date(now.getTime() - h * 60 * 60 * 1000);
    const hour = reportDate.getHours();

    const isNight = hour >= 23 || hour < 6;
    const isMorning = hour >= 6 && hour < 11;
    const isAfternoon = hour >= 11 && hour < 17;

    // Physiological baseline modeling
    let hr = isNight ? 58 + (h % 5) : isMorning ? 74 + (h % 8) : isAfternoon ? 78 + (h % 6) : 71 + (h % 4);
    let spo2 = isNight ? 96 + (h % 3) : 98;
    let stress = isNight ? 16 + (h % 8) : isMorning ? 28 + (h % 10) : 34 + (h % 12);
    let bpSys = isNight ? 114 + (h % 4) : 122 + (h % 6);
    let bpDia = isNight ? 72 + (h % 3) : 78 + (h % 4);

    let hourlySteps = 0;
    let activityLevel: HourlyHealthReport["activityLevel"] = "resting";

    if (isNight) {
      hourlySteps = h % 3 === 0 ? 15 : 0;
      activityLevel = "resting";
    } else if (hour === 7 || hour === 8) {
      hourlySteps = 680 + (h * 15);
      activityLevel = "active";
      hr += 8;
    } else if (hour === 11 || hour === 12) {
      hourlySteps = 540;
      activityLevel = "active";
    } else if (hour === 16 || hour === 17) {
      hourlySteps = 420;
      activityLevel = "light";
    } else {
      hourlySteps = 120 + (h % 70);
      activityLevel = "sedentary";
    }

    // Insert 1 notable mild deviation around 3 hours ago for rich coordinator alerts demo
    let unusual: string | null = null;
    let summary = `Heart rate ${hr} BPM, SpO2 ${spo2}%, stress level ${deriveStressCategory(stress)}. Normal diurnal pattern.`;

    if (h === 4) {
      hr = 98;
      stress = 68;
      unusual = "Mild heart rate acceleration";
      summary = `Heart rate reached 98 BPM with stress score 68. Activity was moderate walking. Vitals stabilized shortly after.`;
    } else if (h === 18) {
      // Overnight sleep summary
      summary = `Resting heart rate dip (58 BPM) during deep restorative sleep. SpO2 stable at 97%.`;
    }

    cumulativeSteps += hourlySteps;
    cumulativeCalories += Math.round(hourlySteps * 0.04) + 25; // active + hourly basal
    const currentDist = parseFloat((cumulativeSteps * 0.00075).toFixed(2));

    const timeStr = reportDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const reading: WearableReading = {
      id: `reading-mock-${h}`,
      timestamp: reportDate.toISOString(),
      heartRate: hr,
      spo2,
      stressScore: stress,
      stressCategory: deriveStressCategory(stress),
      bpSystolic: bpSys,
      bpDiastolic: bpDia,
      steps: cumulativeSteps,
      calories: cumulativeCalories,
      distanceKm: currentDist,
      sleepMinutes: isNight ? 55 : 0,
      sleepDeepMinutes: isNight && hour >= 1 && hour <= 4 ? 35 : 0,
      sleepLightMinutes: isNight ? 20 : 0,
      sleepRemMinutes: isNight && hour === 5 ? 25 : 0,
      source: "fire_boltt_legacy",
    };
    readings.push(reading);

    hourlyReports.push({
      id: `report-hour-${h}`,
      hourLabel: timeStr,
      timestamp: reportDate.toISOString(),
      heartRate: hr,
      spo2,
      bpSystolic: bpSys,
      bpDiastolic: bpDia,
      stressScore: stress,
      stressCategory: deriveStressCategory(stress),
      steps: hourlySteps,
      calories: Math.round(hourlySteps * 0.04) + 25,
      distanceKm: parseFloat((hourlySteps * 0.00075).toFixed(2)),
      unusualVariation: unusual,
      summary,
      activityLevel,
    });
  }

  // Reverse hourlyReports so newest appears first in timeline
  hourlyReports.reverse();

  // Create initial demonstration anomaly alerts
  const initialAlerts: WearableAlert[] = [
    {
      id: "alert-001",
      seniorId: "mock-senior-id",
      metric: "heart_rate",
      title: "Transient Heart Rate Elevation (98 BPM)",
      severity: "attention",
      status: "acknowledged",
      currentValue: "98 BPM",
      previousValue: "76 BPM",
      reason: "Smartwatch recorded a 22 BPM rise during routine morning mobility.",
      recommendation: "Ensure adequate hydration after morning walk. No clinical intervention needed unless persistent >110 BPM.",
      detectedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      notes: "Checked by coordinator: senior had completed morning balcony stroll.",
    },
    {
      id: "alert-002",
      seniorId: "mock-senior-id",
      metric: "blood_pressure",
      title: "Borderline Systolic Reading (134/86 mmHg)",
      severity: "warning",
      status: "new",
      currentValue: "134/86 mmHg",
      previousValue: "122/78 mmHg",
      reason: "Wearable estimated blood pressure slightly above target threshold (<130/85 mmHg).",
      recommendation: "Schedule a physical sphygmomanometer check before evening dose.",
      detectedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return { device, readings, hourlyReports, initialAlerts };
}
