import { describe, expect, it, vi } from "vitest";

import { checkAudio, MAX_AUDIO_BYTES } from "@/lib/ai/audio";
import { parseExtraction, suggestObservation, type CandidateCue } from "@/lib/ai/cues";
import { synthesize, ttsConfig } from "@/lib/ai/elevenlabs.server";
import { extractCues, transcribe } from "@/lib/ai/groq.server";
import { classifyHttp, ProviderError } from "@/lib/ai/provider-errors";
import {
  buildConfirmedSummary,
  canCorrectTranscript,
  canReviewCue,
  type ReportCueRow,
} from "@/lib/reports";

const cue = (o: Partial<CandidateCue> = {}): CandidateCue => ({
  cueType: "fever",
  description: "Fever mentioned",
  evidenceText: "No fever today",
  polarity: "negative",
  temporality: "current",
  certainty: "stated",
  speaker: "third_party",
  reportedTimeText: null,
  statedMeasurement: null,
  categoryValue: null,
  limitations: [],
  ...o,
});
const out = (cues: CandidateCue[], extra: object = {}) =>
  JSON.stringify({
    language: "en",
    needsClarification: false,
    clarificationQuestions: [],
    cues,
    ...extra,
  });
const cfg = { apiKey: "k", llmModel: "openai/gpt-oss-20b", sttModel: "whisper-large-v3-turbo" };
const chat = (content: string, status = 200) =>
  vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  ) as unknown as typeof fetch;

describe("LLM output validation", () => {
  it("accepts valid structured output", () => {
    expect(parseExtraction("No fever today", out([cue()])).ok).toBe(true);
  });
  it("rejects unexpected fields, bad enums and invalid JSON", () => {
    expect(parseExtraction("x", out([cue()], { seniorId: "abc" })).ok).toBe(false);
    expect(parseExtraction("x", out([{ ...cue(), polarity: "definite" } as never])).ok).toBe(false);
    expect(parseExtraction("x", "{not json").ok).toBe(false);
  });
  it("rejects a model-supplied review status or identifier on a cue", () => {
    expect(parseExtraction("x", out([{ ...cue(), reviewStatus: "confirmed" } as never])).ok).toBe(
      false,
    );
  });
  it("removes a measurement not present verbatim in the report", () => {
    const r = parseExtraction(
      "BP was high",
      out([
        cue({
          cueType: "blood_pressure",
          statedMeasurement: "160/100",
          evidenceText: "BP was high",
        }),
      ]),
    );
    expect(r.ok && r.value.cues[0]?.statedMeasurement).toBe(null);
  });
  it("keeps an explicitly stated measurement", () => {
    const r = parseExtraction(
      "BP 160/100",
      out([
        cue({
          cueType: "blood_pressure",
          statedMeasurement: "160/100",
          evidenceText: "BP 160/100",
          polarity: "positive",
        }),
      ]),
    );
    expect(r.ok && r.value.cues[0]?.statedMeasurement).toBe("160/100");
  });
});

describe("cue to observation suggestion", () => {
  it("a negated symptom never becomes a structured observation", () => {
    expect(
      suggestObservation(
        cue({ cueType: "appetite", polarity: "negative", categoryValue: "reduced" }),
      ).type,
    ).toBe("care_note");
  });
  it("a past concern is not treated as current", () => {
    expect(
      suggestObservation(
        cue({
          cueType: "appetite",
          polarity: "positive",
          temporality: "past",
          categoryValue: "reduced",
        }),
      ).type,
    ).toBe("care_note");
  });
  it("an uncertain statement stays a care note", () => {
    expect(
      suggestObservation(
        cue({ cueType: "appetite", polarity: "uncertain", categoryValue: "reduced" }),
      ).type,
    ).toBe("care_note");
  });
  it("a current positive appetite cue pre-fills appetite=reduced", () => {
    const s = suggestObservation(
      cue({ cueType: "appetite", polarity: "positive", categoryValue: "reduced" }),
    );
    expect([s.type, s.choice]).toEqual(["appetite", "reduced"]);
  });
  it("blood pressure pre-fills only from the stated value", () => {
    const s = suggestObservation(
      cue({ cueType: "blood_pressure", polarity: "positive", statedMeasurement: "160/100" }),
    );
    expect([s.value1, s.value2]).toEqual(["160", "100"]);
  });
});

describe("Groq LLM adapter", () => {
  it("returns validated cues", async () => {
    const r = await extractCues("No fever today", "typed_text", cfg, chat(out([cue()])));
    expect(r.extraction.cues).toHaveLength(1);
    expect(r.schemaVersion).toBe("cues.v1");
  });
  it("does not retry a rate limit", async () => {
    const f = chat("", 429);
    await expect(extractCues("x", "typed_text", cfg, f)).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries invalid output once, then fails", async () => {
    const f = chat("garbage");
    await expect(extractCues("x", "typed_text", cfg, f)).rejects.toMatchObject({
      code: "invalid_output",
    });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("Groq STT adapter", () => {
  const blob = new Blob([new Uint8Array(2000)]);
  it("returns the transcript", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ text: " hello ", language: "en", duration: 2.04 })),
    ) as unknown as typeof fetch;
    const t = await transcribe(blob, "a.mp3", null, cfg, f);
    expect([t.text, t.durationSeconds]).toEqual(["hello", 2]);
  });
  it("never fabricates a transcript for empty results", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ text: "   " })),
    ) as unknown as typeof fetch;
    await expect(transcribe(blob, "a.mp3", null, cfg, f)).rejects.toMatchObject({
      code: "empty_result",
    });
  });
  it("maps provider failures", async () => {
    const f = vi.fn(async () => new Response("x", { status: 413 })) as unknown as typeof fetch;
    await expect(transcribe(blob, "a.mp3", null, cfg, f)).rejects.toMatchObject({
      code: "payload_too_large",
    });
  });
});

describe("audio validation", () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("accepts a real mp3 header", () =>
    expect(checkAudio("n.mp3", "audio/mpeg", 5000, mp3).ok).toBe(true));
  it("rejects unsupported formats", () =>
    expect(checkAudio("n.exe", "application/x-msdownload", 5000, mp3)).toEqual({
      ok: false,
      reason: "unsupported_format",
    }));
  it("keeps the cap under Vercel's 4.5 MB serverless request-body limit", () =>
    expect(MAX_AUDIO_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024));
  it("rejects oversized files", () =>
    expect(checkAudio("n.mp3", "audio/mpeg", MAX_AUDIO_BYTES + 1, mp3)).toEqual({
      ok: false,
      reason: "too_large",
    }));
  it("rejects empty files", () =>
    expect(checkAudio("n.mp3", "audio/mpeg", 10, mp3)).toEqual({ ok: false, reason: "empty" }));
  it("rejects a renamed non-audio file", () =>
    expect(checkAudio("n.mp3", "audio/mpeg", 5000, new Uint8Array(16))).toEqual({
      ok: false,
      reason: "signature_mismatch",
    }));
});

describe("ElevenLabs TTS adapter", () => {
  const env = {
    ELEVENLABS_API_KEY: "k",
    ELEVENLABS_TTS_MODEL_ID: "eleven_multilingual_v2",
    ELEVENLABS_VOICE_ID: "z2gqnDU9fuyk5pvu5Cwx",
  };
  it("is unavailable without credentials", () =>
    expect(() => ttsConfig({})).toThrowError(new ProviderError("not_configured", "elevenlabs")));
  it("rejects a malformed voice id", () =>
    expect(() => ttsConfig({ ...env, ELEVENLABS_VOICE_ID: "../x" })).toThrow("model_unavailable"));
  it("uses the configured voice and model and returns audio/mpeg", async () => {
    const f = vi.fn(
      async () => new Response(new Uint8Array(500), { headers: { "content-type": "audio/mpeg" } }),
    );
    const r = await synthesize("hello", ttsConfig(env), f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/text-to-speech/z2gqnDU9fuyk5pvu5Cwx");
    expect(JSON.parse(init.body as string).model_id).toBe("eleven_multilingual_v2");
    expect(r.contentType).toBe("audio/mpeg");
  });
  it("does not return non-audio responses as audio", async () => {
    const f = vi.fn(
      async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await expect(
      synthesize("hi", ttsConfig(env), f as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });
  it("maps exhausted credits", () =>
    expect(classifyHttp("elevenlabs", 401, "quota_exceeded").code).toBe("quota_exhausted"));
  it("maps 402 to exhausted credits", () =>
    expect(classifyHttp("elevenlabs", 402).code).toBe("quota_exhausted"));
});

describe("review rules", () => {
  const row = (s: ReportCueRow["review_status"], o: Partial<ReportCueRow> = {}): ReportCueRow => ({
    id: "1",
    report_id: "r",
    attempt: 1,
    position: 0,
    cue: cue({ description: "Eating less" }),
    schema_version: "cues.v1",
    llm_model: "m",
    review_status: s,
    reviewer_description: null,
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    observation_id: null,
    ...o,
  });
  it("only pending cues can be reviewed", () => {
    expect(canReviewCue("pending_review")).toBe(true);
    expect(canReviewCue("confirmed")).toBe(false);
    expect(canReviewCue("superseded")).toBe(false);
  });
  it("read-aloud includes only confirmed cues", () => {
    expect(buildConfirmedSummary([row("pending_review")])).toBe(null);
    expect(
      buildConfirmedSummary([
        row("confirmed", { reviewer_description: "Edited" }),
        row("rejected"),
      ]),
    ).toContain("Edited");
  });
  it("transcript can't change after a confirmation", () =>
    expect(canCorrectTranscript({ source_type: "transcribed_audio" }, [row("confirmed")])).toBe(
      false,
    ));
});
