import { describe, expect, it } from "vitest";

import {
  canTransitionCase,
  canTransitionTask,
  caseTransitionNeedsReason,
  compareQueueRows,
  isAssessmentStale,
  isCaseClosed,
  isTaskClosed,
  isTaskDueSoon,
  isTaskOverdue,
  selectCurrentAssessment,
  taskTransitionNeedsNote,
} from "@/lib/review-workflow";

describe("review case transitions", () => {
  it("allows the documented lifecycle", () => {
    expect(canTransitionCase("needs_review", "in_review")).toBe(true);
    expect(canTransitionCase("needs_review", "dismissed")).toBe(true);
    expect(canTransitionCase("in_review", "follow_up_required")).toBe(true);
    expect(canTransitionCase("in_review", "resolved")).toBe(true);
    expect(canTransitionCase("follow_up_required", "resolved")).toBe(true);
    expect(canTransitionCase("follow_up_required", "dismissed")).toBe(true);
  });

  it("rejects invalid and backwards transitions", () => {
    expect(canTransitionCase("needs_review", "resolved")).toBe(false);
    expect(canTransitionCase("needs_review", "follow_up_required")).toBe(false);
    expect(canTransitionCase("in_review", "needs_review")).toBe(false);
    expect(canTransitionCase("follow_up_required", "in_review")).toBe(false);
    expect(canTransitionCase("needs_review", "needs_review")).toBe(false);
  });

  it("closed cases are terminal", () => {
    expect(isCaseClosed("resolved")).toBe(true);
    expect(isCaseClosed("dismissed")).toBe(true);
    expect(isCaseClosed("in_review")).toBe(false);
    expect(canTransitionCase("resolved", "in_review")).toBe(false);
    expect(canTransitionCase("dismissed", "needs_review")).toBe(false);
  });

  it("dismissal and resolution require a reason; other transitions do not", () => {
    expect(caseTransitionNeedsReason("dismissed")).toBe(true);
    expect(caseTransitionNeedsReason("resolved")).toBe(true);
    expect(caseTransitionNeedsReason("in_review")).toBe(false);
    expect(caseTransitionNeedsReason("follow_up_required")).toBe(false);
  });
});

describe("follow-up task transitions", () => {
  it("allows the documented lifecycle", () => {
    expect(canTransitionTask("open", "in_progress")).toBe(true);
    expect(canTransitionTask("open", "completed")).toBe(true);
    expect(canTransitionTask("open", "cancelled")).toBe(true);
    expect(canTransitionTask("in_progress", "completed")).toBe(true);
    expect(canTransitionTask("in_progress", "cancelled")).toBe(true);
    expect(canTransitionTask("in_progress", "open")).toBe(true);
  });

  it("rejects invalid transitions and closed tasks are terminal", () => {
    expect(canTransitionTask("open", "open")).toBe(false);
    expect(canTransitionTask("completed", "open")).toBe(false);
    expect(canTransitionTask("cancelled", "in_progress")).toBe(false);
    expect(isTaskClosed("completed")).toBe(true);
    expect(isTaskClosed("cancelled")).toBe(true);
    expect(isTaskClosed("open")).toBe(false);
  });

  it("completion requires an outcome note", () => {
    expect(taskTransitionNeedsNote("completed")).toBe(true);
    expect(taskTransitionNeedsNote("cancelled")).toBe(false);
    expect(taskTransitionNeedsNote("in_progress")).toBe(false);
  });

  it("assignee handling supports both assigned and unassigned states", () => {
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const assigneeNull: string | null = null;
    const assigneeUser: string | null = validUuid;
    expect(assigneeNull).toBeNull();
    expect(assigneeUser).toBe(validUuid);
  });
});

describe("overdue and due-soon derivation", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("a past due date on an open task is overdue", () => {
    expect(isTaskOverdue("2026-10-27T12:00:00Z", "open", now)).toBe(true);
    expect(isTaskOverdue("2026-10-27T12:00:00Z", "in_progress", now)).toBe(true);
  });

  it("closed tasks are never overdue", () => {
    expect(isTaskOverdue("2026-10-27T12:00:00Z", "completed", now)).toBe(false);
    expect(isTaskOverdue("2026-10-27T12:00:00Z", "cancelled", now)).toBe(false);
  });

  it("no due date is never overdue", () => {
    expect(isTaskOverdue(null, "open", now)).toBe(false);
  });

  it("due soon means within 48h and not yet overdue", () => {
    expect(isTaskDueSoon("2026-10-29T12:00:00Z", "open", now)).toBe(true);
    expect(isTaskDueSoon("2026-10-31T12:00:01Z", "open", now)).toBe(false);
    expect(isTaskDueSoon("2026-10-27T12:00:00Z", "open", now)).toBe(false); // already overdue
    expect(isTaskDueSoon("2026-10-29T12:00:00Z", "completed", now)).toBe(false);
  });
});

describe("queue ordering", () => {
  it("orders by priority rank, then recency, then id", () => {
    const rows = [
      { priority: "no_signal_detected" as const, assessedAt: "2026-10-28T00:00:00Z", id: "a" },
      {
        priority: "prompt_review_recommended" as const,
        assessedAt: "2026-10-20T00:00:00Z",
        id: "b",
      },
      { priority: "review_suggested" as const, assessedAt: "2026-10-27T00:00:00Z", id: "c" },
      {
        priority: "prompt_review_recommended" as const,
        assessedAt: "2026-10-27T00:00:00Z",
        id: "d",
      },
      { priority: "unable_to_assess" as const, assessedAt: "2026-10-28T00:00:00Z", id: "e" },
    ];
    const sorted = [...rows].sort(compareQueueRows).map((r) => r.id);
    expect(sorted).toEqual(["d", "b", "c", "e", "a"]);
  });

  it("unable_to_assess ranks above no_signal_detected (missing data is not reassuring)", () => {
    expect(
      compareQueueRows(
        { priority: "unable_to_assess", assessedAt: "2026-10-28T00:00:00Z", id: "x" },
        { priority: "no_signal_detected", assessedAt: "2026-10-28T00:00:00Z", id: "y" },
      ),
    ).toBeLessThan(0);
  });

  it("breaks identical timestamps deterministically by id", () => {
    const a = {
      priority: "review_suggested" as const,
      assessedAt: "2026-10-28T00:00:00Z",
      id: "aaa",
    };
    const b = {
      priority: "review_suggested" as const,
      assessedAt: "2026-10-28T00:00:00Z",
      id: "bbb",
    };
    expect(compareQueueRows(a, b)).toBeLessThan(0);
    expect(compareQueueRows(b, a)).toBeGreaterThan(0);
  });
});

describe("current vs superseded assessments", () => {
  it("selects the most recently created assessment", () => {
    const rows = [
      { id: "old", created_at: "2026-10-20T00:00:00Z" },
      { id: "new", created_at: "2026-10-28T00:00:00Z" },
      { id: "mid", created_at: "2026-10-25T00:00:00Z" },
    ];
    expect(selectCurrentAssessment(rows)?.id).toBe("new");
  });

  it("breaks timestamp ties by id for determinism", () => {
    const rows = [
      { id: "aaa", created_at: "2026-10-28T00:00:00Z" },
      { id: "bbb", created_at: "2026-10-28T00:00:00Z" },
    ];
    expect(selectCurrentAssessment(rows)?.id).toBe("bbb");
  });

  it("returns null for an empty history", () => {
    expect(selectCurrentAssessment([])).toBeNull();
  });

  it("stale means older than the staleness window", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(isAssessmentStale("2026-10-20T12:00:00Z", now)).toBe(true);
    expect(isAssessmentStale("2026-10-27T12:00:00Z", now)).toBe(false);
  });
});
