// Groq adapters (server-only): LLM cue extraction + speech-to-text.
// Never logs report text, transcripts, audio or keys.
import {
  buildUserPrompt,
  CUE_SCHEMA_VERSION,
  EXTRACTION_JSON_SCHEMA,
  parseExtraction,
  SYSTEM_PROMPT,
  type Extraction,
} from "./cues";
import { classifyHttp, classifyThrown, ProviderError } from "./provider-errors";

const BASE = "https://api.groq.com/openai/v1";
const LLM_TIMEOUT_MS = 30_000;
const STT_TIMEOUT_MS = 120_000;

export interface GroqConfig {
  apiKey: string;
  llmModel: string;
  sttModel: string;
}

export function groqConfig(env: Record<string, string | undefined> = process.env): GroqConfig {
  const apiKey = env["GROQ_API_KEY"];
  if (!apiKey) throw new ProviderError("not_configured", "groq");
  return {
    apiKey,
    llmModel: env["GROQ_LLM_MODEL"] || "openai/gpt-oss-20b",
    sttModel: env["GROQ_STT_MODEL"] || "whisper-large-v3-turbo",
  };
}

async function hint(res: Response) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export interface ExtractionResult {
  extraction: Extraction;
  model: string;
  schemaVersion: string;
}

/**
 * One attempt plus at most one recovery attempt (only for timeouts, network/5xx
 * errors or output that failed validation). 4xx errors, including 429, are not retried.
 */
export async function extractCues(
  text: string,
  sourceType: "typed_text" | "transcribed_audio",
  cfg: GroqConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractionResult> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model: cfg.llmModel,
          temperature: 0,
          reasoning_effort: "low",
          max_completion_tokens: 3000,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(text, sourceType) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "wellbeing_cues", strict: true, schema: EXTRACTION_JSON_SCHEMA },
          },
        }),
      });
      if (!res.ok) throw classifyHttp("groq", res.status, await hint(res));
      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      };
      const msg = body.choices?.[0]?.message;
      if (!msg || msg.refusal || typeof msg.content !== "string")
        throw new ProviderError("invalid_output", "groq");
      const parsed = parseExtraction(text, msg.content);
      if (!parsed.ok) throw new ProviderError("invalid_output", "groq");
      return { extraction: parsed.value, model: cfg.llmModel, schemaVersion: CUE_SCHEMA_VERSION };
    } catch (e) {
      last = classifyThrown("groq", e);
      if (!(last.retryable || last.code === "invalid_output")) throw last;
    }
  }
  throw last ?? new ProviderError("provider_error", "groq");
}

export interface Transcript {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  model: string;
  /** Derived from provider segment stats; a hint for reviewers, not a confidence score. */
  lowQuality: boolean;
}

/** Single attempt; audio is never retried automatically. Never fabricates text. */
export async function transcribe(
  file: Blob,
  filename: string,
  language: "en" | "hi" | null,
  cfg: GroqConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Transcript> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", cfg.sttModel);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
  } catch (e) {
    throw classifyThrown("groq", e);
  }
  if (!res.ok) throw classifyHttp("groq", res.status, await hint(res));
  let body: {
    text?: unknown;
    language?: unknown;
    duration?: unknown;
    segments?: { no_speech_prob?: number; avg_logprob?: number }[];
  };
  try {
    body = await res.json();
  } catch {
    throw new ProviderError("invalid_output", "groq");
  }
  if (typeof body.text !== "string") throw new ProviderError("invalid_output", "groq");
  const text = body.text.trim().slice(0, 8000);
  if (!text) throw new ProviderError("empty_result", "groq");
  const segs = Array.isArray(body.segments) ? body.segments : [];
  const lowQuality =
    segs.length > 0 &&
    segs.some((s) => (s.no_speech_prob ?? 0) > 0.6 || (s.avg_logprob ?? 0) < -1.0);
  return {
    text,
    language: typeof body.language === "string" ? body.language.slice(0, 40) : null,
    durationSeconds: typeof body.duration === "number" ? Math.round(body.duration * 10) / 10 : null,
    model: cfg.sttModel,
    lowQuality: lowQuality || body.text.length > 8000,
  };
}

/** Strict-JSON chat call for the wellbeing summary. One retry on transient/invalid output. */
export async function summarize(
  system: string,
  user: string,
  schema: object,
  validate: (raw: string) => boolean,
  cfg: GroqConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ raw: string; model: string }> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model: cfg.llmModel,
          temperature: 0,
          reasoning_effort: "low",
          max_completion_tokens: 3000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "wellbeing_summary", strict: true, schema },
          },
        }),
      });
      if (!res.ok) throw classifyHttp("groq", res.status, await hint(res));
      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      };
      const msg = body.choices?.[0]?.message;
      if (!msg || msg.refusal || typeof msg.content !== "string" || !validate(msg.content))
        throw new ProviderError("invalid_output", "groq");
      return { raw: msg.content, model: cfg.llmModel };
    } catch (e) {
      last = classifyThrown("groq", e);
      if (!(last.retryable || last.code === "invalid_output")) throw last;
    }
  }
  throw last ?? new ProviderError("provider_error", "groq");
}
