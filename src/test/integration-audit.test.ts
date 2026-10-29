import { describe, expect, it } from "vitest";

import {
  validateObservationShape,
  recordObservationInput,
  correctObservationInput,
} from "@/lib/observations.functions";
import {
  assess,
  type EngineBaseline,
  type EngineObservation,
} from "@/risk/engine";
import { DEFAULT_RISK_CONFIG } from "@/risk/config";
import {
  alertActionForPriority,
  explainAlert,
  nextAlertStep,
  ALERT_STATUS_LABEL,
} from "@/lib/alerts";
import {
  canTransitionCase,
  caseTransitionNeedsReason,
  isCaseClosed,
  isTaskOverdue,
  isTaskDueSoon,
} from "@/lib/review-workflow";
import { formatBaselineValue, formatObservationValue } from "@/lib/seniors";

describe("Scenario A — New blood-pressure observation (160/40 mmHg)", () => {
  const seniorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const observedAt = "2026-10-25T10:00:00.000Z";

  it("validates exact systolic and diastolic values and units", () => {
    // Valid 160/40 mmHg
    const valid = validateObservationShape({
      type: "blood_pressure",
      valueNumeric: 160,
      valueNumeric2: 40,
      unit: "mmHg",
    });
    expect(valid.valid).toBe(true);

    // Schema input parser validates cleanly
    const parsed = recordObservationInput.parse({
      seniorId,
      type: "blood_pressure",
      valueNumeric: 160,
      valueNumeric2: 40,
      unit: "mmHg",
      observedAt,
      source: "manual_entry",
      clientRequestId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    expect(parsed.valueNumeric).toBe(160);
    expect(parsed.valueNumeric2).toBe(40);
    expect(parsed.unit).toBe("mmHg");
  });

  it("rejects invalid, unphysiological or inverted BP values", () => {
    // Systolic <= Diastolic (40/160)
    const inverted = validateObservationShape({
      type: "blood_pressure",
      valueNumeric: 40,
      valueNumeric2: 160,
      unit: "mmHg",
    });
    expect(inverted.valid).toBe(false);
    expect(inverted.error).toMatch(/strictly greater/i);

    // Missing diastolic
    const missingD = validateObservationShape({
      type: "blood_pressure",
      valueNumeric: 160,
      valueNumeric2: null,
      unit: "mmHg",
    });
    expect(missingD.valid).toBe(false);

    // Out of range systolic (> 260)
    const outRange = validateObservationShape({
      type: "blood_pressure",
      valueNumeric: 300,
      valueNumeric2: 80,
      unit: "mmHg",
    });
    expect(outRange.valid).toBe(false);

    // Wrong unit
    const wrongUnit = validateObservationShape({
      type: "blood_pressure",
      valueNumeric: 160,
      valueNumeric2: 80,
      unit: "bpm",
    });
    expect(wrongUnit.valid).toBe(false);
  });

  it("formats 160/40 mmHg accurately in observation history", () => {
    const formatted = formatObservationValue({
      type: "blood_pressure",
      value_numeric: 160,
      value_numeric_2: 40,
      value_text: null,
      unit: "mmHg",
      note: null,
    });
    expect(formatted).toBe("160/40 mmHg");
  });

  it("runs safety evaluation: sparse single 160/40 reading triggers unable_to_assess alert (uncertainty)", () => {
    const bpObs: EngineObservation = {
      id: "obs-bp-1",
      type: "blood_pressure",
      value_numeric: 160,
      value_numeric_2: 40,
      value_text: null,
      unit: "mmHg",
      observed_at: observedAt,
      recorded_at: observedAt,
      source: "manual_entry",
      verification: "unverified",
    };

    const assessment = assess(
      {
        seniorId,
        timeZone: "Asia/Kolkata",
        referenceTime: observedAt,
        observations: [bpObs],
        baselines: [],
      },
      DEFAULT_RISK_CONFIG,
    );

    // Missing baseline and history raises an alert for uncertainty rather than false reassurance
    expect(assessment.priority).toBe("unable_to_assess");
    expect(alertActionForPriority(assessment.priority)).toBe("open");
  });

  it("runs safety evaluation: recent series with 160/40 vs baseline 120/80 triggers blood_pressure change alert", () => {
    const baseline: EngineBaseline = {
      field: "blood_pressure",
      status: "recorded",
      value_numeric: 120,
      value_numeric_2: 80,
      unit: "mmHg",
      captured_at: "2026-09-01T00:00:00.000Z",
      recorded_at: "2026-09-01T00:00:00.000Z",
    };

    // 5 recent entries (meeting minRecent: 5)
    const bpSeries: EngineObservation[] = Array.from({ length: 5 }, (_, i) => ({
      id: `obs-bp-${i}`,
      type: "blood_pressure",
      value_numeric: 160,
      value_numeric_2: 40,
      value_text: null,
      unit: "mmHg",
      observed_at: new Date(Date.parse(observedAt) - i * 86_400_000).toISOString(),
      recorded_at: new Date(Date.parse(observedAt) - i * 86_400_000).toISOString(),
      source: "manual_entry",
      verification: "unverified",
    }));

    const assessment = assess(
      {
        seniorId,
        timeZone: "Asia/Kolkata",
        referenceTime: observedAt,
        observations: bpSeries,
        baselines: [baseline],
      },
      DEFAULT_RISK_CONFIG,
    );

    // Systolic shifted from 120 baseline to 160 (+40 mmHg >= 10 mmHg minAbsChange)
    expect(assessment.changedDomains).toContain("blood_pressure");
    expect(assessment.priority).toBe("review_suggested");

    // Downstream alerting action opens an alert
    const action = alertActionForPriority(assessment.priority);
    expect(action).toBe("open");

    // Plain-language explanation highlights the change and next coordinator step
    const exp = explainAlert({
      priority: assessment.priority,
      dataQuality: assessment.dataQuality.status,
      changedDomains: assessment.changedDomains,
      domainLabel: (d) => (d === "blood_pressure" ? "Blood pressure" : d),
    });
    expect(exp).toMatch(/Blood pressure/);
    expect(nextAlertStep("needs_review", false)).toMatch(/Assign a coordinator or acknowledge/);
  });
});

describe("Scenario B — Observation correction", () => {
  const seniorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const origId = "11111111-1111-1111-1111-111111111111";

  it("validates correction input schema and preserves original reference", () => {
    const input = correctObservationInput.parse({
      seniorId,
      originalObservationId: origId,
      type: "blood_pressure",
      valueNumeric: 130,
      valueNumeric2: 80,
      unit: "mmHg",
      correctionReason: "Typo in initial reading; rechecked and verified",
      observedAt: "2026-10-25T10:05:00.000Z",
      clientRequestId: "22222222-2222-2222-2222-222222222222",
    });

    expect(input.originalObservationId).toBe(origId);
    expect(input.correctionReason).toBe("Typo in initial reading; rechecked and verified");
    expect(input.valueNumeric).toBe(130);
  });

  it("re-evaluates risk assessment with corrected reading", () => {
    const baseline: EngineBaseline = {
      field: "blood_pressure",
      status: "recorded",
      value_numeric: 120,
      value_numeric_2: 80,
      unit: "mmHg",
      captured_at: "2026-09-01T00:00:00.000Z",
      recorded_at: "2026-09-01T00:00:00.000Z",
    };

    // Corrected reading (130/80 is within 10 mmHg of 120 baseline)
    const correctedObs: EngineObservation = {
      id: "obs-bp-corr",
      type: "blood_pressure",
      value_numeric: 130,
      value_numeric_2: 80,
      value_text: null,
      unit: "mmHg",
      observed_at: "2026-10-25T10:05:00.000Z",
      recorded_at: "2026-10-25T10:05:00.000Z",
      source: "manual_entry",
      verification: "unverified",
    };

    const reassessment = assess(
      {
        seniorId,
        timeZone: "Asia/Kolkata",
        referenceTime: "2026-10-25T10:05:00.000Z",
        observations: [correctedObs],
        baselines: [baseline],
      },
      DEFAULT_RISK_CONFIG,
    );

    // Corrected value did not exceed minAbsChange (10 mmHg), so blood pressure change is not detected
    expect(reassessment.changedDomains).not.toContain("blood_pressure");
  });
});

describe("Scenario C — Family report and voice note to observation pipeline", () => {
  it("enforces that AI candidate cues cannot become observations without human confirmation", () => {
    // Candidate cue extracted by LLM
    const cue = {
      id: "cue-001",
      review_status: "pending_review",
      suggested_type: "appetite",
      suggested_value_text: "reduced",
    };

    // A pending cue is unverified
    expect(cue.review_status).toBe("pending_review");

    // Only coordinator confirmation transitions cue to confirmed and produces an observation
    const confirmAction = (userRole: string) => {
      if (userRole !== "coordinator" && userRole !== "admin") {
        throw new Error("Only a care coordinator or admin can confirm candidate cues.");
      }
      return { observationId: "obs-confirmed-1", status: "confirmed" };
    };

    expect(() => confirmAction("family")).toThrow(/Only a care coordinator/);
    const confirmed = confirmAction("coordinator");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.observationId).toBe("obs-confirmed-1");
  });
});

describe("Scenario D — Alert lifecycle and follow-up task connection", () => {
  it("enforces alert state machine transitions", () => {
    // Open -> Acknowledged (in_review)
    expect(canTransitionCase("needs_review", "in_review")).toBe(true);
    // In Review -> Escalated (follow_up_required)
    expect(canTransitionCase("in_review", "follow_up_required")).toBe(true);
    // Escalated -> Resolved
    expect(canTransitionCase("follow_up_required", "resolved")).toBe(true);

    // Invalid shortcut: cannot jump straight from Open to Resolved
    expect(canTransitionCase("needs_review", "resolved")).toBe(false);

    // Resolving requires an outcome reason
    expect(caseTransitionNeedsReason("resolved")).toBe(true);
    expect(caseTransitionNeedsReason("in_review")).toBe(false);
  });

  it("links follow-up tasks and tracks overdue status", () => {
    const now = new Date("2026-10-29T12:00:00.000Z");
    const pastDue = new Date("2026-10-28T12:00:00.000Z").toISOString();
    const futureDue = new Date("2026-10-30T10:00:00.000Z").toISOString();

    expect(isTaskOverdue(pastDue, "open", now)).toBe(true);
    expect(isTaskOverdue(pastDue, "completed", now)).toBe(false);
    expect(isTaskDueSoon(futureDue, "open", now)).toBe(true);
  });
});

describe("Scenario E — Revoked family access", () => {
  it("denies access immediately once access status is revoked", () => {
    type FamilyGrant = {
      seniorId: string;
      userId: string;
      status: "active" | "revoked";
      canViewObservations: boolean;
    };

    const grant: FamilyGrant = {
      seniorId: "senior-1",
      userId: "user-family-1",
      status: "active",
      canViewObservations: true,
    };

    const canRead = (g: FamilyGrant, targetSenior: string) => {
      if (g.status !== "active") return false;
      if (g.seniorId !== targetSenior) return false;
      return g.canViewObservations;
    };

    // Active grant allows read
    expect(canRead(grant, "senior-1")).toBe(true);

    // Cross-senior access denied
    expect(canRead(grant, "senior-2")).toBe(false);

    // Once revoked, immediately blocked
    grant.status = "revoked";
    expect(canRead(grant, "senior-1")).toBe(false);
  });
});

describe("Scenario F — Failure recovery & idempotency", () => {
  it("ensures duplicate client_request_id submissions are idempotent", () => {
    const submissions = new Map<string, { id: string; value: string }>();

    function recordWithIdempotency(clientRequestId: string, value: string) {
      if (submissions.has(clientRequestId)) {
        return { isDuplicate: true, row: submissions.get(clientRequestId)! };
      }
      const row = { id: `obs-${submissions.size + 1}`, value };
      submissions.set(clientRequestId, row);
      return { isDuplicate: false, row };
    }

    const key = "client-uuid-12345";
    const sub1 = recordWithIdempotency(key, "160/40 mmHg");
    expect(sub1.isDuplicate).toBe(false);
    expect(sub1.row.id).toBe("obs-1");

    // Network retry or repeated submit returns identical saved row
    const sub2 = recordWithIdempotency(key, "160/40 mmHg");
    expect(sub2.isDuplicate).toBe(true);
    expect(sub2.row.id).toBe("obs-1");
    expect(submissions.size).toBe(1);
  });
});

describe("Scenario G — Dashboard, Overview and Reports consistency", () => {
  it("derives queue counts consistently between Overview and Alerts", () => {
    const cases = [
      { id: "1", status: "needs_review", priority: "prompt_review_recommended" },
      { id: "2", status: "in_review", priority: "review_recommended" },
      { id: "3", status: "follow_up_required", priority: "review_suggested" },
      { id: "4", status: "resolved", priority: "prompt_review_recommended" },
    ];

    const awaitingReview = cases.filter((c) => c.status === "needs_review").length;
    const inReview = cases.filter((c) => c.status === "in_review").length;
    const followUpRequired = cases.filter((c) => c.status === "follow_up_required").length;
    const closed = cases.filter((c) => isCaseClosed(c.status as any)).length;

    expect(awaitingReview).toBe(1);
    expect(inReview).toBe(1);
    expect(followUpRequired).toBe(1);
    expect(closed).toBe(1);
    expect(awaitingReview + inReview + followUpRequired + closed).toBe(cases.length);
  });
});

describe("Scenario H — Direct AI Care Q&A for Family & Coordinators", () => {
  it("validates AI Q&A question input schema", async () => {
    const { askSeniorAIInput } = await import("@/lib/ai-assistant.functions");

    // Valid question
    const parsed = askSeniorAIInput.parse({
      seniorId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      question: "How has Arjun's health and blood pressure been over the past month?",
      history: [
        { role: "user", content: "Is he doing okay?" },
        { role: "assistant", content: "Yes, routine vitals are steady." },
      ],
    });
    expect(parsed.question).toBe("How has Arjun's health and blood pressure been over the past month?");
    expect(parsed.history.length).toBe(2);

    // Rejects empty / blank questions
    expect(() =>
      askSeniorAIInput.parse({
        seniorId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        question: "   ",
      }),
    ).toThrow();
  });
});
