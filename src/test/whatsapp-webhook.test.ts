import { afterEach, beforeEach, describe, expect, it } from "vitest";
import twilio from "twilio";
const { getExpectedTwilioSignature } = twilio;
import { handleTwilioWhatsAppWebhook } from "@/lib/whatsapp-webhook.server";

describe("Phase 3: Inbound Twilio WhatsApp Webhook Endpoint", () => {
  const testToken = "mock_test_token_1234567890abcdef";
  const canonicalUrl = "https://saharaa-1.vercel.app/api/twilio/whatsapp";

  const validPayload: Record<string, string> = {
    AccountSid: "AC00000000000000000000000000000000",
    ApiVersion: "2010-04-01",
    Body: "Morning Metoprolol taken at 8:00 AM",
    From: "whatsapp:+919876543210",
    MessageSid: "SM99887766554433221100aabbccddeeff",
    NumMedia: "0",
    ProfileName: "Priya Sharma",
    SmsMessageSid: "SM99887766554433221100aabbccddeeff",
    SmsSid: "SM99887766554433221100aabbccddeeff",
    SmsStatus: "received",
    To: "whatsapp:+14155238886",
    WaId: "919876543210",
  };

  let prevToken: string | undefined;
  let prevAppUrl: string | undefined;

  beforeEach(() => {
    prevToken = process.env["TWILIO_AUTH_TOKEN"];
    prevAppUrl = process.env["APP_URL"];
    process.env["TWILIO_AUTH_TOKEN"] = testToken;
    process.env["APP_URL"] = "https://saharaa-1.vercel.app";
  });

  afterEach(() => {
    if (prevToken !== undefined) {
      process.env["TWILIO_AUTH_TOKEN"] = prevToken;
    } else {
      delete process.env["TWILIO_AUTH_TOKEN"];
    }

    if (prevAppUrl !== undefined) {
      process.env["APP_URL"] = prevAppUrl;
    } else {
      delete process.env["APP_URL"];
    }
  });

  function createSignedRequest(
    params: Record<string, string>,
    url = canonicalUrl,
    customSignature?: string | null,
  ): Request {
    const searchParams = new URLSearchParams(params);
    const body = searchParams.toString();
    const signature =
      customSignature !== undefined
        ? customSignature
        : getExpectedTwilioSignature(testToken, url, params);

    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (signature) {
      headers["x-twilio-signature"] = signature;
    }

    return new Request(url, {
      method: "POST",
      headers,
      body,
    });
  }

  it("returns 200 health status on GET requests", async () => {
    const req = new Request(canonicalUrl, { method: "GET" });
    const res = await handleTwilioWhatsAppWebhook(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.service).toBe("sahaara-whatsapp-webhook");
    expect(json.status).toBe("healthy");
    expect(json.twilioConfigured).toBe(true);
  });

  it("rejects unsupported HTTP methods (e.g. PUT, DELETE) with 405", async () => {
    const putReq = new Request(canonicalUrl, { method: "PUT" });
    const putRes = await handleTwilioWhatsAppWebhook(putReq);
    expect(putRes.status).toBe(405);

    const delReq = new Request(canonicalUrl, { method: "DELETE" });
    const delRes = await handleTwilioWhatsAppWebhook(delReq);
    expect(delRes.status).toBe(405);
  });

  it("rejects requests missing the x-twilio-signature header with 403 Forbidden", async () => {
    const req = createSignedRequest(validPayload, canonicalUrl, null);
    const res = await handleTwilioWhatsAppWebhook(req);

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Missing signature");
  });

  it("rejects requests with an invalid/tampered signature with 403 Forbidden", async () => {
    const req = createSignedRequest(validPayload, canonicalUrl, "invalid_forged_signature=");
    const res = await handleTwilioWhatsAppWebhook(req);

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Invalid signature");
  });

  it("rejects requests when payload parameters are tampered with 403 Forbidden", async () => {
    // Generate valid signature for original payload
    const signature = getExpectedTwilioSignature(testToken, canonicalUrl, validPayload);

    // Tamper the body parameter
    const tamperedPayload = { ...validPayload, Body: "TAMPERED: Medication NOT taken" };
    const searchParams = new URLSearchParams(tamperedPayload);

    const req = new Request(canonicalUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body: searchParams.toString(),
    });

    const res = await handleTwilioWhatsAppWebhook(req);
    expect(res.status).toBe(403);
  });

  it("accepts valid signed requests and returns 200 OK with XML TwiML", async () => {
    const req = createSignedRequest(validPayload);
    const res = await handleTwilioWhatsAppWebhook(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });

  it("rejects requests missing essential fields (From, To, or MessageSid) with 400 Bad Request", async () => {
    // Missing MessageSid (all aliases)
    const { MessageSid: _1, SmsMessageSid: _2, SmsSid: _3, ...missingSidPayload } = validPayload;
    const req = createSignedRequest(missingSidPayload);
    const res = await handleTwilioWhatsAppWebhook(req);

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Missing required message parameters");

    // Missing From
    const { From: _f, ...missingFromPayload } = validPayload;
    const fromReq = createSignedRequest(missingFromPayload);
    const fromRes = await handleTwilioWhatsAppWebhook(fromReq);
    expect(fromRes.status).toBe(400);
  });

  it("handles duplicate MessageSid deliveries idempotently without failing", async () => {
    // First delivery
    const req1 = createSignedRequest(validPayload);
    const res1 = await handleTwilioWhatsAppWebhook(req1);
    expect(res1.status).toBe(200);

    // Second delivery of identical payload & MessageSid
    const req2 = createSignedRequest(validPayload);
    const res2 = await handleTwilioWhatsAppWebhook(req2);
    expect(res2.status).toBe(200);
    const text = await res2.text();
    expect(text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });
});
