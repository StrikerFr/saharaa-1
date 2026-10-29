import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shell/states";
import { ACCEPT_ATTR, AUDIO_REASON_MESSAGES, checkAudio, MAX_AUDIO_BYTES } from "@/lib/ai/audio";

interface VoiceRecorderProps {
  onAudioReady: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onAudioReady, onClear, disabled = false }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useUploadFallback, setUseUploadFallback] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up object URLs and recording streams
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    setAudioUrl(null);
    setAudioFile(null);
    onClear();

    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("In-browser microphone recording is not supported on this device. Please upload an audio file instead.");
      setUseUploadFallback(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Select supported audio mime
      let mimeType = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          setError("Recording was empty. Please try speaking into the microphone again.");
          return;
        }

        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `voice_note_${Date.now()}.${ext}`, { type: mimeType });

        // Validate audio bytes
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const chk = checkAudio(file.name, file.type, file.size, head);
        if (!chk.ok) {
          setError(AUDIO_REASON_MESSAGES[chk.reason]);
          return;
        }

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioFile(file);
        onAudioReady(file);
      };

      recorder.start(250); // collect chunks every 250ms
      setRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= 300) {
            // max 5 minutes for voice notes
            stopRecording();
            return 300;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Microphone permission was denied. Please allow microphone access in your browser or upload an audio file.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setError("No microphone was detected on this device. Please connect a microphone or upload an audio file.");
      } else {
        setError("Could not access microphone: " + (err.message || "Unknown error"));
      }
      setUseUploadFallback(true);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const resetRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioFile(null);
    setDuration(0);
    setError(null);
    onClear();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const chosen = e.target.files?.[0];
    if (!chosen) return;

    if (chosen.size > MAX_AUDIO_BYTES) {
      setError("Audio file exceeds the 4 MB limit.");
      return;
    }

    const head = new Uint8Array(await chosen.slice(0, 16).arrayBuffer());
    const chk = checkAudio(chosen.name, chosen.type, chosen.size, head);
    if (!chk.ok) {
      setError(AUDIO_REASON_MESSAGES[chk.reason]);
      return;
    }

    const url = URL.createObjectURL(chosen);
    setAudioUrl(url);
    setAudioFile(chosen);
    onAudioReady(chosen);
  };

  const formatSecs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="size-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Voice Note</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setUseUploadFallback(!useUploadFallback);
            resetRecording();
          }}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          {useUploadFallback ? "Switch to microphone" : "Upload file instead"}
        </button>
      </div>

      {error && <Notice tone="critical" title={error} />}

      {!useUploadFallback ? (
        <div className="flex flex-col items-center justify-center gap-4 py-4 text-center">
          {!audioUrl && !recording && (
            <>
              <p className="max-w-xs text-xs text-muted-foreground">
                Click below to speak. Your voice note will be transcribed for care coordination.
              </p>
              <Button
                type="button"
                size="lg"
                variant="default"
                disabled={disabled}
                onClick={startRecording}
                className="gap-2.5 rounded-full px-6 py-6 shadow-md"
              >
                <Mic className="size-5" /> Start Recording
              </Button>
            </>
          )}

          {recording && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex size-3 rounded-full bg-destructive" />
                </span>
                <span className="font-mono text-lg font-bold text-destructive">
                  {formatSecs(duration)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Recording in progress... Speak clearly.</p>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                onClick={stopRecording}
                className="gap-2 rounded-full px-6"
              >
                <Square className="size-4 fill-current" /> Stop Recording
              </Button>
            </div>
          )}

          {audioUrl && (
            <div className="flex w-full flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Recorded audio ({formatSecs(duration)})</span>
                <button
                  type="button"
                  onClick={resetRecording}
                  className="flex items-center gap-1 text-xs text-destructive hover:underline"
                >
                  <RotateCcw className="size-3" /> Re-record
                </button>
              </div>
              <audio controls src={audioUrl} className="w-full h-10" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center hover:bg-muted/40">
            <Upload className="size-6 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium text-primary">Choose an audio file</span>
              <p className="text-xs text-muted-foreground">Supported: .m4a, .mp3, .webm, .wav (max 4 MB)</p>
            </div>
            <input
              type="file"
              accept={ACCEPT_ATTR}
              onChange={handleFileUpload}
              className="hidden"
              disabled={disabled}
            />
          </label>
          {audioFile && (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
              <span className="truncate font-medium">{audioFile.name}</span>
              <button type="button" onClick={resetRecording} className="text-destructive hover:underline">
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
