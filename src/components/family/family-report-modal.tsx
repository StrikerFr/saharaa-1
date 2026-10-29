import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Edit3, MessageSquarePlus, Mic, Send, Volume2 } from "lucide-react";

import { VoiceRecorder } from "@/components/reports/voice-recorder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/shell/states";
import { correctTranscript, submitAudioReport, submitTextReport } from "@/lib/reports.functions";

interface FamilyReportModalProps {
  seniorId: string;
  seniorName: string;
  onSuccess?: () => void;
}

export function FamilyReportModal({ seniorId, seniorName, onSuccess }: FamilyReportModalProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [text, setText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Post-transcription correction state
  const [transcribedReportId, setTranscribedReportId] = useState<string | null>(null);
  const [editableTranscript, setEditableTranscript] = useState<string>("");
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);

  const qc = useQueryClient();
  const sendText = useServerFn(submitTextReport);
  const sendAudio = useServerFn(submitAudioReport);
  const sendCorrection = useServerFn(correctTranscript);

  const reset = () => {
    setText("");
    setAudioFile(null);
    setError(null);
    setTranscribedReportId(null);
    setEditableTranscript("");
    setIsEditingTranscript(false);
    setSubmissionSuccess(false);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) reset();
  };

  // Submit Text Report
  const textMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (text.trim().length < 3) throw new Error("Please write at least a few words.");
      const res = await sendText({
        data: {
          seniorId,
          text: text.trim(),
          relation: "family",
          language: "unknown",
          eventTime: null,
          clientRequestId: crypto.randomUUID(),
        },
      });
      return res;
    },
    onSuccess: () => {
      setSubmissionSuccess(true);
      qc.invalidateQueries({ queryKey: ["family-dashboard", seniorId] });
      onSuccess?.();
    },
    onError: (err: any) => setError(err.message || "Failed to submit report."),
  });

  // Submit Voice Note & Transcribe with Groq STT
  const audioMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!audioFile) throw new Error("Please record or upload audio first.");

      const fd = new FormData();
      fd.set("audio", audioFile);
      fd.set("seniorId", seniorId);
      fd.set("relation", "family");
      fd.set("language", "unknown");
      fd.set("clientRequestId", crypto.randomUUID());

      const res = await sendAudio({ data: fd });
      if (!res.ok) throw new Error(res.message);
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["family-dashboard", seniorId] });
      setTranscribedReportId(res.reportId);
      setIsEditingTranscript(true);
      onSuccess?.();
    },
    onError: (err: any) => setError(err.message || "Failed to transcribe audio note."),
  });

  // Submit Transcript Correction
  const correctionMutation = useMutation({
    mutationFn: async () => {
      if (!transcribedReportId) return;
      await sendCorrection({
        data: {
          reportId: transcribedReportId,
          text: editableTranscript.trim(),
        },
      });
    },
    onSuccess: () => {
      setSubmissionSuccess(true);
      qc.invalidateQueries({ queryKey: ["family-dashboard", seniorId] });
    },
    onError: (err: any) => setError(err.message || "Failed to save transcript correction."),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2 shadow-sm">
          <MessageSquarePlus className="size-4" /> Share an Update
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Care Update for {seniorName}</DialogTitle>
          <DialogDescription>
            Share an observation, meal note, symptom, or how they are feeling today. The care team will review it.
          </DialogDescription>
        </DialogHeader>

        {error && <Notice tone="critical" title={error} />}

        {submissionSuccess ? (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <CheckCircle2 className="size-6" />
            </span>
            <h3 className="font-semibold text-foreground">Update Submitted Successfully</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your update has been received. Our care coordination team will review it and follow up if needed.
            </p>
            <Button className="mt-2" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : isEditingTranscript ? (
          <div className="flex flex-col gap-4 py-2">
            <Notice tone="info" title="Voice note transcribed">
              Review your transcript below. You can correct any names, numbers, or words before it is reviewed.
            </Notice>
            <div className="flex flex-col gap-2">
              <Label htmlFor="transcript-edit" className="text-xs font-semibold">
                Transcript (Editable)
              </Label>
              <Textarea
                id="transcript-edit"
                value={editableTranscript}
                onChange={(e) => setEditableTranscript(e.target.value)}
                placeholder="Transcribed words appear here..."
                rows={4}
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => setSubmissionSuccess(true)}>
                Keep as is & Finish
              </Button>
              <Button
                loading={correctionMutation.isPending}
                onClick={() => correctionMutation.mutate()}
                className="gap-2"
              >
                <Edit3 className="size-4" /> Save Correction
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text" className="gap-2">
                <Edit3 className="size-4" /> Type Message
              </TabsTrigger>
              <TabsTrigger value="voice" className="gap-2">
                <Mic className="size-4" /> Record Voice Note
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="flex flex-col gap-4 pt-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="family-text" className="text-xs font-medium">
                  What would you like the care team to know?
                </Label>
                <Textarea
                  id="family-text"
                  placeholder="e.g. Mom finished lunch well today, but seemed a bit tired during her evening walk..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  maxLength={8000}
                />
                <span className="self-end text-xs text-muted-foreground">{text.length} / 8000</span>
              </div>
              <DialogFooter>
                <Button
                  loading={textMutation.isPending}
                  disabled={text.trim().length < 3}
                  onClick={() => textMutation.mutate()}
                  className="w-full gap-2 sm:w-auto"
                >
                  <Send className="size-4" /> Send Update
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="voice" className="flex flex-col gap-4 pt-3">
              <VoiceRecorder
                onAudioReady={(f) => setAudioFile(f)}
                onClear={() => setAudioFile(null)}
                disabled={audioMutation.isPending}
              />
              <DialogFooter>
                <Button
                  loading={audioMutation.isPending}
                  disabled={!audioFile}
                  onClick={() => audioMutation.mutate()}
                  className="w-full gap-2 sm:w-auto"
                >
                  <Send className="size-4" /> Submit Voice Note
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

