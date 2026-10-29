// Inbound Twilio WhatsApp webhook handler (server-only).
// Validates Twilio HMAC-SHA1 signature, normalizes E.164 phone numbers,
// idempotently records messages, and returns standard TwiML (<Response/>).
// Never logs raw auth tokens, signatures, or sensitive care data.

import type { Json } from "@/integrations/supabase/types";
import {
  buildCanonicalWebhookUrl,
  getTwilioServerConfig,
  normalizePhoneNumber,
  validateTwilioWebhookDetailed,
} from "./twilio.server";
import { computePayloadChecksum } from "./whatsapp";
import { persistInboundWhatsAppMessage } from "./whatsapp.server";
import { processInboundWhatsAppMessageAI } from "./whatsapp-ai.server";

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
 * Parses application/x-www-form-urlencoded request body.
 */
export async function parseUrlEncodedBody(request: Request): Promise<Record<string, string>> {
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
export async function handleTwilioWhatsAppWebhook(request: Request): Promise<Response> {
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
        },
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

  // Extract optional media metadata if present
  const numMedia = parseInt(params["NumMedia"] || "0", 10);
  const mediaMeta: Record<string, Json> = {};
  if (numMedia > 0) {
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = params[`MediaUrl${i}`];
      if (mediaUrl) {
        mediaMeta[`media_${i}`] = {
          url: mediaUrl,
          contentType: params[`MediaContentType${i}`] || "application/octet-stream",
        };
      }
    }
  }

  // 3. Persist Message Idempotently via Server-Only Database Service
  try {
    const result = await persistInboundWhatsAppMessage({
      providerSid,
      fromNumber: fromNorm.e164,
      toNumber: toNorm.e164,
      bodyText,
      mediaMeta,
      profileName: params["ProfileName"] || null,
      payloadChecksum,
    });

    // 4. Clinical AI processing (Groq-driven intent routing, care routine logging, triage)
    if (!result.isDuplicate) {
      try {
        await processInboundWhatsAppMessageAI({
          messageId: result.messageId,
          providerSid,
          fromNumber: fromNorm.e164,
          toNumber: toNorm.e164,
          bodyText,
          conversationId: result.conversationId,
          orgId: result.orgId || "7e570000-0000-4000-8000-0000000000a1",
          seniorId: result.seniorId ?? null,
          identityId: result.identityId || "",
        });
      } catch (aiErr) {
        // AI processing failure must never drop or fail the webhook persistence
        console.error(
          "Inbound WhatsApp AI processing error:",
          aiErr instanceof Error ? aiErr.message : "AI Error",
        );
      }
    }

    return new Response(EMPTY_TWIML_RESPONSE, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  } catch (error) {
    console.error(
      "Error processing inbound WhatsApp webhook:",
      error instanceof Error ? error.message : "Persistence failure",
    );
    // Return retryable error 500 so Twilio retries rather than silently losing the message
    return new Response("Internal Server Error: Message persistence failed", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }
}
