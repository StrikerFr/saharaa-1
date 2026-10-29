import { describe, expect, it } from "vitest";
import twilio from "twilio";
const { getExpectedTwilioSignature } = twilio;
import {
  buildCanonicalWebhookUrl,
  getTwilioServerConfig,
  normalizePhoneNumber,
  toWhatsAppAddress,
  validateTwilioWebhook,
  validateTwilioWebhookDetailed,
} from "@/lib/twilio.server";

describe("Twilio Webhook Signature Validation", () => {
  // Official Twilio Documentation Test Vector
  // URL: https://mycompany.com/myapp.php?foo=1&bar=2
  // Auth Token: 12345
  // Params: { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" }
  // Expected Signature: "GvWf1cFY/Q7PnoempGyD5oXAezc="
  const officialUrl = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const officialToken = "12345";
  const officialParams = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
    From: "+14158675310",
    To: "+18005551212",
  };
  const officialSignature = "GvWf1cFY/Q7PnoempGyD5oXAezc=";

  it("verifies the official Twilio documentation test vector signature", () => {
    // Assert SDK calculation matches the official known signature vector
    const calculated = getExpectedTwilioSignature(officialToken, officialUrl, officialParams);
    expect(calculated).toBe(officialSignature);

    // Validate using options object
    const isValidObj = validateTwilioWebhook({
      authToken: officialToken,
      url: officialUrl,
      signature: officialSignature,
      params: officialParams,
    });
    expect(isValidObj).toBe(true);

    // Validate using positional overload
    const isValidPos = validateTwilioWebhook(
      officialToken,
      officialSignature,
      officialUrl,
      officialParams
    );
    expect(isValidPos).toBe(true);

    const detailed = validateTwilioWebhookDetailed({
      authToken: officialToken,
      url: officialUrl,
      signature: officialSignature,
      params: officialParams,
    });
    expect(detailed).toEqual({ valid: true });
  });

  it("verifies webhook with process.env.TWILIO_AUTH_TOKEN when not explicitly provided", () => {
    const prevEnv = process.env["TWILIO_AUTH_TOKEN"];
    try {
      process.env["TWILIO_AUTH_TOKEN"] = officialToken;
      const isValid = validateTwilioWebhook({
        url: officialUrl,
        signature: officialSignature,
        params: officialParams,
      });
      expect(isValid).toBe(true);
    } finally {
      if (prevEnv !== undefined) {
        process.env["TWILIO_AUTH_TOKEN"] = prevEnv;
      } else {
        delete process.env["TWILIO_AUTH_TOKEN"];
      }
    }
  });

  it("rejects invalid signature string", () => {
    const isInvalid = validateTwilioWebhook({
      authToken: officialToken,
      url: officialUrl,
      signature: "tampered_signature_value=",
      params: officialParams,
    });
    expect(isInvalid).toBe(false);

    const detailed = validateTwilioWebhookDetailed({
      authToken: officialToken,
      url: officialUrl,
      signature: "tampered_signature_value=",
      params: officialParams,
    });
    expect(detailed).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects missing or empty signature", () => {
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: null,
        params: officialParams,
      })
    ).toBe(false);

    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: "",
        params: officialParams,
      })
    ).toBe(false);

    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: "   ",
        params: officialParams,
      })
    ).toBe(false);

    const detailed = validateTwilioWebhookDetailed({
      authToken: officialToken,
      url: officialUrl,
      signature: null,
      params: officialParams,
    });
    expect(detailed).toEqual({ valid: false, reason: "missing_signature" });
  });

  it("rejects modified body parameters", () => {
    // Parameter altered
    const alteredParams = { ...officialParams, Digits: "9999" };
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: officialSignature,
        params: alteredParams,
      })
    ).toBe(false);

    // Extra injected parameter
    const injectedParams = { ...officialParams, InjectedField: "malicious" };
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: officialSignature,
        params: injectedParams,
      })
    ).toBe(false);

    // Missing required parameter
    const { Digits: _, ...omittedParams } = officialParams;
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: officialUrl,
        signature: officialSignature,
        params: omittedParams,
      })
    ).toBe(false);
  });

  it("rejects incorrect canonical URL (query string, protocol, or path tampering)", () => {
    // Modified query string
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: "https://mycompany.com/myapp.php?foo=1&bar=TAMPERED",
        signature: officialSignature,
        params: officialParams,
      })
    ).toBe(false);

    // Modified path
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: "https://mycompany.com/different-endpoint?foo=1&bar=2",
        signature: officialSignature,
        params: officialParams,
      })
    ).toBe(false);

    // Protocol downgraded from https to http
    expect(
      validateTwilioWebhook({
        authToken: officialToken,
        url: "http://mycompany.com/myapp.php?foo=1&bar=2",
        signature: officialSignature,
        params: officialParams,
      })
    ).toBe(false);

    // Completely malformed URL string
    const detailed = validateTwilioWebhookDetailed({
      authToken: officialToken,
      url: "not-a-valid-url",
      signature: officialSignature,
      params: officialParams,
    });
    expect(detailed).toEqual({ valid: false, reason: "invalid_url" });
  });

  it("fails closed when server-side auth token is missing or empty", () => {
    const prevEnv = process.env["TWILIO_AUTH_TOKEN"];
    delete process.env["TWILIO_AUTH_TOKEN"];
    try {
      expect(
        validateTwilioWebhook({
          authToken: "",
          url: officialUrl,
          signature: officialSignature,
          params: officialParams,
        })
      ).toBe(false);

      expect(
        validateTwilioWebhook({
          authToken: "   ",
          url: officialUrl,
          signature: officialSignature,
          params: officialParams,
        })
      ).toBe(false);

      const detailed = validateTwilioWebhookDetailed({
        url: officialUrl,
        signature: officialSignature,
        params: officialParams,
      });
      expect(detailed).toEqual({ valid: false, reason: "missing_auth_token" });
    } finally {
      if (prevEnv !== undefined) {
        process.env["TWILIO_AUTH_TOKEN"] = prevEnv;
      }
    }
  });

  it("validates dynamic incoming WhatsApp webhook payload", () => {
    const token = "mock_secret_auth_token_98765";
    const webhookUrl = "https://sahaara.care/api/twilio/whatsapp";
    const whatsAppParams = {
      AccountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ApiVersion: "2010-04-01",
      Body: "Metoprolol taken at 8:00 AM",
      From: "whatsapp:+919876543210",
      MessageSid: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      NumMedia: "0",
      ProfileName: "Priya Sharma",
      SmsMessageSid: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      SmsSid: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      SmsStatus: "received",
      To: "whatsapp:+14155238886",
      WaId: "919876543210",
    };

    const signature = getExpectedTwilioSignature(token, webhookUrl, whatsAppParams);

    // Verified with computed valid signature
    expect(
      validateTwilioWebhook({
        authToken: token,
        url: webhookUrl,
        signature,
        params: whatsAppParams,
      })
    ).toBe(true);

    // Fails if body message is altered
    expect(
      validateTwilioWebhook({
        authToken: token,
        url: webhookUrl,
        signature,
        params: { ...whatsAppParams, Body: "Metoprolol NOT taken" },
      })
    ).toBe(false);
  });
});

describe("Canonical Webhook URL Construction", () => {
  it("uses configured base URL over untrusted host headers", () => {
    const canonical = buildCanonicalWebhookUrl({
      pathname: "/api/twilio/whatsapp",
      configuredBaseUrl: "https://sahaara-care.vercel.app",
      requestUrl: "http://malicious-forwarder.com/ignored",
    });
    expect(canonical).toBe("https://sahaara-care.vercel.app/api/twilio/whatsapp");
  });

  it("validates host whitelist when constructed from incoming request URL", () => {
    const canonical = buildCanonicalWebhookUrl({
      pathname: "/api/twilio/whatsapp",
      requestUrl: "https://api.sahaara.care/api/twilio/whatsapp?channel=inbound",
      allowedHosts: ["api.sahaara.care", "sahaara-care.vercel.app"],
    });
    expect(canonical).toBe("https://api.sahaara.care/api/twilio/whatsapp?channel=inbound");
  });

  it("rejects untrusted host header when whitelist does not match", () => {
    expect(() =>
      buildCanonicalWebhookUrl({
        pathname: "/api/twilio/whatsapp",
        requestUrl: "https://evil-attacker.com/api/twilio/whatsapp",
        allowedHosts: ["api.sahaara.care"],
      })
    ).toThrow("Untrusted host header");
  });
});

describe("Twilio Server Configuration", () => {
  it("reads server configuration from environment", () => {
    const cfg = getTwilioServerConfig({
      TWILIO_AUTH_TOKEN: "valid_token_xyz",
      TWILIO_ACCOUNT_SID: "AC1234567890",
      TWILIO_WHATSAPP_NUMBER: "whatsapp:+14155238886",
    });
    expect(cfg.authToken).toBe("valid_token_xyz");
    expect(cfg.accountSid).toBe("AC1234567890");
    expect(cfg.whatsappNumber).toBe("whatsapp:+14155238886");
  });

  it("fails closed when TWILIO_AUTH_TOKEN is missing", () => {
    expect(() => getTwilioServerConfig({})).toThrow("TWILIO_AUTH_TOKEN");
  });
});

describe("Phone Number Normalization (E.164)", () => {
  it("normalizes valid standard E.164 numbers", () => {
    const us = normalizePhoneNumber("+14155552671");
    expect(us).toEqual({
      ok: true,
      e164: "+14155552671",
      digits: "14155552671",
      isWhatsApp: false,
      whatsappAddress: "whatsapp:+14155552671",
    });

    const india = normalizePhoneNumber("+919876543210");
    expect(india).toEqual({
      ok: true,
      e164: "+919876543210",
      digits: "919876543210",
      isWhatsApp: false,
      whatsappAddress: "whatsapp:+919876543210",
    });

    const uk = normalizePhoneNumber("+442079460919");
    expect(uk.ok).toBe(true);
    if (uk.ok) {
      expect(uk.e164).toBe("+442079460919");
    }
  });

  it("strips whatsapp: prefix case-insensitively and tags isWhatsApp", () => {
    const lower = normalizePhoneNumber("whatsapp:+919876543210");
    expect(lower).toEqual({
      ok: true,
      e164: "+919876543210",
      digits: "919876543210",
      isWhatsApp: true,
      whatsappAddress: "whatsapp:+919876543210",
    });

    const upper = normalizePhoneNumber("WHATSAPP:+14155552671");
    expect(upper.ok).toBe(true);
    if (upper.ok) {
      expect(upper.isWhatsApp).toBe(true);
      expect(upper.e164).toBe("+14155552671");
    }

    const mixed = normalizePhoneNumber("WhatsApp:+447911123456");
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.isWhatsApp).toBe(true);
      expect(mixed.e164).toBe("+447911123456");
    }
  });

  it("strips standard formatting punctuation (spaces, dashes, parentheses, periods)", () => {
    const spaced = normalizePhoneNumber("+91 98765 43210");
    expect(spaced.ok).toBe(true);
    if (spaced.ok) expect(spaced.e164).toBe("+919876543210");

    const usFormatted = normalizePhoneNumber("+1 (415) 555-2671");
    expect(usFormatted.ok).toBe(true);
    if (usFormatted.ok) expect(usFormatted.e164).toBe("+14155552671");

    const dashed = normalizePhoneNumber("+44-20-7946-0919");
    expect(dashed.ok).toBe(true);
    if (dashed.ok) expect(dashed.e164).toBe("+442079460919");

    const dotted = normalizePhoneNumber("+33.1.42.68.55.55");
    expect(dotted.ok).toBe(true);
    if (dotted.ok) expect(dotted.e164).toBe("+33142685555");

    const formattedWhatsApp = normalizePhoneNumber("whatsapp:+91 (987) 654-3210");
    expect(formattedWhatsApp.ok).toBe(true);
    if (formattedWhatsApp.ok) {
      expect(formattedWhatsApp.e164).toBe("+919876543210");
      expect(formattedWhatsApp.isWhatsApp).toBe(true);
    }
  });

  it("rejects ambiguous numbers missing international country code without guessing", () => {
    // 10-digit Indian mobile number without +91
    const inRes = normalizePhoneNumber("9876543210");
    expect(inRes).toEqual({
      ok: false,
      reason: "missing_country_code",
      message: expect.stringContaining("Missing international country code (+)"),
    });

    // US 10-digit number without +1
    const usRes = normalizePhoneNumber("(415) 555-2671");
    expect(usRes).toEqual({
      ok: false,
      reason: "missing_country_code",
      message: expect.stringContaining("Missing international country code (+)"),
    });

    // UK national trunk prefix 07...
    const ukRes = normalizePhoneNumber("07911123456");
    expect(ukRes).toEqual({
      ok: false,
      reason: "missing_country_code",
      message: expect.stringContaining("Missing international country code (+)"),
    });
  });

  it("rejects numbers starting with invalid country code (+0)", () => {
    const res = normalizePhoneNumber("+0123456789");
    expect(res).toEqual({
      ok: false,
      reason: "invalid_country_code",
      message: expect.stringContaining("Country code cannot begin with 0"),
    });
  });

  it("rejects invalid characters, letters, or symbols", () => {
    const letters = normalizePhoneNumber("+1415555CALL");
    expect(letters).toEqual({
      ok: false,
      reason: "invalid_characters",
      message: expect.stringContaining("contains non-digit characters"),
    });

    const symbols = normalizePhoneNumber("+1415555#123");
    expect(symbols).toEqual({
      ok: false,
      reason: "invalid_characters",
      message: expect.stringContaining("contains non-digit characters"),
    });
  });

  it("rejects numbers outside E.164 length limits (7-15 digits)", () => {
    // Too short (6 digits)
    const shortRes = normalizePhoneNumber("+123456");
    expect(shortRes).toEqual({
      ok: false,
      reason: "too_short",
      message: expect.stringContaining("too short"),
    });

    // Too long (16 digits)
    const longRes = normalizePhoneNumber("+1234567890123456");
    expect(longRes).toEqual({
      ok: false,
      reason: "too_long",
      message: expect.stringContaining("exceeds maximum E.164 length"),
    });

    // Boundary check: 7 digits is valid
    const minValid = normalizePhoneNumber("+2901234");
    expect(minValid.ok).toBe(true);

    // Boundary check: 15 digits is valid
    const maxValid = normalizePhoneNumber("+123456789012345");
    expect(maxValid.ok).toBe(true);
  });

  it("rejects empty or whitespace inputs", () => {
    expect(normalizePhoneNumber("")).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });

    expect(normalizePhoneNumber("    ")).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });

    expect(normalizePhoneNumber(null)).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });

    expect(normalizePhoneNumber(undefined)).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });

    expect(normalizePhoneNumber("whatsapp:")).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });
  });

  it("preserves every meaningful international digit without accidental removal", () => {
    // Digits with internal zeroes must NEVER drop the zeroes
    const internalZeroes = "+442001230040";
    const res = normalizePhoneNumber(internalZeroes);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.e164).toBe(internalZeroes);
      expect(res.digits).toBe("442001230040");
      expect(res.digits.length).toBe(12);
    }

    // 12-digit Indian mobile with repeated digits
    const indianMobile = "+919988776655";
    const inRes = normalizePhoneNumber(indianMobile);
    expect(inRes.ok).toBe(true);
    if (inRes.ok) {
      expect(inRes.e164).toBe(indianMobile);
      expect(inRes.digits).toBe("919988776655");
    }
  });

  it("converts valid numbers to WhatsApp address helper", () => {
    expect(toWhatsAppAddress("+919876543210")).toBe("whatsapp:+919876543210");
    expect(toWhatsAppAddress("+1 (415) 555-2671")).toBe("whatsapp:+14155552671");
    expect(() => toWhatsAppAddress("invalid_number")).toThrow("Cannot convert invalid number");
  });
});

