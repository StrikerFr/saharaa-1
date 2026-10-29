// Twilio WhatsApp security foundation and server utilities.
// Server-only: never expose credentials or execute on the client.
// Never logs credentials, signatures, request payloads, or patient PII.

import twilio from "twilio";
const { validateRequest } = twilio;

/**
 * Options for validating an incoming Twilio webhook signature.
 */
export interface ValidateTwilioWebhookOptions {
  /**
   * The exact externally visible canonical request URL (including protocol, host,
   * non-default port, and any query parameters).
   * Note: Do NOT trust arbitrary `x-forwarded-host` headers blindly to construct this.
   */
  url: string;

  /**
   * The value of the `X-Twilio-Signature` HTTP header from the incoming request.
   */
  signature?: string | null | undefined;

  /**
   * POST parameters parsed from `application/x-www-form-urlencoded`.
   */
  params?: Record<string, string | number | boolean | null | undefined> | undefined;

  /**
   * Server-side Twilio Auth Token. Defaults to process.env.TWILIO_AUTH_TOKEN.
   */
  authToken?: string | undefined;
}

/**
 * Failure reasons for Twilio webhook validation.
 * Notice: reasons are strictly structural/diagnostic and never expose secrets or payload data.
 */
export type WebhookValidationFailureReason =
  | "missing_auth_token"
  | "missing_signature"
  | "missing_url"
  | "invalid_url"
  | "signature_mismatch";

export type TwilioWebhookValidationResult =
  | { valid: true }
  | { valid: false; reason: WebhookValidationFailureReason };

/**
 * Normalizes POST parameters into clean string key-value pairs for Twilio's signature validator.
 */
function normalizeParams(
  rawParams?: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawParams || typeof rawParams !== "object") {
    return result;
  }

  for (const [key, value] of Object.entries(rawParams)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }

  return result;
}

/**
 * Validates an incoming Twilio webhook request with full structural diagnostics.
 * Always fails closed if the auth token, signature, or URL is missing or malformed.
 * Never logs credentials, signatures, or payload contents.
 */
export function validateTwilioWebhookDetailed(
  options: ValidateTwilioWebhookOptions
): TwilioWebhookValidationResult {
  const token = options.authToken ?? process.env["TWILIO_AUTH_TOKEN"];
  if (!token || typeof token !== "string" || !token.trim()) {
    return { valid: false, reason: "missing_auth_token" };
  }

  const signature = options.signature;
  if (!signature || typeof signature !== "string" || !signature.trim()) {
    return { valid: false, reason: "missing_signature" };
  }

  const rawUrl = options.url;
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { valid: false, reason: "missing_url" };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: "invalid_url" };
    }
  } catch {
    return { valid: false, reason: "invalid_url" };
  }

  const cleanParams = normalizeParams(options.params);

  try {
    const isValid = validateRequest(token.trim(), signature.trim(), rawUrl, cleanParams);
    if (isValid) {
      return { valid: true };
    }
    return { valid: false, reason: "signature_mismatch" };
  } catch {
    // Fail closed on any cryptographic or parsing error without exposing internal state.
    return { valid: false, reason: "signature_mismatch" };
  }
}

/**
 * Validates an incoming Twilio webhook request.
 * Supports both options object and positional arguments.
 *
 * Returns `true` only if the HMAC-SHA1 signature matches the canonical URL and POST parameters.
 * Fails closed (`false`) if any required component is missing or invalid.
 */
export function validateTwilioWebhook(options: ValidateTwilioWebhookOptions): boolean;
export function validateTwilioWebhook(
  authToken: string | undefined,
  signature: string | null | undefined,
  url: string,
  params?: Record<string, string | number | boolean | null | undefined>
): boolean;
export function validateTwilioWebhook(
  optionsOrAuthToken: ValidateTwilioWebhookOptions | string | undefined,
  signature?: string | null,
  url?: string,
  params?: Record<string, string | number | boolean | null | undefined>
): boolean {
  if (typeof optionsOrAuthToken === "object" && optionsOrAuthToken !== null) {
    return validateTwilioWebhookDetailed(optionsOrAuthToken).valid;
  }

  return validateTwilioWebhookDetailed({
    authToken: optionsOrAuthToken,
    signature,
    url: url ?? "",
    params,
  }).valid;
}

/**
 * Builds a trusted canonical webhook URL without trusting arbitrary `x-forwarded-*` headers.
 *
 * @param options.pathname The webhook path (e.g. "/api/twilio/webhook")
 * @param options.configuredBaseUrl Server-configured public origin (e.g. from process.env.APP_URL)
 * @param options.requestUrl Fallback request URL from the incoming HTTP Request object
 * @param options.allowedHosts Whitelist of permitted host headers if derived from requestUrl
 */
export function buildCanonicalWebhookUrl(options: {
  pathname: string;
  configuredBaseUrl?: string | undefined;
  requestUrl?: string | undefined;
  allowedHosts?: string[] | undefined;
}): string {
  const path = options.pathname.startsWith("/") ? options.pathname : `/${options.pathname}`;

  if (options.configuredBaseUrl && options.configuredBaseUrl.trim()) {
    const base = new URL(options.configuredBaseUrl.trim());
    return `${base.origin}${path}`;
  }

  if (options.requestUrl && options.requestUrl.trim()) {
    const parsed = new URL(options.requestUrl);
    if (options.allowedHosts && options.allowedHosts.length > 0) {
      const isAllowed = options.allowedHosts.some(
        (allowed) => allowed.toLowerCase() === parsed.host.toLowerCase()
      );
      if (!isAllowed) {
        throw new Error("Untrusted host header in request URL for canonical webhook validation");
      }
    }
    return `${parsed.origin}${path}${parsed.search}`;
  }

  throw new Error("Unable to construct canonical webhook URL: missing configuredBaseUrl and requestUrl");
}

/**
 * Typed failure reasons for phone number normalization.
 */
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
  raw: string | null | undefined
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

/**
 * Server-only Twilio configuration reader.
 * Fails closed if the required TWILIO_AUTH_TOKEN is not configured.
 */
export interface TwilioServerConfig {
  authToken: string;
  accountSid?: string | undefined;
  whatsappNumber?: string | undefined;
}

export function getTwilioServerConfig(
  env: Record<string, string | undefined> = process.env
): TwilioServerConfig {
  const authToken = env["TWILIO_AUTH_TOKEN"];
  if (!authToken || !authToken.trim()) {
    throw new Error("Missing required Twilio configuration: TWILIO_AUTH_TOKEN");
  }

  return {
    authToken: authToken.trim(),
    accountSid: env["TWILIO_ACCOUNT_SID"]?.trim(),
    whatsappNumber: env["TWILIO_WHATSAPP_NUMBER"]?.trim() || env["TWILIO_PHONE_NUMBER"]?.trim(),
  };
}
