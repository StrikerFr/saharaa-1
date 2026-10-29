import { describe, expect, it } from "vitest";
import {
  acceptFamilyInviteInput,
  createFamilyInviteInput,
  formatFamilyDate,
  RELATIONSHIP_LABELS,
  respondFamilyTaskInput,
  submitFamilyReportInput,
} from "@/lib/family";
import { hashToken } from "@/lib/family.functions";

describe("Phase 9: Family Portal Domain & Validation", () => {
  describe("Token hashing and security", () => {
    it("generates deterministic SHA-256 hashes", () => {
      const token = "a".repeat(48);
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("trims whitespace before hashing", () => {
      const raw = "test-token-value-1234567890";
      expect(hashToken(`  ${raw}  `)).toBe(hashToken(raw));
    });

    it("different tokens generate distinct hashes", () => {
      const h1 = hashToken("token-alpha-1234567890");
      const h2 = hashToken("token-beta-1234567890");
      expect(h1).not.toBe(h2);
    });
  });

  describe("Invitation input validation", () => {
    const validSeniorId = "11111111-1111-4111-8111-111111111111";

    it("accepts a valid invite input", () => {
      const parsed = createFamilyInviteInput.safeParse({
        seniorId: validSeniorId,
        email: "caregiver@example.com",
        relationship: "Daughter",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.email).toBe("caregiver@example.com");
        expect(parsed.data.relationship).toBe("Daughter");
      }
    });

    it("normalises emails to lowercase and trims", () => {
      const parsed = createFamilyInviteInput.parse({
        seniorId: validSeniorId,
        email: "  Family.Member@Domain.COM  ",
        relationship: "Son",
      });
      expect(parsed.email).toBe("family.member@domain.com");
    });

    it("rejects invalid emails", () => {
      const parsed = createFamilyInviteInput.safeParse({
        seniorId: validSeniorId,
        email: "not-an-email",
        relationship: "Spouse",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects invalid UUIDs", () => {
      const parsed = createFamilyInviteInput.safeParse({
        seniorId: "not-a-uuid",
        email: "valid@example.com",
        relationship: "Daughter",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects unsupported relationship labels", () => {
      const parsed = createFamilyInviteInput.safeParse({
        seniorId: validSeniorId,
        email: "valid@example.com",
        relationship: "Random Acquaintance",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("Invitation acceptance input validation", () => {
    it("accepts valid token", () => {
      const parsed = acceptFamilyInviteInput.safeParse({
        token: "1234567890abcdef1234567890",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects empty or excessively short token", () => {
      expect(acceptFamilyInviteInput.safeParse({ token: "" }).success).toBe(false);
      expect(acceptFamilyInviteInput.safeParse({ token: "short" }).success).toBe(false);
    });
  });

  describe("Family task response validation", () => {
    const validTaskId = "22222222-2222-4222-8222-222222222222";

    it("accepts a thoughtful family response", () => {
      const parsed = respondFamilyTaskInput.safeParse({
        taskId: validTaskId,
        response: "I will visit dad tomorrow morning and ensure his BP monitor batteries are replaced.",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects blank or whitespace-only response", () => {
      expect(respondFamilyTaskInput.safeParse({ taskId: validTaskId, response: "   " }).success).toBe(false);
    });

    it("rejects response exceeding 1000 characters", () => {
      const longResponse = "x".repeat(1001);
      expect(respondFamilyTaskInput.safeParse({ taskId: validTaskId, response: longResponse }).success).toBe(false);
    });
  });

  describe("Family report & voice note submission validation", () => {
    const validSeniorId = "11111111-1111-4111-8111-111111111111";
    const validRequestId = "33333333-3333-4333-8333-333333333333";

    it("accepts valid typed report without audio", () => {
      const parsed = submitFamilyReportInput.safeParse({
        seniorId: validSeniorId,
        text: "Mother was cheerful today. She ate all her lunch and took her afternoon medications.",
        clientRequestId: validRequestId,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.rawTranscript).toBeUndefined();
      }
    });

    it("accepts audio voice note report with transcript", () => {
      const parsed = submitFamilyReportInput.safeParse({
        seniorId: validSeniorId,
        text: "Checked in on dad. He seemed slightly dizzy in the morning, but improved after drinking water.",
        rawTranscript: "Checked on dad he seemed dizzy in the morning but improved after water",
        durationSeconds: 24,
        clientRequestId: validRequestId,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.durationSeconds).toBe(24);
      }
    });

    it("rejects empty text", () => {
      const parsed = submitFamilyReportInput.safeParse({
        seniorId: validSeniorId,
        text: "   ",
        clientRequestId: validRequestId,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects report text exceeding 4000 characters", () => {
      const longText = "a".repeat(4001);
      const parsed = submitFamilyReportInput.safeParse({
        seniorId: validSeniorId,
        text: longText,
        clientRequestId: validRequestId,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("Date and time formatting in senior time zone", () => {
    it("formats ISO string nicely in Asia/Kolkata", () => {
      const iso = "2026-10-29T10:30:00Z";
      const formatted = formatFamilyDate(iso, "Asia/Kolkata");
      expect(formatted).toContain("Oct");
      expect(formatted).toContain("2026");
    });

    it("handles null or missing time gracefully", () => {
      expect(formatFamilyDate(null)).toBe("Recently");
      expect(formatFamilyDate(undefined)).toBe("Recently");
    });

    it("handles invalid date strings without crashing", () => {
      expect(formatFamilyDate("not-a-valid-date")).toBe("Recently");
    });
  });

  describe("Relationship options integrity", () => {
    it("provides the documented relationship roles", () => {
      expect(RELATIONSHIP_LABELS).toContain("Daughter");
      expect(RELATIONSHIP_LABELS).toContain("Son");
      expect(RELATIONSHIP_LABELS).toContain("Spouse / Partner");
      expect(RELATIONSHIP_LABELS).toContain("Primary Caregiver");
      expect(RELATIONSHIP_LABELS).toContain("Legal Guardian");
      expect(RELATIONSHIP_LABELS.length).toBeGreaterThanOrEqual(7);
    });
  });
});
