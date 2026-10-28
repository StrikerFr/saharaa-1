// Opt-in live provider smoke test. Uses ONLY synthetic sentences.
// Run: bun scripts/ai-smoke.ts stt [file] (Groq STT; synthetic audio only)
// Run: bun scripts/ai-smoke.ts llm   (Groq LLM; uses free-tier requests)
//      bun scripts/ai-smoke.ts tts   (ElevenLabs; spends ~60 characters of credit)
import { writeFileSync, readFileSync } from "node:fs";
import { extractCues, groqConfig, transcribe } from "../src/lib/ai/groq.server";
import { synthesize, ttsConfig } from "../src/lib/ai/elevenlabs.server";

const SAMPLES = [
  "Mummy kal se kam kha rahi hain aur aaj thodi kamzori bhi lag rahi thi.",
  "No fever today.",
  "She had a fever last week, but not now.",
  "I think he may have fallen.",
  "He didn't say that he was dizzy.",
  "She is eating less, or maybe the food has changed.",
  "BP 160/100 tha subah.",
  "पापा को आज चक्कर नहीं आया, लेकिन नींद ठीक से नहीं हुई।",
];
const mode = process.argv[2];
if (mode === "llm") {
  const cfg = groqConfig();
  for (const s of SAMPLES) {
    try {
      const r = await extractCues(s, "typed_text", cfg);
      console.log(JSON.stringify({ input: s, model: r.model, ...r.extraction }));
    } catch (e) {
      console.log(JSON.stringify({ input: s, error: (e as Error).message }));
    }
  }
} else if (mode === "tts") {
  const r = await synthesize("Sahaara voice check. नमस्ते, यह एक परीक्षण है।", ttsConfig());
  console.log("tts ok", r.contentType, r.audio.byteLength, "bytes");
  writeFileSync("/tmp/sahaara-tts-smoke.mp3", new Uint8Array(r.audio));
} else if (mode === "stt") {
  // Usage: bun scripts/ai-smoke.ts stt <file.mp3> [en|hi]  (synthetic audio only)
  const path = process.argv[3] ?? "/tmp/sahaara-tts-smoke.mp3";
  const lang = (process.argv[4] as "en" | "hi" | undefined) ?? null;
  const t = await transcribe(new Blob([readFileSync(path)]), "note.mp3", lang, groqConfig());
  console.log(JSON.stringify(t));
} else console.log("usage: bun scripts/ai-smoke.ts llm|tts");
