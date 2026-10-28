import { describe, expect, it } from "vitest";
import {
  alertActionForPriority,
  explainAlert,
  nextAlertStep,
  ALERT_STATUS_LABEL,
} from "@/lib/alerts";
import { listAlertsInput } from "@/lib/alerts.functions";
import { canTransitionCase, caseTransitionNeedsReason } from "@/lib/review-workflow";
import { primaryNav } from "@/lib/navigation";

const label = (d: string) => d;

describe("alert generation rules", () => {
  it("any review priority opens (or attaches to) an alert", () => {
    for (const p of [
      "review_suggested",
      "review_recommended",
      "prompt_review_recommended",
    ] as const)
      expect(alertActionForPriority(p)).toBe("open");
  });
  it("unable to assess (missing/stale data) raises an alert, not reassurance", () => {
    expect(alertActionForPriority("unable_to_assess")).toBe("open");
  });
  it("no signal never creates an alert and never closes one — it only refreshes evidence", () => {
    expect(alertActionForPriority("no_signal_detected")).toBe("attach_if_active");
  });
});

describe("alert lifecycle", () => {
  it("open -> acknowledged -> escalated -> resolved is allowed", () => {
    expect(canTransitionCase("needs_review", "in_review")).toBe(true);
    expect(canTransitionCase("in_review", "follow_up_required")).toBe(true);
    expect(canTransitionCase("follow_up_required", "resolved")).toBe(true);
  });
  it("an open alert cannot be resolved just by being opened", () => {
    expect(canTransitionCase("needs_review", "resolved")).toBe(false);
  });
  it("closed alerts cannot transition (reopen creates a new alert)", () => {
    expect(canTransitionCase("resolved", "in_review")).toBe(false);
    expect(canTransitionCase("dismissed", "needs_review")).toBe(false);
  });
  it("resolve and dismiss need a reason", () => {
    expect(caseTransitionNeedsReason("resolved")).toBe(true);
    expect(caseTransitionNeedsReason("dismissed")).toBe(true);
    expect(caseTransitionNeedsReason("in_review")).toBe(false);
  });
  it("status wording maps onto the review statuses", () => {
    expect(ALERT_STATUS_LABEL.needs_review).toBe("Open");
    expect(ALERT_STATUS_LABEL.in_review).toBe("Acknowledged");
    expect(nextAlertStep("resolved", true)).toMatch(/Reopen/);
  });
});

describe("alert explanation", () => {
  it("missing data is described as uncertainty", () => {
    expect(
      explainAlert({
        priority: "unable_to_assess",
        dataQuality: "insufficient",
        changedDomains: [],
        domainLabel: label,
      }),
    ).toMatch(/not reassurance/);
  });
  it("names changed areas", () => {
    expect(
      explainAlert({
        priority: "review_suggested",
        dataQuality: "adequate",
        changedDomains: ["sleep"],
        domainLabel: label,
      }),
    ).toBe("Change found in: sleep.");
  });
});

describe("alert list input", () => {
  it("rejects unknown fields and bad statuses", () => {
    expect(() => listAlertsInput.parse({ orgId: "x" })).toThrow();
    expect(() => listAlertsInput.parse({ status: "escalated" })).toThrow();
  });
  it("defaults to active alerts sorted by priority", () => {
    const d = listAlertsInput.parse({});
    expect(d.scope).toBe("active");
    expect(d.sort).toBe("priority");
  });
});

describe("navigation", () => {
  it("Alerts, Messages and Reports link to real pages", () => {
    const by = Object.fromEntries(primaryNav.map((i) => [i.label, i]));
    expect(by["Alerts"]).toMatchObject({ status: "available", to: "/alerts" });
    expect(by["Messages"]).toMatchObject({ status: "available", to: "/messages" });
    expect(by["Reports"]).toMatchObject({ status: "available", to: "/reports" });
  });
});
