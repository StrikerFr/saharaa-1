// Inbound Twilio WhatsApp webhook handler (server-only).
// Validates Twilio HMAC-SHA1 signature, normalizes E.164 phone numbers,
// idempotently records messages, and returns standard TwiML (<Response/>).
// Never logs raw auth tokens, signatures, or sensitive care data.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildCanonicalWebhookUrl,
  getTwilioServerConfig,
  normalizePhoneNumber,
  validateTwilioWebhookDetailed,
} from "./twilio.server";
import { computePayloadChecksum } from "./whatsapp";

const WEBHOOK_PATH = "/api/twilio/whatsapp";

/**
 * Empty TwiML response telling Twilio the message was received successfully
 * without sending an immediate synchronous auto-reply.
 */
const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

export interface WebhookHandlerResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Creates a server-side Supabase admin client for webhook message recording.
 */
function getSupabaseAdmin() {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"] || "https://jiqvjuquxrsglradhhpo.supabase.co";
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SAHAARA_SERVICE_ROLE_KEY"];
  if (!key) {
    return null;
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Parses application/x-www-form-urlencoded request body.
 */
export async function parseUrlEncodedBody(
  request: Request
): Promise<Record<string, string>> {
  const text = await request.text();
  const params: Record<string, string> = {};
  if (!text || text.trim().length === 0) return params;

  const searchParams = new URLSearchParams(text);
  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

/**
 * Handles incoming Twilio WhatsApp webhook requests.
 */
export async function handleTwilioWhatsAppWebhook(
  request: Request
): Promise<Response> {
  // Only accept POST for incoming message webhooks
  if (request.method !== "POST") {
    // Return lightweight status check on GET for easy monitoring
    if (request.method === "GET") {
      let isConfigured = false;
      try {
        const cfg = getTwilioServerConfig();
        isConfigured = !!cfg.authToken;
      } catch {
        isConfigured = false;
      }

      return new Response(
        JSON.stringify({
          service: "sahaara-whatsapp-webhook",
          status: "healthy",
          method: "GET",
          twilioConfigured: isConfigured,
          endpoint: WEBHOOK_PATH,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, GET" },
    });
  }

  // 1. Signature & Security Validation
  let authToken: string;
  try {
    const config = getTwilioServerConfig();
    authToken = config.authToken;
  } catch {
    // Fail closed if Twilio is not configured on this server
    return new Response("Webhook not configured on server", { status: 500 });
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    return new Response("Forbidden: Missing signature header", { status: 403 });
  }

  // Parse application/x-www-form-urlencoded body
  let params: Record<string, string>;
  try {
    params = await parseUrlEncodedBody(request);
  } catch {
    return new Response("Bad Request: Malformed body", { status: 400 });
  }

  // Construct canonical URL using server-configured APP_URL
  const appUrl = process.env["APP_URL"] || "https://saharaa-1.vercel.app";
  let canonicalUrl: string;
  try {
    canonicalUrl = buildCanonicalWebhookUrl({
      pathname: WEBHOOK_PATH,
      configuredBaseUrl: appUrl,
      requestUrl: request.url,
      allowedHosts: ["saharaa-1.vercel.app", "localhost", "127.0.0.1"],
    });
  } catch {
    canonicalUrl = `${appUrl.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  }

  // Verify HMAC-SHA1 signature using official algorithm
  const validation = validateTwilioWebhookDetailed({
    url: canonicalUrl,
    params,
    signature,
    authToken,
  });

  if (!validation.valid) {
    // Fallback attempt: if canonical URL had a host mismatch due to local tunnel / proxy,
    // also validate against the exact incoming request.url
    const fallbackValidation = validateTwilioWebhookDetailed({
      url: request.url,
      params,
      signature,
      authToken,
    });

    if (!fallbackValidation.valid) {
      return new Response("Forbidden: Invalid signature", { status: 403 });
    }
  }

  // 2. Extract and Validate Inbound Message Fields
  const providerSid = params["MessageSid"] || params["SmsMessageSid"] || params["SmsSid"];
  const rawFrom = params["From"];
  const rawTo = params["To"];
  const bodyText = params["Body"] ?? "";

  if (!providerSid || !rawFrom || !rawTo) {
    return new Response("Bad Request: Missing required message parameters", {
      status: 400,
    });
  }

  // Normalize phone numbers to E.164
  const fromNorm = normalizePhoneNumber(rawFrom);
  const toNorm = normalizePhoneNumber(rawTo);

  if (!fromNorm.ok || !toNorm.ok) {
    return new Response("Bad Request: Invalid phone number format", { status: 400 });
  }

  // Compute payload checksum for idempotency & audit
  const payloadChecksum = computePayloadChecksum(params);

  // 3. Persist Message Idempotently via Supabase RPC or Direct Tables
  try {
    const supabase = getSupabaseAdmin();

    if (supabase) {
      // Default org ID (Sahaara Care Core / Test Demo Cohort)
      const defaultOrgId = "7e570000-0000-4000-8000-0000000000a1";

      // Attempt to invoke the idempotent database RPC function
      await supabase.rpc(
        "record_whatsapp_inbound_message" as never,
        {
          _org_id: defaultOrgId,
          _provider_sid: providerSid,
          _from_number: fromNorm.e164,
          _to_number: toNorm.e164,
          _body: bodyText,
          _media: {},
          _raw_checksum: payloadChecksum,
        } as never
      );
    }

    return new Response(EMPTY_TWIML_RESPONSE, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  } catch (error) {
    console.error("Error processing inbound WhatsApp webhook:", error instanceof Error ? error.message : "Unknown error");
    // Return 200 with empty TwiML to prevent Twilio exponential backoff storms while logging the error
    return new Response(EMPTY_TWIML_RESPONSE, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  }
}
