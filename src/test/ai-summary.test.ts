import { describe, expect, it } from "vitest";
import { parseSummary } from "@/lib/ai/summary";

const base = {
  headline: "Appetite reduced on two recent days.",
  today: null,
  points: [{ text: "Appetite less than usual.", evidence_ids: ["a"] }],
  notes_summary: null,
  data_gaps: ["No weight in 14 days."],
  suggested_checks: [],
};

describe("AI wellbeing summary validation", () => {
  it("accepts grounded output", () => {
    const r = parseSummary(JSON.stringify(base), new Set(["a"]));
    expect(r.ok && r.value.points).toHaveLength(1);
  });

  it("drops points that cite records that were not provided", () => {
    const r = parseSummary(JSON.stringify({ ...base, points: [{ text: "x", evidence_ids: ["zzz"] }] }), new Set(["a"]));
    expect(r.ok && r.value.points).toEqual([]);
  });

  it("rejects risk scores and percentages", () => {
    expect(parseSummary(JSON.stringify({ ...base, headline: "Risk score 7/10" }), new Set(["a"])).ok).toBe(false);
    expect(parseSummary(JSON.stringify({ ...base, headline: "80% likely to fall" }), new Set(["a"])).ok).toBe(false);
  });

  it("rejects diagnostic wording", () => {
    expect(parseSummary(JSON.stringify({ ...base, headline: "Likely diagnosis: infection" }), new Set(["a"])).ok).toBe(false);
  });

  it("rejects non-JSON", () => {
    expect(parseSummary("hello", new Set()).ok).toBe(false);
  });
});
