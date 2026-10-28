// Shared provider error model (pure). Codes are stored/audited; messages are
// user-safe and never include provider payloads, keys or report content.
export type ProviderErrorCode =
  | "not_configured"
  | "invalid_credentials"
  | "forbidden"
  | "model_unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "payload_too_large"
  | "unsupported_input"
  | "timeout"
  | "network"
  | "provider_error"
  | "invalid_output"
  | "empty_result";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly provider: "groq" | "elevenlabs",
    public readonly status?: number,
  ) {
    super(code);
    this.name = "ProviderError";
  }
  get retryable() {
    return this.code === "timeout" || this.code === "network" || this.code === "provider_error";
  }
}

const NAMES = { groq: "Groq", elevenlabs: "ElevenLabs" } as const;

export function userMessage(e: ProviderError): string {
  const p = NAMES[e.provider];
  switch (e.code) {
    case "not_configured":
      return `${p} is not configured for this app.`;
    case "invalid_credentials":
      return `${p} rejected the app's API key. An administrator needs to update it.`;
    case "forbidden":
      return `${p} refused this request for this account.`;
    case "model_unavailable":
      return `The configured ${p} model or voice is not available to this account.`;
    case "rate_limited":
      return `${p}'s free-tier rate limit was reached. Wait a minute and try again.`;
    case "quota_exhausted":
      return `${p}'s free credits for this account are used up.`;
    case "payload_too_large":
      return "The file is larger than the provider allows. Record a shorter note and try again.";
    case "unsupported_input":
      return `${p} couldn't process this input. Check the format and try again.`;
    case "timeout":
      return `${p} took too long to respond. Nothing was saved from this attempt; try again.`;
    case "network":
      return `Couldn't reach ${p}. Check the connection and try again.`;
    case "invalid_output":
      return "The AI response didn't pass validation, so it was discarded. You can retry.";
    case "empty_result":
      return "No speech was detected in the recording.";
    default:
      return `${p} had a problem. Try again later.`;
  }
}

/** Classify an HTTP failure. `bodyHint` is a short lowercase snippet used only for classification. */
export function classifyHttp(
  provider: "groq" | "elevenlabs",
  status: number,
  bodyHint = "",
): ProviderError {
  const h = bodyHint.toLowerCase();
  let code: ProviderErrorCode;
  // ElevenLabs reports exhausted credits as 401 + "quota_exceeded", so check the hint first.
  if (status === 402 || h.includes("quota") || h.includes("credits")) code = "quota_exhausted";
  else if (status === 401) code = "invalid_credentials";
  else if (status === 403) code = "forbidden";
  else if (status === 404 || h.includes("model_not_found") || h.includes("voice_not_found"))
    code = "model_unavailable";
  else if (status === 413) code = "payload_too_large";
  else if (status === 429) code = "rate_limited";
  else if (status === 400 || status === 415 || status === 422) code = "unsupported_input";
  else code = "provider_error";
  return new ProviderError(code, provider, status);
}

export function classifyThrown(provider: "groq" | "elevenlabs", e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError")
    return new ProviderError("timeout", provider);
  return new ProviderError("network", provider);
}
