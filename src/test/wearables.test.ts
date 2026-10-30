import { describe, expect, it } from "vitest";
import {
  applyLiveMetricDrift,
  deriveStressCategory,
  detectReadingAnomalies,
  generate24HourMockTelemetry,
  wearableImportPayloadSchema,
  wearableReadingSchema,
  type WearableReading,
} from "@/lib/wearables";

describe("Wearable Biometrics & Fire-Boltt Legacy Telemetry", () => {
  it("derives correct stress category from numeric score", () => {
    expect(deriveStressCategory(20)).toBe("relaxed");
    expect(deriveStressCategory(35)).toBe("low");
    expect(deriveStressCategory(55)).toBe("normal");
    expect(deriveStressCategory(72)).toBe("mild");
    expect(deriveStressCategory(85)).toBe("elevated");
    expect(deriveStressCategory(95)).toBe("high");
  });

  describe("detectReadingAnomalies", () => {
    const normalReading: WearableReading = {
      timestamp: new Date().toISOString(),
      heartRate: 72,
      spo2: 98,
      stressScore: 25,
      stressCategory: "relaxed",
      bpSystolic: 120,
      bpDiastolic: 80,
      steps: 4500,
      calories: 1600,
      distanceKm: 3.2,
      source: "fire_boltt_legacy",
    };

    it("returns no anomalies for normal physiological readings", () => {
      const anomalies = detectReadingAnomalies(normalReading);
      expect(anomalies).toHaveLength(0);
    });

    it("flags critical hypoxia when SpO2 drops below 92%", () => {
      const hypoxicReading: WearableReading = {
        ...normalReading,
        spo2: 90,
      };
      const anomalies = detectReadingAnomalies(hypoxicReading, normalReading);
      expect(anomalies.length).toBeGreaterThan(0);
      const spo2Alert = anomalies.find((a) => a.metric === "spo2");
      expect(spo2Alert).toBeDefined();
      expect(spo2Alert?.severity).toBe("critical");
      expect(spo2Alert?.currentValue).toBe("90%");
    });

    it("flags warning when SpO2 is between 92% and 94%", () => {
      const mildDesat: WearableReading = {
        ...normalReading,
        spo2: 93,
      };
      const anomalies = detectReadingAnomalies(mildDesat, normalReading);
      const spo2Alert = anomalies.find((a) => a.metric === "spo2");
      expect(spo2Alert).toBeDefined();
      expect(spo2Alert?.severity).toBe("warning");
    });

    it("flags tachycardia when heart rate exceeds 115 BPM", () => {
      const tachyReading: WearableReading = {
        ...normalReading,
        heartRate: 122,
      };
      const anomalies = detectReadingAnomalies(tachyReading);
      const hrAlert = anomalies.find((a) => a.metric === "heart_rate");
      expect(hrAlert).toBeDefined();
      expect(hrAlert?.severity).toBe("warning");
      expect(hrAlert?.currentValue).toBe("122 BPM");
    });

    it("flags critical tachycardia when heart rate exceeds 130 BPM", () => {
      const criticalTachy: WearableReading = {
        ...normalReading,
        heartRate: 135,
      };
      const anomalies = detectReadingAnomalies(criticalTachy);
      const hrAlert = anomalies.find((a) => a.metric === "heart_rate");
      expect(hrAlert).toBeDefined();
      expect(hrAlert?.severity).toBe("critical");
    });

    it("flags bradycardia when heart rate dips below 52 BPM", () => {
      const bradyReading: WearableReading = {
        ...normalReading,
        heartRate: 48,
      };
      const anomalies = detectReadingAnomalies(bradyReading);
      const hrAlert = anomalies.find((a) => a.metric === "heart_rate");
      expect(hrAlert).toBeDefined();
      expect(hrAlert?.severity).toBe("warning");
    });

    it("flags elevated blood pressure when systolic >= 145 or diastolic >= 92", () => {
      const htnReading: WearableReading = {
        ...normalReading,
        bpSystolic: 148,
        bpDiastolic: 94,
      };
      const anomalies = detectReadingAnomalies(htnReading);
      const bpAlert = anomalies.find((a) => a.metric === "blood_pressure");
      expect(bpAlert).toBeDefined();
      expect(bpAlert?.currentValue).toBe("148/94 mmHg");
    });

    it("flags stress arousal when score >= 80", () => {
      const stressReading: WearableReading = {
        ...normalReading,
        stressScore: 88,
        stressCategory: "elevated",
      };
      const anomalies = detectReadingAnomalies(stressReading);
      const stressAlert = anomalies.find((a) => a.metric === "stress");
      expect(stressAlert).toBeDefined();
      expect(stressAlert?.severity).toBe("attention");
    });
  });

  describe("applyLiveMetricDrift", () => {
    it("maintains physiological bounds across random walk drift", () => {
      let current: WearableReading = {
        timestamp: new Date().toISOString(),
        heartRate: 75,
        spo2: 98,
        stressScore: 30,
        stressCategory: "low",
        bpSystolic: 122,
        bpDiastolic: 78,
        steps: 1000,
        calories: 1400,
        distanceKm: 0.75,
        source: "fire_boltt_legacy",
      };

      for (let i = 0; i < 20; i++) {
        current = applyLiveMetricDrift(current);
        expect(current.heartRate).toBeGreaterThanOrEqual(60);
        expect(current.heartRate).toBeLessThanOrEqual(100);
        expect(current.spo2).toBeGreaterThanOrEqual(95);
        expect(current.spo2).toBeLessThanOrEqual(100);
        expect(current.bpSystolic).toBeGreaterThanOrEqual(110);
        expect(current.bpSystolic).toBeLessThanOrEqual(135);
        expect(current.steps).toBeGreaterThanOrEqual(1000);
      }
    });
  });

  describe("generate24HourMockTelemetry", () => {
    it("generates complete 24-hour diurnal profile for a senior", () => {
      const result = generate24HourMockTelemetry("Garvit");

      expect(result.device.deviceName).toBe("Garvit's Smart Watch Legacy");
      expect(result.device.deviceModel).toBe("Fire-Boltt Legacy");
      expect(result.device.batteryLevel).toBe(84);
      expect(result.device.images.length).toBeGreaterThan(0);

      expect(result.readings).toHaveLength(24);
      expect(result.hourlyReports).toHaveLength(24);
      expect(result.initialAlerts.length).toBeGreaterThan(0);

      // Verify hourly reports contain required fields
      const firstReport = result.hourlyReports[0]!;
      expect(firstReport.hourLabel).toBeDefined();
      expect(firstReport.heartRate).toBeGreaterThan(0);
      expect(firstReport.spo2).toBeGreaterThan(0);
      expect(firstReport.bpSystolic).toBeGreaterThan(0);
      expect(firstReport.summary).toBeDefined();
    });
  });

  describe("wearableImportPayloadSchema", () => {
    it("validates a compliant JSON telemetry import payload", () => {
      const payload = {
        seniorId: "a1111111-1111-4111-8111-111111111111",
        deviceModel: "Fire-Boltt Legacy",
        exportedAt: "2026-10-30T10:00:00Z",
        readings: [
          {
            timestamp: "2026-10-30T10:00:00Z",
            heartRate: 76,
            spo2: 98,
            stressScore: 25,
            stressCategory: "normal",
            bpSystolic: 120,
            bpDiastolic: 80,
            steps: 3200,
            calories: 1450,
            distanceKm: 2.1,
            source: "fire_boltt_legacy",
          },
        ],
      };

      const result = wearableImportPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("rejects empty readings array", () => {
      const invalid = {
        deviceModel: "Fire-Boltt Legacy",
        readings: [],
      };
      const result = wearableImportPayloadSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid heart rate or SpO2 values outside limits", () => {
      const invalid = {
        deviceModel: "Fire-Boltt Legacy",
        readings: [
          {
            timestamp: "2026-10-30T10:00:00Z",
            heartRate: 500, // impossible
            spo2: 120, // max is 100
          },
        ],
      };
      const result = wearableImportPayloadSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
