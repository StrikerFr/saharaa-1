// ElevenLabs text-to-speech adapter (server-only). Returns audio only after a
// successful provider response with an audio content type.
import { classifyHttp, classifyThrown, ProviderError } from "./provider-errors";

const TTS_TIMEOUT_MS = 30_000;
export const MAX_TTS_CHARS = 1200;

export interface TtsConfig {
  apiKey: string;
  modelId: string;
  voiceId: string;
}

export function ttsConfig(env: Record<string, string | undefined> = process.env): TtsConfig {
  const apiKey = env["ELEVENLABS_API_KEY"];
  const modelId = env["ELEVENLABS_TTS_MODEL_ID"];
  const voiceId = env["ELEVENLABS_VOICE_ID"];
  if (!apiKey || !modelId || !voiceId) throw new ProviderError("not_configured", "elevenlabs");
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId) || !/^[a-z0-9_]{3,60}$/.test(modelId))
    throw new ProviderError("model_unavailable", "elevenlabs");
  return { apiKey, modelId, voiceId };
}

export async function synthesize(
  text: string,
  cfg: TtsConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ audio: ArrayBuffer; contentType: "audio/mpeg" }> {
  const t = text.trim();
  if (!t || t.length > MAX_TTS_CHARS) throw new ProviderError("unsupported_input", "elevenlabs");
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": cfg.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: t, model_id: cfg.modelId }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
  } catch (e) {
    throw classifyThrown("elevenlabs", e);
  }
  if (!res.ok) {
    let h = "";
    try {
      h = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw classifyHttp("elevenlabs", res.status, h);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("audio/")) throw new ProviderError("invalid_output", "elevenlabs");
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 100) throw new ProviderError("invalid_output", "elevenlabs");
  return { audio, contentType: "audio/mpeg" };
}

/** Chunked base64 (no spread over large buffers). */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
