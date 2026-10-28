import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileAudio, MessageSquarePlus } from "lucide-react";

import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPT_ATTR, AUDIO_REASON_MESSAGES, checkAudio } from "@/lib/ai/audio";
import { selectCls } from "@/lib/form-styles";
import { LANGUAGE_LABEL, RELATION_LABEL } from "@/lib/reports";
import { submitAudioReport, submitTextReport } from "@/lib/reports.functions";
import { parseLocalDateTime } from "@/lib/seniors";

type Relation = keyof typeof RELATION_LABEL;
type Lang = keyof typeof LANGUAGE_LABEL;

export function NewReport({
  seniorId,
  llm,
  stt,
}: {
  seniorId: string;
  llm: boolean;
  stt: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [relation, setRelation] = useState<Relation>("family");
  const [language, setLanguage] = useState<Lang>("unknown");
  const [eventTime, setEventTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sendText = useServerFn(submitTextReport);
  const sendAudio = useServerFn(submitAudioReport);

  const done = (reportId: string) => {
    qc.invalidateQueries({ queryKey: ["reports", seniorId] });
    requestId.current = crypto.randomUUID();
    setOpen(false);
    setText("");
    setFile(null);
    void navigate({ to: "/seniors/$seniorId/reports/$reportId", params: { seniorId, reportId } });
  };

  const submit = useMutation({
    mutationFn: async () => {
      const ev = eventTime ? parseLocalDateTime(eventTime) : null;
      if (eventTime && !ev) throw new Error("Enter a valid time, or leave it empty.");
      const evIso = ev ? ev.toISOString() : null;
      if (mode === "text") {
        if (text.trim().length < 3) throw new Error("Write at least a few words.");
        const r = await sendText({
          data: {
            seniorId,
            text: text.trim(),
            relation,
            language,
            eventTime: evIso,
            clientRequestId: requestId.current,
          },
        });
        return r.reportId;
      }
      if (!file) throw new Error("Choose an audio file.");
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const chk = checkAudio(file.name, file.type, file.size, head);
      if (!chk.ok) throw new Error(AUDIO_REASON_MESSAGES[chk.reason]);
      const fd = new FormData();
      fd.set("audio", file);
      fd.set("seniorId", seniorId);
      fd.set("relation", relation);
      fd.set("language", language);
      fd.set("eventTime", evIso ?? "");
      fd.set("clientRequestId", requestId.current);
      abort.current = new AbortController();
      const r = await sendAudio({ data: fd, signal: abort.current.signal });
      if (!r.ok) throw new Error(r.message);
      return r.reportId;
    },
    onSuccess: done,
    onError: (e: Error) =>
      setError(e.name === "AbortError" ? "Upload cancelled. Nothing was saved." : e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submit.isPending) return;
    setError(null);
    submit.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submit.isPending) setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <MessageSquarePlus aria-hidden="true" /> New report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">New wellbeing report</DialogTitle>
          <DialogDescription>
            Write or upload what was reported. Any AI suggestions will need a coordinator's review
            before anything is recorded.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
          {error && <Notice tone="critical" title={error} />}
          <Tabs value={mode} onValueChange={(v) => setMode(v as "text" | "audio")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">Written report</TabsTrigger>
              <TabsTrigger value="audio" disabled={!stt}>
                Voice note
              </TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="mt-4 flex flex-col gap-2">
              <Label htmlFor="report-text">Report</Label>
              <Textarea
                id="report-text"
                rows={6}
                maxLength={8000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Kal se kam kha rahi hain aur aaj thodi kamzori lag rahi thi."
              />
              <p className="text-sm text-muted-foreground">
                English, Hindi or Hinglish. {text.length}/8000
              </p>
              {!llm && (
                <Notice tone="info" title="AI analysis is not configured">
                  The report will be saved, but no suggestions can be generated.
                </Notice>
              )}
            </TabsContent>
            <TabsContent value="audio" className="mt-4 flex flex-col gap-2">
              <Label htmlFor="report-audio">Audio file</Label>
              <input
                id="report-audio"
                type="file"
                accept={ACCEPT_ATTR}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="rounded-lg border border-input bg-background p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-semibold"
              />
              <p className="text-sm text-muted-foreground">
                MP3, M4A, WAV, OGG, OPUS, FLAC or WEBM, up to 25 MB. The audio is sent to Groq for
                transcription and is not stored by Sahaara.
              </p>
            </TabsContent>
          </Tabs>
          {!stt && mode === "text" && (
            <p className="text-sm text-muted-foreground">
              <FileAudio className="mr-1 inline size-4" aria-hidden="true" />
              Voice notes are unavailable: speech-to-text is not configured.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-relation">Reported by</Label>
              <select
                id="report-relation"
                className={selectCls}
                value={relation}
                onChange={(e) => setRelation(e.target.value as Relation)}
              >
                {Object.entries(RELATION_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-lang">Language</Label>
              <select
                id="report-lang"
                className={selectCls}
                value={language}
                onChange={(e) => setLanguage(e.target.value as Lang)}
              >
                {Object.entries(LANGUAGE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-event">When did this happen? (optional)</Label>
            <input
              id="report-event"
              type="datetime-local"
              className={selectCls}
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            {submit.isPending && mode === "audio" && (
              <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
                Cancel upload
              </Button>
            )}
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending
                ? mode === "audio"
                  ? "Transcribing…"
                  : "Saving and analysing…"
                : "Submit report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
