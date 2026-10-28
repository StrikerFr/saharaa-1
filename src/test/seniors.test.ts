import { describe, expect, it } from "vitest";
import {
  ageFrom,
  buildBaseline,
  buildObservation,
  createSeniorSchema,
  formatBaselineValue,
  formatInZone,
  formatObservationValue,
  isDelayedEntry,
  isValidPastDate,
  sanitizeSearch,
  type ObservationDraft,
} from "@/lib/seniors";

const now = new Date("2026-10-27T12:00:00Z");
const draft = (p: Partial<ObservationDraft>): ObservationDraft => ({
  type: "heart_rate",
  value1: "",
  value2: "",
  choice: "",
  note: "",
  observedAt: "2026-10-27T10:00",
  source: "manual_entry",
  ...p,
});

describe("senior profile validation", () => {
  const base = {
    recordCode: "sr-0042",
    displayName: "Synthetic Person",
    dateOfBirth: "",
    preferredLanguage: "hi" as const,
    timeZone: "Asia/Kolkata" as const,
    careStatus: "active" as const,
    communicationNotes: "",
    careContext: "",
    isSynthetic: true,
  };
  it("normalises record code to uppercase and empty optionals to null", () => {
    const r = createSeniorSchema.parse(base);
    expect(r.recordCode).toBe("SR-0042");
    expect(r.dateOfBirth).toBeNull();
    expect(r.communicationNotes).toBeNull();
  });
  it("rejects malformed record codes and over-long notes", () => {
    expect(createSeniorSchema.safeParse({ ...base, recordCode: "a b" }).success).toBe(false);
    expect(createSeniorSchema.safeParse({ ...base, careContext: "x".repeat(2001) }).success).toBe(
      false,
    );
  });
  it("rejects impossible and future birth dates", () => {
    expect(isValidPastDate("1940-02-30", now)).toBe(false);
    expect(isValidPastDate("2026-10-28", now)).toBe(false);
    expect(isValidPastDate("1940-02-29", now)).toBe(true);
  });
});

describe("age", () => {
  it("counts birthdays by calendar date", () => {
    expect(ageFrom("1950-10-27", new Date(2026, 9, 27))).toBe(76);
    expect(ageFrom("1950-10-28", new Date(2026, 9, 27))).toBe(75);
    expect(ageFrom(null)).toBeNull();
  });
});

describe("observation validation", () => {
  it("accepts a valid heart rate with unit bpm", () => {
    const r = buildObservation(draft({ value1: "72" }), now);
    expect(r.ok && r.value).toMatchObject({ value_numeric: 72, unit: "bpm", value_text: null });
  });
  it("never turns an empty value into zero", () => {
    const r = buildObservation(draft({ value1: "" }), now);
    expect(r.ok).toBe(false);
  });
  it("rejects out-of-range heart rate", () => {
    expect(buildObservation(draft({ value1: "300" }), now).ok).toBe(false);
  });
  it("requires systolic above diastolic", () => {
    expect(
      buildObservation(draft({ type: "blood_pressure", value1: "80", value2: "120" }), now).ok,
    ).toBe(false);
    expect(
      buildObservation(draft({ type: "blood_pressure", value1: "130", value2: "85" }), now).ok,
    ).toBe(true);
  });
  it("requires an explicit medication event — absence is not 'taken'", () => {
    expect(buildObservation(draft({ type: "medication_event" }), now).ok).toBe(false);
    expect(buildObservation(draft({ type: "medication_event", choice: "missed" }), now).ok).toBe(
      true,
    );
  });
  it("rejects future observed times", () => {
    expect(buildObservation(draft({ value1: "70", observedAt: "2026-10-30T10:00" }), now).ok).toBe(
      false,
    );
  });
  it("care notes need text", () => {
    expect(buildObservation(draft({ type: "care_note", note: " " }), now).ok).toBe(false);
  });
});

describe("display", () => {
  it("shows Not recorded instead of a value when data is missing", () => {
    expect(
      formatObservationValue({
        type: "weight",
        value_numeric: null,
        value_numeric_2: null,
        value_text: null,
        unit: "kg",
        note: null,
      }),
    ).toBe("Not recorded");
    expect(
      formatObservationValue({
        type: "blood_pressure",
        value_numeric: 130,
        value_numeric_2: 85,
        value_text: null,
        unit: "mmHg",
        note: null,
      }),
    ).toBe("130/85 mmHg");
  });
  it("renders instants in the senior's time zone", () => {
    expect(formatInZone("2026-10-27T20:00:00Z", "Asia/Kolkata")).toContain("28 Oct 2026");
  });
  it("flags entries made more than an hour after the event", () => {
    expect(isDelayedEntry("2026-10-27T08:00:00Z", "2026-10-27T10:00:00Z")).toBe(true);
    expect(isDelayedEntry("2026-10-27T08:00:00Z", "2026-10-27T08:10:00Z")).toBe(false);
  });
});

describe("baseline", () => {
  it("unknown carries no value; recorded requires one", () => {
    const u = buildBaseline(
      {
        field: "weight",
        status: "unknown",
        value1: "70",
        value2: "",
        choice: "",
        note: "",
        capturedAt: "2026-10-27T10:00",
        source: "manual_entry",
      },
      now,
    );
    expect(u.ok && u.value.value_numeric).toBeNull();
    const r = buildBaseline(
      {
        field: "weight",
        status: "recorded",
        value1: "",
        value2: "",
        choice: "",
        note: "",
        capturedAt: "2026-10-27T10:00",
        source: "manual_entry",
      },
      now,
    );
    expect(r.ok).toBe(false);
  });
  it("labels unknown and not applicable distinctly", () => {
    const b = {
      field: "hearing" as const,
      value_numeric: null,
      value_numeric_2: null,
      value_text: null,
    };
    expect(formatBaselineValue({ ...b, status: "unknown" })).toBe("Unknown");
    expect(formatBaselineValue({ ...b, status: "not_applicable" })).toBe("Not applicable");
  });
});

describe("search sanitising", () => {
  it("strips filter syntax characters", () => {
    expect(sanitizeSearch("a,b),or(id.eq.x")).toBe("a b or id eq x");
  });
});
