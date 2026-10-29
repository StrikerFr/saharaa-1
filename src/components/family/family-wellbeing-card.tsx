import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Info,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { generateWellbeingSummary } from "@/lib/summary.functions";
import { speakConfirmedSummary } from "@/lib/reports.functions";

interface FamilyWellbeingCardProps {
  seniorId: string;
  seniorName: string;
  timeZone: string;
}

export function FamilyWellbeingCard({
  seniorId,
  seniorName,
  timeZone,
}: FamilyWellbeingCardProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const runSummary = useServerFn(generateWellbeingSummary);
  const summaryQuery = useQuery({
    queryKey: ["family-wellbeing-summary", seniorId],
    queryFn: () => runSummary({ data: { seniorId } }),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const speakFn = useServerFn(speakConfirmedSummary);
  const speakMutation = useMutation({
    mutationFn: async (text: string) => {
      setAudioError(null);
      const res = await speakFn({ data: { text } });
      if (!res.ok) throw new Error(res.message);
      return res.audioBase64;
    },
    onSuccess: (base64) => {
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      setIsPlayingAudio(true);
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => {
        setIsPlayingAudio(false);
        setAudioError("Unable to play audio summary on this device.");
      };
      audio.play().catch(() => {
        setIsPlayingAudio(false);
        setAudioError("Audio playback was blocked by browser. Click again to play.");
      });
    },
    onError: (err: any) => {
      setIsPlayingAudio(false);
      setAudioError(err.message || "Text-to-speech audio is not configured or unavailable.");
    },
  });

  const res = summaryQuery.data;

  const buildSpeechText = () => {
    if (!res || !res.ok) return "";
    return [
      res.summary.headline,
      res.summary.today ? `Today: ${res.summary.today}` : null,
      ...res.summary.points.map((p) => p.text),
      res.summary.notes_summary ? `Care notes: ${res.summary.notes_summary}` : null,
    ]
      .filter(Boolean)
      .join(". ");
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Past 14-Day Wellbeing Summary</h3>
            <p className="text-xs text-muted-foreground">
              Plain-language overview of {seniorName}&apos;s recent checked vitals and notes.
            </p>
          </div>
        </div>

        {res && res.ok && (
          <Button
            size="sm"
            variant="outline"
            loading={speakMutation.isPending}
            onClick={() => speakMutation.mutate(buildSpeechText())}
            className="flex items-center gap-1.5"
          >
            {isPlayingAudio ? (
              <>
                <VolumeX className="size-4 animate-pulse text-primary" /> Playing...
              </>
            ) : (
              <>
                <Volume2 className="size-4" /> Listen to Summary
              </>
            )}
          </Button>
        )}
      </div>

      {audioError && (
        <Notice tone="warning" title="Audio read-aloud unavailable">
          {audioError}
        </Notice>
      )}

      {summaryQuery.isPending ? (
        <div className="flex flex-col gap-2.5 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ) : summaryQuery.isError || (res && !res.ok) ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {res && !res.ok
            ? res.message
            : "No sufficient recent observations to generate an automated wellbeing summary."}
        </div>
      ) : res?.ok ? (
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium leading-relaxed text-foreground">
            {res.summary.headline}
          </p>

          {/* Today's immediate record if any */}
          {res.summary.today && (
            <div className="flex items-start gap-2.5 rounded-xl bg-primary/5 p-3.5 border border-primary/15 text-sm">
              <Sun className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <span className="font-semibold text-primary">Recorded Today: </span>
                <span className="text-foreground/90">{res.summary.today}</span>
              </div>
            </div>
          )}

          {/* Points list */}
          {res.summary.points.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Observed Trends & Observations
              </p>
              <ul className="flex flex-col gap-2">
                {res.summary.points.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{pt.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes summary */}
          {res.summary.notes_summary && (
            <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Care Team Notes: </span>
              {res.summary.notes_summary}
            </div>
          )}

          {/* Suggested checks or data gaps */}
          {(res.summary.suggested_checks.length > 0 || res.summary.data_gaps.length > 0) && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              {res.summary.suggested_checks.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3.5 border border-border">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <ClipboardCheck className="size-3.5 text-primary" /> Recommended Checks
                  </div>
                  <ul className="flex flex-col gap-1.5 text-xs text-foreground/80">
                    {res.summary.suggested_checks.map((check, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-primary font-bold">•</span>
                        <span>{check}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {res.summary.data_gaps.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl bg-amber-500/5 p-3.5 border border-amber-500/15">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3.5" /> Awaiting New Readings
                  </div>
                  <ul className="flex flex-col gap-1.5 text-xs text-foreground/80">
                    {res.summary.data_gaps.map((gap, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-600 font-bold">•</span>
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <span>Based on {res.observationCount} recent checked vitals and notes</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => summaryQuery.refetch()}
              className="h-6 text-xs text-muted-foreground hover:text-foreground"
            >
              Refresh summary
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
