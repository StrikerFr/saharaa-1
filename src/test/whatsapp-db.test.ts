import { describe, expect, it } from "vitest";
import {
  computePayloadChecksum,
  confirmVerificationChallengeInput,
  createVerificationChallengeInput,
  e164PhoneSchema,
  evaluateChallengeState,
  generateSalt,
  generateSixDigitPin,
  hashVerificationPin,
  recordWhatsAppMessageInput,
  resolvePhoneIdentity,
  revokeWhatsAppIdentityInput,
  verifyPin,
  type WhatsAppIdentityRecord,
} from "@/lib/whatsapp";

describe("Phase 2B: WhatsApp Database & Identity Foundation", () => {
  const validOrgId = "7e570000-0000-4000-8000-0000000000a1";
  const otherOrgId = "8e570000-0000-4000-8000-0000000000b2";
  const validSeniorId = "ec348932-ca90-5457-aa49-34355dedd3c7";
  const otherSeniorId = "f04d791b-755d-5b24-8776-a62354e4de37";
  const validUserId = "b6a65591-e29c-4f63-acf4-b3ccdc977fdb";

  // -----------------------------------------------------------------------
  // 1. Phone Normalization & Schema Validation
  // -----------------------------------------------------------------------
  describe("Phone normalization and schema validation", () => {
    it("accepts and normalizes valid international E.164 numbers", () => {
      expect(e164PhoneSchema.parse("+91 98765 43210")).toBe("+919876543210");
      expect(e164PhoneSchema.parse("+1 (415) 555-2671")).toBe("+14155552671");
      expect(e164PhoneSchema.parse("whatsapp:+919876543210")).toBe("+919876543210");
    });

    it("rejects ambiguous national numbers without international country codes", () => {
      expect(() => e164PhoneSchema.parse("9876543210")).toThrow();
      expect(() => e164PhoneSchema.parse("(415) 555-2671")).toThrow();
      expect(() => e164PhoneSchema.parse("07911123456")).toThrow();
    });

    it("rejects malformed numbers, non-digits, or out-of-bound lengths", () => {
      expect(() => e164PhoneSchema.parse("+1415CALL267")).toThrow();
      expect(() => e164PhoneSchema.parse("+12345")).toThrow(); // too short
      expect(() => e164PhoneSchema.parse("+1234567890123456")).toThrow(); // too long
      expect(() => e164PhoneSchema.parse("+0123456789")).toThrow(); // invalid country code 0
    });
  });

  // -----------------------------------------------------------------------
  // 2. Cryptographic PIN Verification (Zero Plaintext Secrets)
  // -----------------------------------------------------------------------
  describe("Cryptographic PIN pairing & hashing", () => {
    it("generates 6-digit numeric PINs and secure salts", () => {
      const pin = generateSixDigitPin();
      expect(pin).toMatch(/^\d{6}$/);

      const salt = generateSalt(16);
      expect(salt).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });

    it("computes deterministic SHA-256 hash from PIN and salt", () => {
      const pin = "482910";
      const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
      const hash1 = hashVerificationPin(pin, salt);
      const hash2 = hashVerificationPin(pin, salt);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("verifies matching PINs using timing-safe comparison", () => {
      const pin = "654321";
      const salt = generateSalt();
      const expectedHash = hashVerificationPin(pin, salt);

      expect(verifyPin(pin, salt, expectedHash)).toBe(true);
      expect(verifyPin("000000", salt, expectedHash)).toBe(false);
      expect(verifyPin("654322", salt, expectedHash)).toBe(false);
    });

    it("rejects verification if any argument is empty or altered", () => {
      const pin = "123456";
      const salt = generateSalt();
      const expectedHash = hashVerificationPin(pin, salt);

      expect(verifyPin("", salt, expectedHash)).toBe(false);
      expect(verifyPin(pin, "", expectedHash)).toBe(false);
      expect(verifyPin(pin, salt, "")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Verification Challenge Lifecycle & Rate Limiting
  // -----------------------------------------------------------------------
  describe("Verification challenge lifecycle and rate limiting", () => {
    it("allows attempts on valid pending challenges", () => {
      const state = evaluateChallengeState({
        status: "pending",
        attempts: 1,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
      });

      expect(state).toEqual({
        canAttempt: true,
        remainingAttempts: 2,
      });
    });

    it("locks challenge when maximum attempts are exceeded (exhausted)", () => {
      const state = evaluateChallengeState({
        status: "pending",
        attempts: 3,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      expect(state.canAttempt).toBe(false);
      if (!state.canAttempt) {
        expect(state.reason).toBe("exhausted");
      }
    });

    it("rejects expired challenges", () => {
      const state = evaluateChallengeState({
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() - 60 * 1000), // 1 minute in the past
      });

      expect(state.canAttempt).toBe(false);
      if (!state.canAttempt) {
        expect(state.reason).toBe("expired");
      }
    });

    it("rejects reuse/replay of already-verified challenges", () => {
      const state = evaluateChallengeState({
        status: "verified",
        attempts: 1,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      expect(state.canAttempt).toBe(false);
      if (!state.canAttempt) {
        expect(state.reason).toBe("already_verified");
      }
    });

    it("rejects revoked challenges", () => {
      const state = evaluateChallengeState({
        status: "revoked",
        attempts: 0,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      expect(state.canAttempt).toBe(false);
      if (!state.canAttempt) {
        expect(state.reason).toBe("revoked");
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Shared-Phone Disambiguation & Identity Resolution
  // -----------------------------------------------------------------------
  describe("Shared-phone disambiguation & identity resolution", () => {
    const singleSeniorIdentity: WhatsAppIdentityRecord = {
      id: "identity-111",
      orgId: validOrgId,
      phoneNumber: "+919876543210",
      seniorId: validSeniorId,
      userId: validUserId,
      relationshipType: "family_member",
      status: "active",
      consentStatus: "granted",
    };

    const secondSeniorIdentity: WhatsAppIdentityRecord = {
      id: "identity-222",
      orgId: validOrgId,
      phoneNumber: "+919876543210", // SAME phone number!
      seniorId: otherSeniorId,
      userId: validUserId,
      relationshipType: "family_member",
      status: "active",
      consentStatus: "granted",
    };

    it("resolves unique active identity when a single senior link exists", () => {
      const res = resolvePhoneIdentity([singleSeniorIdentity]);
      expect(res).toEqual({
        status: "unique_match",
        identity: singleSeniorIdentity,
      });
    });

    it("flags ambiguity when multiple active relationships share the same phone", () => {
      // Care-Safety requirement: matching a phone number must NEVER automatically identify a senior
      const res = resolvePhoneIdentity([singleSeniorIdentity, secondSeniorIdentity]);
      expect(res.status).toBe("ambiguous");
      if (res.status === "ambiguous") {
        expect(res.candidates).toHaveLength(2);
        expect(res.candidates.map((c) => c.seniorId)).toEqual([validSeniorId, otherSeniorId]);
      }
    });

    it("resolves correctly when explicit senior context is provided for a shared phone", () => {
      const res = resolvePhoneIdentity([singleSeniorIdentity, secondSeniorIdentity], validSeniorId);
      expect(res).toEqual({
        status: "unique_match",
        identity: singleSeniorIdentity,
      });
    });

    it("blocks revoked phone associations from active routing", () => {
      const revokedIdentity: WhatsAppIdentityRecord = {
        ...singleSeniorIdentity,
        status: "revoked",
      };

      const res = resolvePhoneIdentity([revokedIdentity]);
      expect(res).toEqual({
        status: "no_active_identity",
        reason: "revoked",
        message: expect.stringContaining("revoked"),
      });
    });

    it("blocks pending phone associations before verification", () => {
      const pendingIdentity: WhatsAppIdentityRecord = {
        ...singleSeniorIdentity,
        status: "pending",
      };

      const res = resolvePhoneIdentity([pendingIdentity]);
      expect(res).toEqual({
        status: "no_active_identity",
        reason: "pending",
        message: expect.stringContaining("pending"),
      });
    });

    it("blocks routing if consent for WhatsApp coordination is withdrawn", () => {
      const withdrawnConsentIdentity: WhatsAppIdentityRecord = {
        ...singleSeniorIdentity,
        consentStatus: "withdrawn",
      };

      const res = resolvePhoneIdentity([withdrawnConsentIdentity]);
      expect(res).toEqual({
        status: "no_active_identity",
        reason: "consent_withdrawn",
        message: expect.stringContaining("withdrawn"),
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. Unique Message SID Enforcement & Idempotency
  // -----------------------------------------------------------------------
  describe("Message SID uniqueness & idempotency checksums", () => {
    it("validates valid Twilio Message SID format", () => {
      const validSid = "SM1234567890abcdef1234567890abcdef";
      const parsed = recordWhatsAppMessageInput.parse({
        orgId: validOrgId,
        conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        providerMessageSid: validSid,
        direction: "inbound",
        fromNumber: "+919876543210",
        toNumber: "+14155238886",
        bodyText: "Blood pressure is 120/80 mmHg",
      });

      expect(parsed.providerMessageSid).toBe(validSid);
      expect(parsed.fromNumber).toBe("+919876543210");
    });

    it("rejects invalid or blank Message SIDs", () => {
      expect(() =>
        recordWhatsAppMessageInput.parse({
          orgId: validOrgId,
          conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          providerMessageSid: "short", // < 8 chars
          direction: "inbound",
          fromNumber: "+919876543210",
          toNumber: "+14155238886",
        }),
      ).toThrow();
    });

    it("computes deterministic payload checksums for idempotency verification", () => {
      const payload1 = {
        From: "whatsapp:+919876543210",
        To: "whatsapp:+14155238886",
        Body: "Taken morning tablet",
        MessageSid: "SM12345",
      };
      // Different key order, same content
      const payload2 = {
        MessageSid: "SM12345",
        Body: "Taken morning tablet",
        To: "whatsapp:+14155238886",
        From: "whatsapp:+919876543210",
      };

      const check1 = computePayloadChecksum(payload1);
      const check2 = computePayloadChecksum(payload2);

      expect(check1).toBe(check2);
      expect(check1).toHaveLength(64);
    });

    it("detects payload modification under identical Message SID", () => {
      const original = { MessageSid: "SM12345", Body: "Medication taken" };
      const tampered = { MessageSid: "SM12345", Body: "Medication NOT taken" };

      expect(computePayloadChecksum(original)).not.toBe(computePayloadChecksum(tampered));
    });
  });

  // -----------------------------------------------------------------------
  // 6. Organization & Relationship Isolation Rules
  // -----------------------------------------------------------------------
  describe("Multi-tenant organization & relationship authorization", () => {
    it("validates that challenge creation requires valid org and senior UUIDs", () => {
      const valid = createVerificationChallengeInput.parse({
        orgId: validOrgId,
        seniorId: validSeniorId,
        phoneNumber: "+919876543210",
        relationshipType: "family_member",
      });
      expect(valid.orgId).toBe(validOrgId);
      expect(valid.phoneNumber).toBe("+919876543210");

      expect(() =>
        createVerificationChallengeInput.parse({
          orgId: "not-a-uuid",
          phoneNumber: "+919876543210",
        }),
      ).toThrow();
    });

    it("validates confirmation input requires 6-digit PIN", () => {
      const valid = confirmVerificationChallengeInput.parse({
        challengeId: "11111111-1111-4111-a111-111111111111",
        pin: "582910",
      });
      expect(valid.pin).toBe("582910");

      expect(() =>
        confirmVerificationChallengeInput.parse({
          challengeId: "11111111-1111-4111-a111-111111111111",
          pin: "123", // too short
        }),
      ).toThrow();

      expect(() =>
        confirmVerificationChallengeInput.parse({
          challengeId: "11111111-1111-4111-a111-111111111111",
          pin: "12345a", // non-digit
        }),
      ).toThrow();
    });

    it("validates revocation input requires valid identity ID", () => {
      const valid = revokeWhatsAppIdentityInput.parse({
        identityId: "11111111-1111-4111-a111-111111111111",
        reason: "Family requested phone number change",
      });
      expect(valid.reason).toBe("Family requested phone number change");

      expect(() =>
        revokeWhatsAppIdentityInput.parse({
          identityId: "not-a-uuid",
        }),
      ).toThrow();
    });
  });
});
