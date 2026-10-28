// Audio upload validation (pure). Groq accepts up to 25 MB per file, but a voice
// note is posted through a serverless function and Vercel rejects request bodies
// above ~4.5 MB, so the app keeps one smaller cap that holds on every host.
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const MIN_AUDIO_BYTES = 1024;

export const AUDIO_FORMATS = {
  flac: ["audio/flac", "audio/x-flac"],
  mp3: ["audio/mpeg", "audio/mp3", "audio/mpga"],
  mp4: ["audio/mp4", "video/mp4"],
  m4a: ["audio/m4a", "audio/x-m4a", "audio/mp4"],
  ogg: ["audio/ogg", "application/ogg"],
  opus: ["audio/ogg", "audio/opus"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
  webm: ["audio/webm", "video/webm"],
} as const;
export type AudioFormat = keyof typeof AUDIO_FORMATS;
export const ACCEPT_ATTR = Object.keys(AUDIO_FORMATS)
  .map((e) => `.${e}`)
  .join(",");

function sniff(b: Uint8Array): "flac" | "mp3" | "mp4" | "ogg" | "wav" | "webm" | null {
  const s = (o: number, t: string) => [...t].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  if (b.length < 12) return null;
  if (s(0, "fLaC")) return "flac";
  if (s(0, "ID3") || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  if (s(4, "ftyp")) return "mp4";
  if (s(0, "OggS")) return "ogg";
  if (s(0, "RIFF") && s(8, "WAVE")) return "wav";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  return null;
}

const FAMILY: Record<AudioFormat, ReturnType<typeof sniff>> = {
  flac: "flac",
  mp3: "mp3",
  mp4: "mp4",
  m4a: "mp4",
  ogg: "ogg",
  opus: "ogg",
  wav: "wav",
  webm: "webm",
};

export type AudioCheck =
  | { ok: true; format: AudioFormat; mime: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_format" | "signature_mismatch" };

/** Validate name, declared MIME, size and leading bytes. */
export function checkAudio(name: string, mime: string, size: number, head: Uint8Array): AudioCheck {
  if (size < MIN_AUDIO_BYTES) return { ok: false, reason: "empty" };
  if (size > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!(ext in AUDIO_FORMATS)) return { ok: false, reason: "unsupported_format" };
  const format = ext as AudioFormat;
  const baseMime = (mime.split(";")[0] ?? "").trim().toLowerCase();
  if (baseMime && !(AUDIO_FORMATS[format] as readonly string[]).includes(baseMime))
    return { ok: false, reason: "unsupported_format" };
  if (sniff(head) !== FAMILY[format]) return { ok: false, reason: "signature_mismatch" };
  return { ok: true, format, mime: baseMime || AUDIO_FORMATS[format][0] };
}

export const AUDIO_REASON_MESSAGES: Record<Exclude<AudioCheck, { ok: true }>["reason"], string> = {
  empty: "The recording is empty or too short.",
  too_large: "The recording is larger than 4 MB. Record a shorter note and try again.",
  unsupported_format: "Use an MP3, M4A, MP4, WAV, OGG, OPUS, FLAC or WEBM audio file.",
  signature_mismatch:
    "This file doesn't look like the audio type its name says. It may be corrupt.",
};
