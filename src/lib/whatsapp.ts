// Sahaara WhatsApp Domain: Identity, Verification, Conversations, and Messaging.
// Pure domain schemas, security PIN hashing, shared-phone disambiguation, and idempotency logic.
// Follows Sahaara care-safety rules: no fake IDs, no unverified assumptions, no plaintext secrets.

import { z } from "zod";
import { normalizePhoneNumber } from "./phone";

// =========================================================================
// 1. Domain Constants & Types
// =========================================================================

export const WHATSAPP_RELATIONSHIP_TYPES = [
  "senior",
  "family_member",
  "coordinator",
  "caregiver",
  "other",
] as const;
export type WhatsAppRelationshipType = (typeof WHATSAPP_RELATIONSHIP_TYPES)[number];

export const WHATSAPP_IDENTITY_STATUSES = ["pending", "active", "revoked", "expired"] as const;
export type WhatsAppIdentityStatus = (typeof WHATSAPP_IDENTITY_STATUSES)[number];

export const WHATSAPP_VERIFICATION_METHODS = [
  "otp_pin",
  "coordinator_manual",
  "family_invitation",
] as const;
export type WhatsAppVerificationMethod = (typeof WHATSAPP_VERIFICATION_METHODS)[number];

export const WHATSAPP_CONSENT_STATUSES = ["granted", "withdrawn", "pending"] as const;
export type WhatsAppConsentStatus = (typeof WHATSAPP_CONSENT_STATUSES)[number];

export const WHATSAPP_CHALLENGE_STATUSES = [
  "pending",
  "verified",
  "expired",
  "exhausted",
  "revoked",
] as const;
export type WhatsAppChallengeStatus = (typeof WHATSAPP_CHALLENGE_STATUSES)[number];

export const WHATSAPP_CONVERSATION_STATUSES = ["active", "paused", "closed", "blocked"] as const;
export type WhatsAppConversationStatus = (typeof WHATSAPP_CONVERSATION_STATUSES)[number];

export const WHATSAPP_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type WhatsAppMessageDirection = (typeof WHATSAPP_MESSAGE_DIRECTIONS)[number];

export const WHATSAPP_MESSAGE_TYPES = [
  "text",
  "audio",
  "image",
  "document",
  "template",
  "system",
] as const;
export type WhatsAppMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];

export const WHATSAPP_PROVIDER_STATUSES = [
  "received",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "undelivered",
] as const;
export type WhatsAppProviderStatus = (typeof WHATSAPP_PROVIDER_STATUSES)[number];

export const WHATSAPP_PROCESSING_STATUSES = [
  "pending",
  "processed",
  "duplicate",
  "ignored",
  "failed",
] as const;
export type WhatsAppProcessingStatus = (typeof WHATSAPP_PROCESSING_STATUSES)[number];

// =========================================================================
// 2. Zod Validation Schemas
// =========================================================================

/**
 * Validates normalized E.164 phone numbers (e.g. +919876543210).
 */
export const e164PhoneSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      const res = normalizePhoneNumber(val);
      return res.ok;
    },
    { message: "Must be a valid international phone number in E.164 format with country code" },
  )
  .transform((val) => {
    const res = normalizePhoneNumber(val);
    if (!res.ok) throw new Error("Invalid phone number");
    return res.e164;
  });

/**
 * Input for creating a new WhatsApp verification challenge.
 */
export const createVerificationChallengeInput = z.object({
  orgId: z.string().uuid("Invalid organization ID"),
  seniorId: z.string().uuid("Invalid senior ID").optional(),
  targetUserId: z.string().uuid("Invalid target user ID").optional(),
  phoneNumber: e164PhoneSchema,
  relationshipType: z.enum(WHATSAPP_RELATIONSHIP_TYPES).default("family_member"),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  validityMinutes: z.number().int().min(5).max(60).default(15),
});
export type CreateVerificationChallengeInput = z.infer<typeof createVerificationChallengeInput>;

/**
 * Input for confirming a WhatsApp verification challenge using a 6-digit PIN.
 */
export const confirmVerificationChallengeInput = z.object({
  challengeId: z.string().uuid("Invalid challenge ID"),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Verification PIN must be exactly 6 digits"),
});
export type ConfirmVerificationChallengeInput = z.infer<typeof confirmVerificationChallengeInput>;

/**
 * Input for recording an inbound or outbound WhatsApp message (idempotent).
 */
export const recordWhatsAppMessageInput = z.object({
  orgId: z.string().uuid("Invalid organization ID"),
  conversationId: z.string().uuid("Invalid conversation ID"),
  whatsappIdentityId: z.string().uuid("Invalid identity ID").optional(),
  providerMessageSid: z
    .string()
    .trim()
    .min(8, "Provider Message SID too short")
    .max(80, "Provider Message SID too long")
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid provider Message SID format"),
  direction: z.enum(WHATSAPP_MESSAGE_DIRECTIONS),
  fromNumber: e164PhoneSchema,
  toNumber: e164PhoneSchema,
  messageType: z.enum(WHATSAPP_MESSAGE_TYPES).default("text"),
  bodyText: z.string().max(4000).optional().nullable(),
  mediaMeta: z.record(z.unknown()).default({}),
  providerStatus: z.enum(WHATSAPP_PROVIDER_STATUSES).default("received"),
  rawPayloadChecksum: z.string().length(64).optional().nullable(),
});
export type RecordWhatsAppMessageInput = z.infer<typeof recordWhatsAppMessageInput>;

/**
 * Input for revoking a WhatsApp phone identity.
 */
export const revokeWhatsAppIdentityInput = z.object({
  identityId: z.string().uuid("Invalid identity ID"),
  reason: z.string().trim().max(500, "Revocation reason too long").optional(),
});
export type RevokeWhatsAppIdentityInput = z.infer<typeof revokeWhatsAppIdentityInput>;

// =========================================================================
// 3. Cryptographic PIN Hashing & Verification (Zero Plaintext Secrets)
// =========================================================================

/**
 * Generates a random cryptographic hex salt.
 */
export function generateSalt(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates a cryptographically random 6-digit numeric PIN.
 */
export function generateSixDigitPin(): string {
  const randomUint32 = new Uint32Array(1);
  globalThis.crypto.getRandomValues(randomUint32);
  const val = randomUint32[0] ?? 0;
  const num = (val % 900000) + 100000;
  return num.toString();
}


/**
 * Pure, isomorphic SHA-256 implementation.
 * Zero Node.js or browser-specific dependencies.
 */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const words: number[] = [];
  const bitLength = bytes.length * 8;
  let result = "";
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    const wordIdx = i >> 2;
    const current = words[wordIdx] ?? 0;
    words[wordIdx] = current | ((bytes[i] ?? 0) << (((3 - i) % 4) * 8));
  }
  const endWordIdx = bytes.length >> 2;
  const currentEnd = words[endWordIdx] ?? 0;
  words[endWordIdx] = currentEnd | (0x80 << (((3 - bytes.length) % 4) * 8));

  while (((words.length * 4) % 64) !== 56) {
    words.push(0);
  }
  words.push((bitLength / maxWord) | 0);
  words.push(bitLength & 0xffffffff);

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = [...hash];
    hash = hash.slice(0, 8);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = i < 16 ? (w[i] ?? 0) : (((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0);

      const h0 = hash[0] ?? 0;
      const h1 = hash[1] ?? 0;
      const h2 = hash[2] ?? 0;
      const h3 = hash[3] ?? 0;
      const h4 = hash[4] ?? 0;
      const h5 = hash[5] ?? 0;
      const h6 = hash[6] ?? 0;
      const h7 = hash[7] ?? 0;
      const ki = k[i] ?? 0;
      const wi = w[i] ?? 0;

      const s1b = ((h4 >>> 6) | (h4 << 26)) ^ ((h4 >>> 11) | (h4 << 21)) ^ ((h4 >>> 25) | (h4 << 7));
      const ch = (h4 & h5) ^ (~h4 & h6);
      const temp1 = (h7 + s1b + ch + ki + wi) | 0;
      const s0b = ((h0 >>> 2) | (h0 << 30)) ^ ((h0 >>> 13) | (h0 << 19)) ^ ((h0 >>> 22) | (h0 << 10));
      const maj = (h0 & h1) ^ (h0 & h2) ^ (h1 & h2);
      const temp2 = (s0b + maj) | 0;

      hash = [(temp1 + temp2) | 0, h0, h1, h2, (h3 + temp1) | 0, h4, h5, h6];
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = ((hash[i] ?? 0) + (oldHash[i] ?? 0)) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = ((hash[i] ?? 0) >> (8 * j)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Computes a deterministic SHA-256 hex digest of salt + ":" + PIN.
 * Plaintext PINs are NEVER stored in the database.
 */
export function hashVerificationPin(pin: string, salt: string): string {
  const normalizedPin = pin.trim();
  const normalizedSalt = salt.trim();
  const data = `${normalizedSalt}:${normalizedPin}`;

  return sha256Hex(data);
}

/**
 * Timing-safe verification of a candidate PIN against stored salt and expected hash.
 */
export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  if (!pin || !salt || !expectedHash) return false;
  const computed = hashVerificationPin(pin, salt);

  return constantTimeEqual(computed, expectedHash);
}

// =========================================================================
// 4. Verification Challenge Lifecycle & Guard Helpers
// =========================================================================

export interface ChallengeStateCheck {
  status: WhatsAppChallengeStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string | Date;
}

export type ChallengeEvaluation =
  | { canAttempt: true; remainingAttempts: number }
  | {
      canAttempt: false;
      reason: "expired" | "exhausted" | "already_verified" | "revoked";
      message: string;
    };

/**
 * Evaluates whether a verification challenge can be attempted.
 */
export function evaluateChallengeState(
  challenge: ChallengeStateCheck,
  now: Date = new Date(),
): ChallengeEvaluation {
  if (challenge.status === "verified") {
    return {
      canAttempt: false,
      reason: "already_verified",
      message: "This challenge has already been verified and cannot be reused",
    };
  }

  if (challenge.status === "revoked") {
    return {
      canAttempt: false,
      reason: "revoked",
      message: "This verification challenge has been revoked",
    };
  }

  const expiryTime =
    challenge.expiresAt instanceof Date
      ? challenge.expiresAt.getTime()
      : new Date(challenge.expiresAt).getTime();

  if (now.getTime() > expiryTime || challenge.status === "expired") {
    return {
      canAttempt: false,
      reason: "expired",
      message: "The verification challenge has expired. A new code must be requested.",
    };
  }

  if (challenge.attempts >= challenge.maxAttempts || challenge.status === "exhausted") {
    return {
      canAttempt: false,
      reason: "exhausted",
      message: `Maximum verification attempts (${challenge.maxAttempts}) exceeded. Challenge locked.`,
    };
  }

  return {
    canAttempt: true,
    remainingAttempts: challenge.maxAttempts - challenge.attempts,
  };
}

// =========================================================================
// 5. Shared-Phone Disambiguation & Identity Resolution
// =========================================================================

export interface WhatsAppIdentityRecord {
  id: string;
  orgId: string;
  phoneNumber: string;
  seniorId: string | null;
  userId: string | null;
  relationshipType: WhatsAppRelationshipType;
  status: WhatsAppIdentityStatus;
  consentStatus: WhatsAppConsentStatus;
}

export type IdentityResolutionResult =
  | {
      status: "unique_match";
      identity: WhatsAppIdentityRecord;
    }
  | {
      status: "ambiguous";
      candidates: WhatsAppIdentityRecord[];
      message: string;
    }
  | {
      status: "no_active_identity";
      reason: "not_found" | "revoked" | "pending" | "consent_withdrawn";
      message: string;
    };

/**
 * Safely resolves an incoming phone number to an authorized identity.
 *
 * Care-Safety Rule:
 * A phone number must NOT automatically identify a senior just because it matches a stored number.
 * When a single number has multiple authorized relationships (e.g. shared family phone),
 * this function prevents unsafe assumptions and requires explicit disambiguation.
 */
export function resolvePhoneIdentity(
  records: WhatsAppIdentityRecord[],
  targetSeniorId?: string | null,
): IdentityResolutionResult {
  if (!records || records.length === 0) {
    return {
      status: "no_active_identity",
      reason: "not_found",
      message: "No registered WhatsApp identity found for this phone number",
    };
  }

  // Filter to active identities with granted consent
  const activeRecords = records.filter(
    (r) => r.status === "active" && r.consentStatus === "granted",
  );

  if (activeRecords.length === 0) {
    const hasConsentWithdrawn = records.some((r) => r.consentStatus === "withdrawn");
    if (hasConsentWithdrawn) {
      return {
        status: "no_active_identity",
        reason: "consent_withdrawn",
        message: "Consent for WhatsApp care coordination has been withdrawn",
      };
    }

    const hasRevoked = records.some((r) => r.status === "revoked");
    if (hasRevoked) {
      return {
        status: "no_active_identity",
        reason: "revoked",
        message: "The WhatsApp identity for this phone number has been revoked",
      };
    }

    return {
      status: "no_active_identity",
      reason: "pending",
      message: "The WhatsApp identity for this phone number is pending verification",
    };
  }

  // If a senior context is explicitly provided, filter by that senior
  if (targetSeniorId) {
    const seniorMatches = activeRecords.filter(
      (r) => r.seniorId === targetSeniorId || r.relationshipType === "coordinator",
    );

    if (seniorMatches.length === 1 && seniorMatches[0]) {
      return { status: "unique_match", identity: seniorMatches[0] };
    }

    if (seniorMatches.length > 1) {
      return {
        status: "ambiguous",
        candidates: seniorMatches,
        message:
          "Multiple active relationships exist for this phone number in the requested senior context",
      };
    }
  }

  // Single active identity matched
  if (activeRecords.length === 1 && activeRecords[0]) {
    return { status: "unique_match", identity: activeRecords[0] };
  }

  // Multiple active relationships exist (e.g. caregiver handles 2 seniors) -> Ambiguity must be handled safely!
  return {
    status: "ambiguous",
    candidates: activeRecords,
    message: `Phone number is linked to ${activeRecords.length} active seniors/roles. Disambiguation required.`,
  };
}

// =========================================================================
// 6. Idempotency Check & Payload Checksum
// =========================================================================

/**
 * Computes a SHA-256 checksum over incoming webhook payload contents
 * to detect exact retransmissions and payload tampering.
 */
export function computePayloadChecksum(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const canonicalString = sortedKeys.map((k) => `${k}:${String(payload[k] ?? "")}`).join("|");

  return sha256Hex(canonicalString);
}

// =========================================================================
// 7. Phone Number Privacy Masking
// =========================================================================

/**
 * Masks phone numbers to protect patient and family privacy in the UI.
 * e.g. +919876543210 -> +91 ••••• •3210
 *      +14155238886  -> +1 ••••• •8886
 */
export function maskPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.trim().length === 0) return "••••";
  const trimmed = phoneNumber.trim().replace(/^whatsapp:/i, "");
  if (!trimmed.startsWith("+")) {
    return trimmed.length > 5 ? `${trimmed.slice(0, 3)} •••• ${trimmed.slice(-4)}` : "••••";
  }

  const digits = trimmed.slice(1);
  let countryCode = "";
  let nationalNumber = "";

  if (digits.startsWith("1") || digits.startsWith("7")) {
    countryCode = "+" + digits.slice(0, 1);
    nationalNumber = digits.slice(1);
  } else {
    const two = digits.slice(0, 2);
    const twoNum = parseInt(two, 10);
    const isTwoDigit =
      twoNum === 20 ||
      twoNum === 27 ||
      (twoNum >= 30 && twoNum <= 34) ||
      twoNum === 36 ||
      twoNum === 39 ||
      twoNum === 40 ||
      twoNum === 41 ||
      (twoNum >= 43 && twoNum <= 49) ||
      (twoNum >= 51 && twoNum <= 58) ||
      (twoNum >= 60 && twoNum <= 66) ||
      (twoNum >= 81 && twoNum <= 84) ||
      twoNum === 86 ||
      (twoNum >= 90 && twoNum <= 95) ||
      twoNum === 98;

    if (isTwoDigit) {
      countryCode = "+" + two;
      nationalNumber = digits.slice(2);
    } else {
      countryCode = "+" + digits.slice(0, 3);
      nationalNumber = digits.slice(3);
    }
  }

  if (nationalNumber.length <= 4) {
    return `${countryCode} ••••`;
  }
  const lastFour = nationalNumber.slice(-4);
  return `${countryCode} ••••• •${lastFour}`;
}

// =========================================================================
// 8. Inbox Query & Mutation Schemas
// =========================================================================

export const CONVERSATION_FILTER_TYPES = ["all", "unread", "authorized", "pending"] as const;
export type ConversationFilterType = (typeof CONVERSATION_FILTER_TYPES)[number];

export const listConversationsInput = z.object({
  search: z.string().trim().default(""),
  filter: z.enum(CONVERSATION_FILTER_TYPES).default("all"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(30),
});
export type ListConversationsInput = z.infer<typeof listConversationsInput>;

export const getConversationDetailInput = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type GetConversationDetailInput = z.infer<typeof getConversationDetailInput>;

export const markConversationReadInput = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
});
export type MarkConversationReadInput = z.infer<typeof markConversationReadInput>;

export const sendWhatsAppMessageInput = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  bodyText: z.string().trim().min(1, "Message text cannot be empty").max(4096, "Message too long"),
  contentSid: z.string().trim().optional(),
  contentVariables: z.record(z.string()).optional(),
});
export type SendWhatsAppMessageInput = z.infer<typeof sendWhatsAppMessageInput>;

export const syncWhatsAppMessagesInput = z.object({
  limit: z.number().int().min(1).max(50).default(25),
});
export type SyncWhatsAppMessagesInput = z.infer<typeof syncWhatsAppMessagesInput>;

export const linkSeniorWhatsAppIdentityInput = z.object({
  seniorId: z.string().uuid("Invalid senior ID"),
  phoneNumber: e164PhoneSchema,
  displayName: z.string().trim().min(1, "Name is required").max(100),
  relationshipType: z.enum(WHATSAPP_RELATIONSHIP_TYPES).default("family_member"),
});
export type LinkSeniorWhatsAppIdentityInput = z.infer<typeof linkSeniorWhatsAppIdentityInput>;

export const getSeniorWhatsAppSummaryInput = z.object({
  seniorId: z.string().uuid("Invalid senior ID"),
});
export type GetSeniorWhatsAppSummaryInput = z.infer<typeof getSeniorWhatsAppSummaryInput>;

// =========================================================================
// 8. Shared UI Types (isomorphic for Client & Server)
// =========================================================================

export interface ConversationSummary {
  id: string;
  orgId: string;
  phoneNumber: string;
  maskedPhoneNumber: string;
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  identity: {
    id: string;
    displayName: string | null;
    relationshipType: string;
    status: string;
    consentStatus: string;
    verifiedAt: string | null;
  } | null;
  senior: {
    id: string;
    displayName: string;
    recordCode: string;
  } | null;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  providerMessageSid: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  messageType: string;
  bodyText: string | null;
  mediaMeta?: Record<string, unknown> | undefined;
  providerStatus: string;
  processingStatus: string;
  createdAt: string;
}
