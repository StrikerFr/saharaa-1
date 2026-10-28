import { describe, expect, it } from "vitest";
import { countByDay, tally, withGaps } from "@/lib/charts";

describe("chart helpers", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("counts per day include empty days as zero and ignore out-of-range rows", () => {
    const r = countByDay(
      [
        "2026-10-28T01:00:00Z",
        "2026-10-28T09:00:00Z",
        "2026-10-26T09:00:00Z",
        "2026-09-01T00:00:00Z",
      ],
      3,
      "UTC",
      now,
    );
    expect(r).toEqual([
      { day: "2026-10-26", count: 1 },
      { day: "2026-10-27", count: 0 },
      { day: "2026-10-28", count: 2 },
    ]);
  });

  it("buckets by the senior's time zone, not UTC", () => {
    // 20:00 UTC on the 27th is already the 28th in Kolkata.
    const r = countByDay(["2026-10-27T20:00:00Z"], 2, "Asia/Kolkata", now);
    expect(r.at(-1)).toEqual({ day: "2026-10-28", count: 1 });
  });

  it("tally keeps every category, including zero", () => {
    expect(tally<"a" | "b" | "c">(["a", "a", "c"], ["a", "b", "c"])).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 0 },
      { key: "c", count: 1 },
    ]);
  });

  it("long gaps become null breaks, never zero values", () => {
    const d = 86_400_000;
    const r = withGaps(
      [
        { t: 10 * d, v: 70 },
        { t: 0, v: 72 },
        { t: d, v: 74 },
      ],
      3,
    );
    expect(r.map((p) => p.v)).toEqual([72, 74, null, 70]);
  });
});
