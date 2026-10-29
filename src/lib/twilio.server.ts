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

export {
  normalizePhoneNumber,
  toWhatsAppAddress,
  type PhoneNumberFailureReason,
  type NormalizePhoneNumberResult,
} from "./phone";

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
