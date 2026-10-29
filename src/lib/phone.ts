// Pure phone number normalization and WhatsApp address utilities.
// 100% isomorphic: runs identically in Browser, Node.js, Bun, and Cloudflare Workers.
// Has zero external dependencies or server-only SDK imports.

export type PhoneNumberFailureReason =
  | "empty"
  | "missing_country_code"
  | "invalid_country_code"
  | "invalid_characters"
  | "too_short"
  | "too_long";

/**
 * Result of phone number normalization.
 * IMPORTANT: A successful normalization confirms syntactic validity under ITU-T E.164 only.
 * Normalization must NEVER be equated with identity authorization or access granting.
 */
export type NormalizePhoneNumberResult =
  | {
      ok: true;
      /**
       * Standard E.164 format: e.g. "+14155552671" or "+919876543210"
       */
      e164: string;
      /**
       * Digits without the leading '+'
       */
      digits: string;
      /**
       * Whether the input arrived with a "whatsapp:" prefix
       */
      isWhatsApp: boolean;
      /**
       * Twilio-compatible WhatsApp address: "whatsapp:+14155552671"
       */
      whatsappAddress: string;
    }
  | {
      ok: false;
      reason: PhoneNumberFailureReason;
      message: string;
    };

/**
 * Normalizes an international phone number into standard E.164 format.
 *
 * Rules:
 * - Handles Twilio `whatsapp:` prefix case-insensitively.
 * - Strips acceptable punctuation (spaces, dashes, parentheses, dots).
 * - Requires a leading '+' with an international country code (1-999).
 * - Does NOT guess country codes when a number is ambiguous.
 * - Rejects non-numeric characters, numbers starting with '+0', and numbers outside E.164 bounds (7-15 digits).
 * - Preserves all meaningful international digits without truncation.
 */
export function normalizePhoneNumber(
  raw: string | null | undefined,
): NormalizePhoneNumberResult {
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      reason: "empty",
      message: "Phone number is empty or undefined",
    };
  }

  let trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "Phone number is empty",
    };
  }

  // Detect and strip Twilio whatsapp: prefix (case-insensitive)
  let isWhatsApp = false;
  if (/^whatsapp:/i.test(trimmed)) {
    isWhatsApp = true;
    trimmed = trimmed.replace(/^whatsapp:/i, "").trim();
  }

  if (trimmed.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "Phone number is empty after removing whatsapp prefix",
    };
  }

  // Require explicit leading '+'. Never guess or assume a default country code.
  if (!trimmed.startsWith("+")) {
    return {
      ok: false,
      reason: "missing_country_code",
      message:
        "Missing international country code (+). National numbers without country codes are ambiguous and must not be guessed.",
    };
  }

  // Check for invalid characters before cleaning punctuation.
  // Allowed punctuation: spaces, hyphens, parentheses, periods, and the initial '+'.
  const withoutAllowedPunctuation = trimmed.slice(1).replace(/[\s\-().]/g, "");

  if (/[^\d]/.test(withoutAllowedPunctuation)) {
    return {
      ok: false,
      reason: "invalid_characters",
      message: "Phone number contains non-digit characters",
    };
  }

  const digits = withoutAllowedPunctuation;

  // E.164 country codes cannot start with 0
  if (digits.startsWith("0")) {
    return {
      ok: false,
      reason: "invalid_country_code",
      message: "Country code cannot begin with 0",
    };
  }

  // ITU-T E.164 specifies maximum 15 digits; shortest valid international numbers are 7 digits
  if (digits.length < 7) {
    return {
      ok: false,
      reason: "too_short",
      message: `Phone number is too short (${digits.length} digits). Minimum E.164 length is 7 digits.`,
    };
  }

  if (digits.length > 15) {
    return {
      ok: false,
      reason: "too_long",
      message: `Phone number exceeds maximum E.164 length of 15 digits (${digits.length} digits).`,
    };
  }

  const e164 = `+${digits}`;

  return {
    ok: true,
    e164,
    digits,
    isWhatsApp,
    whatsappAddress: `whatsapp:${e164}`,
  };
}

/**
 * Helper to convert an E.164 number into a Twilio WhatsApp address.
 */
export function toWhatsAppAddress(e164Number: string): string {
  const normalized = normalizePhoneNumber(e164Number);
  if (!normalized.ok) {
    throw new Error(`Cannot convert invalid number to WhatsApp address: ${normalized.message}`);
  }
  return normalized.whatsappAddress;
}
