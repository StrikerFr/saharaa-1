import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlarmClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleX,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  Minus,
  Pencil,
  Pill,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";

import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { MetricCard } from "@/components/shell/metric";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { selectCls } from "@/lib/form-styles";
import {
  addDays,
  adherenceSeries,
  buildDay,
  formatTime,
  localDateIn,
  localMinutesIn,
  ROUTINE_CATEGORIES,
  SOURCE_LABEL,
  summarizeDay,
  zonedTimeToIso,
  type DayEntry,
  type RoutineCategory,
  type RoutineItem,
  type RoutineSource,
  type RoutineStatus,
} from "@/lib/routine";
import { formatInZone } from "@/lib/seniors";
import {
  getRoutine,
  interpretRoutineUpdate,
  logRoutine,
  saveRoutineItem,
  transcribeRoutineAudio,
  type InterpretResult,
} from "@/lib/routine.functions";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHART_DAYS = 7;

export function DailyRoutine({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const today = localDateIn(timeZone);
  const [date, setDate] = useState(today);
  const from = addDays(today, -(CHART_DAYS + 6));
  const fetchRoutine = useServerFn(getRoutine);
  const q = useQuery({
    queryKey: ["routine", seniorId, from, today],
    queryFn: () => fetchRoutine({ data: { seniorId, from, to: addDays(today, 1) } }),
  });
  const [editing, setEditing] = useState<RoutineItem | "new" | null>(null);

  if (q.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (q.isError || !q.data?.ok)
    return (
      <Notice tone="warning" title="Daily routine unavailable">
        {q.data && !q.data.ok ? q.data.message : "Couldn't load the routine."}
      </Notice>
    );

  const { items, logs } = q.data;
  const nowMin = date === today ? localMinutesIn(timeZone) : date < today ? null : -1;
  const entries = buildDay(items, logs, date, nowMin);
  const sum = summarizeDay(entries);
  const series = adherenceSeries(items, logs, today, CHART_DAYS);
  const label =
    date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatDay(date);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))} disabled={date <= addDays(today, -CHART_DAYS - 6)}>
            <ChevronLeft />
          </Button>
          <div className="min-w-36 text-center">
            <p className="font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">{formatDay(date)} · {timeZone}</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>
            <ChevronRight />
          </Button>
          {date !== today && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Back to today</Button>
          )}
        </div>
        <Button variant="outline" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" /> Add routine item
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Check} title="No daily routine yet">
          Add medicines, meals, sleep and other daily items with their times. Each day you can then tick
          what was done.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard icon={ListChecks} label="Done" value={`${sum.done}/${sum.total}`} />
            <MetricCard icon={Pill} label="Medicines taken" value={sum.medsTotal ? `${sum.medsDone}/${sum.medsTotal}` : "—"} />
            <MetricCard icon={CircleX} label="Missed or skipped" value={String(sum.missed + sum.skipped)} />
            <MetricCard icon={AlarmClock} emphasis={sum.overdue > 0} label="Overdue, not recorded" value={String(sum.overdue)} />
          </div>
          <Progress done={sum.done} total={sum.total} />

          <AiUpdate seniorId={seniorId} date={date} timeZone={timeZone} entries={entries} />

          <section className="surface p-2 sm:p-4" aria-labelledby="checklist-h">
            <h2 id="checklist-h" className="px-2 pb-2 font-semibold">Schedule for {label.toLowerCase()}</h2>
            {entries.length === 0 ? (
              <p className="px-2 pb-2 text-sm text-muted-foreground">Nothing is scheduled on this day.</p>
            ) : (
              <ul className="divide-y">
                {entries.map((e) => (
                  <ChecklistRow key={e.item.id} entry={e} date={date} timeZone={timeZone} seniorId={seniorId} onEdit={() => setEditing(e.item)} />
                ))}
              </ul>
            )}
          </section>

          <section className="surface p-5" aria-labelledby="adh-h">
            <h2 id="adh-h" className="font-semibold">Last {CHART_DAYS} days</h2>
            <p className="text-sm text-muted-foreground">
              Items not recorded are shown separately — not recorded is not the same as missed.
            </p>
            <div className="mt-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={series} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => formatDay(d, true)} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip labelFormatter={(d) => formatDay(String(d))} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 13 }} />
                  <Bar dataKey="done" name="Done" stackId="a" fill="var(--color-chart-1)" isAnimationActive={false} />
                  <Bar dataKey="missed" name="Missed / skipped" stackId="a" fill="var(--color-chart-4)" isAnimationActive={false} />
                  <Bar dataKey="notRecorded" name="Not recorded" stackId="a" fill="var(--color-muted)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Daily routine completion</caption>
              <thead className="text-left text-muted-foreground">
                <tr><th className="font-medium">Day</th><th className="font-medium">Done</th><th className="font-medium">Missed/skipped</th><th className="font-medium">Not recorded</th></tr>
              </thead>
              <tbody className="text-data">
                {series.map((s) => (
                  <tr key={s.date}><td>{formatDay(s.date, true)}</td><td>{s.done}/{s.total}</td><td>{s.missed}</td><td>{s.notRecorded}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <ManageList items={items} onEdit={setEditing} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Every tick is saved with who recorded it and when. Changes add a new entry; earlier entries are
        kept. Updates from WhatsApp or calls will appear here with their source once those are connected.
      </p>

      {editing && (
        <ItemDialog seniorId={seniorId} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function formatDay(d: string, short = false) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: short ? "numeric" : "short",
  });
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="progressbar" aria-label="Routine completed" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

const STATUS_TONE: Record<RoutineStatus, "success" | "critical" | "neutral" | "warning"> = {
  done: "success",
  missed: "critical",
  skipped: "neutral",
  pending: "warning",
};
const STATUS_LABEL: Record<RoutineStatus, string> = {
  done: "Done",
  missed: "Missed",
  skipped: "Skipped",
  pending: "Not recorded",
};

type LogEntry = {
  itemId: string;
  date: string;
  status: RoutineStatus;
  doneAt: string | null;
  note: string | null;
  source: RoutineSource;
  clientRequestId: string;
};

function useLog(seniorId: string) {
  const qc = useQueryClient();
  const run = useServerFn(logRoutine);
  return useMutation({
    mutationFn: async (entries: LogEntry[]) => {
      const r = await run({ data: { entries } });
      if (!r.ok) throw new Error(r.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["routine", seniorId] }),
  });
}

function ChecklistRow({ entry, date, timeZone, seniorId, onEdit }: { entry: DayEntry; date: string; timeZone: string; seniorId: string; onEdit: () => void }) {
  const { item, log, status, overdue } = entry;
  const cat = ROUTINE_CATEGORIES[item.category];
  const log_ = useLog(seniorId);
  const [time, setTime] = useState(formatTime(item.scheduled_time));
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const record = (s: RoutineStatus) =>
    log_.mutate([
      {
        itemId: item.id,
        date,
        status: s,
        doneAt: s === "done" ? (open ? zonedTimeToIso(date, time, timeZone) : null) : null,
        note: note.trim() || null,
        source: "coordinator",
        clientRequestId: crypto.randomUUID(),
      },
    ], { onSuccess: () => { setOpen(false); setNote(""); } });

  return (
    <li className="flex flex-col gap-2 px-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={status === "done"}
          aria-label={`Mark ${item.title} as ${status === "done" ? "not recorded" : "done"}`}
          disabled={log_.isPending}
          onClick={() => record(status === "done" ? "pending" : "done")}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
            status === "done" ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary",
          )}
        >
          {status === "done" && <Check className="size-4" aria-hidden="true" />}
        </button>
        <span className="text-data w-12 text-sm text-muted-foreground">{formatTime(item.scheduled_time)}</span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", status === "done" && "text-muted-foreground line-through")}>
            <span aria-hidden="true">{cat.emoji} </span>{item.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {cat.label}{item.details ? ` · ${item.details}` : ""}
            {log && log.status !== "pending" && (
              <> · {log.done_at ? `at ${formatInZone(log.done_at, timeZone)}` : `recorded ${formatInZone(log.created_at, timeZone)}`} by {SOURCE_LABEL[log.source]}{log.note ? ` — “${log.note}”` : ""}</>
            )}
          </p>
        </div>
        <StatusBadge tone={overdue ? "critical" : STATUS_TONE[status]}>
          {overdue ? "Overdue" : STATUS_LABEL[status]}
        </StatusBadge>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => record("missed")} disabled={log_.isPending} aria-label={`Mark ${item.title} missed`}><X aria-hidden="true" /> Missed</Button>
          <Button size="sm" variant="ghost" onClick={() => record("skipped")} disabled={log_.isPending} aria-label={`Mark ${item.title} skipped`}><Minus aria-hidden="true" /> Skip</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Details</Button>
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.title}`}><Pencil aria-hidden="true" /></Button>
        </div>
      </div>
      {open && (
        <div className="ml-10 flex flex-wrap items-end gap-2">
          <label className="text-sm">Time done<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" /></label>
          <label className="min-w-48 flex-1 text-sm">Note<Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. took after breakfast" /></label>
          <Button onClick={() => record("done")} disabled={log_.isPending}>Save as done</Button>
          {status !== "pending" && <Button variant="outline" onClick={() => record("pending")} disabled={log_.isPending}><RotateCcw aria-hidden="true" /> Clear</Button>}
        </div>
      )}
      {log_.isError && <p role="alert" className="ml-10 text-sm text-destructive">{log_.error.message}</p>}
    </li>
  );
}

function AiUpdate({
  seniorId,
  date,
  timeZone,
  entries,
}: {
  seniorId: string;
  date: string;
  timeZone: string;
  entries: DayEntry[];
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Extract<InterpretResult, { ok: true }> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedNewItems, setPickedNewItems] = useState<Set<number>>(new Set());
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(false);
  const [autoApplyCountdown, setAutoApplyCountdown] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechRecRef = useRef<any>(null);
  const speechAccumulatedRef = useRef<string>("");

  const runInterpret = useServerFn(interpretRoutineUpdate);
  const runTranscribe = useServerFn(transcribeRoutineAudio);
  const runSaveItem = useServerFn(saveRoutineItem);
  const qc = useQueryClient();

  const ask = useMutation({
    mutationFn: (overrideText?: string | void) =>
      runInterpret({ data: { seniorId, date, text: (typeof overrideText === "string" ? overrideText : text) } }),
    onSuccess: (r) => {
      if (r.ok) {
        setResult(r);
        setPicked(new Set(r.updates.map((u) => u.item_id)));
        setPickedNewItems(new Set((r.new_items || []).map((_, i) => i)));

        // If auto-apply is toggled on and suggestions are found, start a 3-second quick apply countdown
        if (autoApply && (r.updates.length > 0 || (r.new_items && r.new_items.length > 0))) {
          setAutoApplyCountdown(3);
        }
      }
    },
  });

  const save = useLog(seniorId);
  const byId = useMemo(() => new Map(entries.map((e) => [e.item.id, e.item])), [entries]);

  // Clean up streams & timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      }
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {}
      }
    };
  }, []);

  // Handle auto-apply countdown
  useEffect(() => {
    if (autoApplyCountdown === null) return;
    if (autoApplyCountdown > 0) {
      countdownTimerRef.current = setTimeout(() => {
        setAutoApplyCountdown((c) => (c !== null ? c - 1 : null));
      }, 1000);
    } else if (autoApplyCountdown === 0) {
      setAutoApplyCountdown(null);
      directApply();
    }
    return () => {
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    };
  }, [autoApplyCountdown, result]);

  const startVoiceRecording = async () => {
    setVoiceNotice(null);
    setSuccessFeedback(null);
    setResult(null);
    setAutoApplyCountdown(null);
    chunksRef.current = [];
    speechAccumulatedRef.current = "";

    // 1. Try starting Web Speech API for real-time dictation into the textarea
    const SpeechRec =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "hi-IN"; // Covers Hindi, Hinglish and Indian English
        rec.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          speechAccumulatedRef.current = currentTranscript;
          setText(currentTranscript);
        };
        rec.onerror = () => {
          // Handled gracefully by MediaRecorder fallback
        };
        rec.start();
        speechRecRef.current = rec;
      } catch {
        // Fallback to MediaRecorder
      }
    }

    // 2. Start MediaRecorder for high-fidelity audio capture (with Groq Whisper STT)
    if (!navigator?.mediaDevices?.getUserMedia) {
      if (!SpeechRec) {
        setVoiceNotice("Microphone recording is not supported in this browser. Please type your update.");
        return;
      }
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      if (!SpeechRec) {
        setVoiceNotice("Microphone access was denied. Please allow microphone permissions in your browser.");
        return;
      }
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    }
  };

  const stopVoiceRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);

    // Stop speech recognition
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
      speechRecRef.current = null;
    }

    const liveText = speechAccumulatedRef.current.trim();

    // Stop media recorder
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
    }

    // If live dictation captured sufficient text, use it directly!
    if (liveText.length >= 2) {
      setText(liveText);
      ask.mutate(liveText);
      return;
    }

    // Otherwise, transcribe recorded audio via Groq Whisper server function
    const chunks = chunksRef.current;
    if (chunks.length > 0) {
      setIsTranscribing(true);
      try {
        const mime = recorder?.mimeType || "audio/webm";
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: mime });
        const file = new File([blob], `routine_audio.${ext}`, { type: mime });

        const formData = new FormData();
        formData.append("audio", file);
        formData.append("seniorId", seniorId);

        const res = await runTranscribe({ data: formData });
        if (res.ok && res.text) {
          const transcribed = res.text.trim();
          setText(transcribed);
          ask.mutate(transcribed);
        } else if (!res.ok) {
          setVoiceNotice(res.message);
        }
      } catch (err: unknown) {
        setVoiceNotice(err instanceof Error ? err.message : "Failed to transcribe audio.");
      } finally {
        setIsTranscribing(false);
      }
    }
  };

  const cancelVoiceRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
      speechRecRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
  };

  const directApply = async () => {
    if (!result) return;
    setAutoApplyCountdown(null);

    const list = result.updates.filter((u) => picked.has(u.item_id));
    const newItemsToSave = (result.new_items || []).filter((_, idx) =>
      pickedNewItems.has(idx),
    );

    let savedCount = 0;

    // 1. Save routine logs
    if (list.length > 0) {
      await save.mutateAsync(
        list.map((u) => ({
          itemId: u.item_id,
          date,
          status: u.status,
          doneAt: u.status === "done" && u.time ? zonedTimeToIso(date, u.time, timeZone) : null,
          note: u.note,
          source: "ai_assist" as const,
          clientRequestId: crypto.randomUUID(),
        })),
      );
      savedCount += list.length;
    }

    // 2. Save any newly requested routine items
    if (newItemsToSave.length > 0) {
      for (const item of newItemsToSave) {
        await runSaveItem({
          data: {
            seniorId,
            itemId: null,
            category: item.category,
            title: item.title,
            details: item.details ?? null,
            time: item.time,
            days: [1, 2, 3, 4, 5, 6, 7],
            active: true,
          },
        });
        savedCount++;
      }
      await qc.invalidateQueries({ queryKey: ["routine", seniorId] });
    }

    setSuccessFeedback(
      `Directly updated ${savedCount} item${savedCount === 1 ? "" : "s"} in the daily routine!`,
    );
    setResult(null);
    setText("");
    setTimeout(() => setSuccessFeedback(null), 5000);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <section className="surface flex flex-col gap-3 p-5" aria-labelledby="ai-upd-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ai-upd-h" className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Update by telling the AI
          </h2>
          <p className="text-sm text-muted-foreground">
            Type or speak what happened in English, Hindi or Hinglish, e.g. “subah ki BP wali dawai 9 baje li, lunch nahi kiya”.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
              className="size-3.5 rounded border-input"
            />
            <span className="flex items-center gap-1">
              <Zap className="size-3 text-amber-500" />
              Direct auto-apply
            </span>
          </label>
        </div>
      </div>

      {/* Voice Recording / Transcribing active banner */}
      {isRecording && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-red-500" />
            </span>
            <span className="font-medium text-foreground">Listening... speak your care update</span>
            <span className="font-mono text-xs text-muted-foreground">({formatTimer(recordingSeconds)})</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={stopVoiceRecording} className="bg-red-600 hover:bg-red-700 text-white">
              <Square className="mr-1 size-3.5 fill-current" /> Stop & Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelVoiceRecording}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isTranscribing && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Transcribing voice update with AI Whisper...</span>
        </div>
      )}

      {voiceNotice && (
        <Notice tone="warning" title="Voice notice">
          {voiceNotice}
        </Notice>
      )}

      {successFeedback && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
          <Check className="size-4 text-emerald-600" />
          <span>{successFeedback}</span>
        </div>
      )}

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Type or click the microphone to speak, e.g. “Dada ji ne subah ki BP dawai 9 baje li, lunch ho gaya”..."
        aria-label="Describe today's updates"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => ask.mutate()}
          disabled={text.trim().length < 2 || ask.isPending || isRecording || isTranscribing}
        >
          {ask.isPending ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" />
              Interpreting…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 size-4" />
              Suggest updates
            </>
          )}
        </Button>

        {!isRecording ? (
          <Button
            type="button"
            variant="outline"
            onClick={startVoiceRecording}
            disabled={ask.isPending || isTranscribing}
            className="flex items-center gap-1.5"
          >
            <Mic className="size-4 text-primary" />
            <span>Speak update</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            onClick={stopVoiceRecording}
            className="flex items-center gap-1.5"
          >
            <Square className="size-4 fill-current" />
            <span>Finish speaking</span>
          </Button>
        )}
      </div>

      {ask.data && !ask.data.ok && (
        <Notice tone="warning" title="No suggestions">
          {ask.data.message}
        </Notice>
      )}

      {result && (
        <div className="flex flex-col gap-3 rounded-lg border p-4 bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-2">
              <span>Suggested updates</span>
              <StatusBadge tone="warning">Unverified — please confirm</StatusBadge>
            </p>
            {autoApplyCountdown !== null && (
              <span className="text-xs font-semibold text-amber-600 animate-pulse">
                Directly applying in {autoApplyCountdown}s...
              </span>
            )}
          </div>

          {result.updates.length === 0 && (!result.new_items || result.new_items.length === 0) && (
            <p className="text-sm text-muted-foreground">The AI couldn't match anything to the schedule.</p>
          )}

          {/* Matched Scheduled Routine Items */}
          {result.updates.map((u) => {
            const it = byId.get(u.item_id);
            if (!it) return null;
            return (
              <label key={u.item_id} className="flex items-start gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-1 size-4 rounded border-input"
                  checked={picked.has(u.item_id)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(u.item_id);
                    else n.delete(u.item_id);
                    setPicked(n);
                  }}
                />
                <span>
                  <strong>{it.title}</strong> ({formatTime(it.scheduled_time)}) →{" "}
                  <span className="font-semibold text-primary">{STATUS_LABEL[u.status]}</span>
                  {u.time ? ` at ${u.time}` : ""}
                  {u.note ? ` — “${u.note}”` : ""}
                </span>
              </label>
            );
          })}

          {/* New Scheduled Items Detected by Voice/Text */}
          {result.new_items && result.new_items.map((item, idx) => (
            <label key={`new_${idx}`} className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-1 size-4 rounded border-input"
                checked={pickedNewItems.has(idx)}
                onChange={(e) => {
                  const n = new Set(pickedNewItems);
                  if (e.target.checked) n.add(idx);
                  else n.delete(idx);
                  setPickedNewItems(n);
                }}
              />
              <span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">+ Add to routine plan:</span>{" "}
                <strong>{item.title}</strong> ({item.time}) · {ROUTINE_CATEGORIES[item.category]?.label || item.category}
                {item.details ? ` — “${item.details}”` : ""}
              </span>
            </label>
          ))}

          {result.unmatched.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not matched to schedule: {result.unmatched.join("; ")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={directApply}
              disabled={picked.size + pickedNewItems.size === 0 || save.isPending}
              className="bg-primary hover:bg-primary/90"
            >
              <Check className="mr-1.5 size-4" />
              Apply {picked.size + pickedNewItems.size} update{picked.size + pickedNewItems.size === 1 ? "" : "s"} directly
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setAutoApplyCountdown(null);
              }}
            >
              Discard
            </Button>
          </div>

          {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        </div>
      )}
    </section>
  );
}

function ManageList({ items, onEdit }: { items: RoutineItem[]; onEdit: (i: RoutineItem) => void }) {
  return (
    <section className="surface p-5" aria-labelledby="manage-h">
      <h2 id="manage-h" className="font-semibold">Routine plan</h2>
      <ul className="mt-2 divide-y text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2">
            <span className="text-data w-12">{formatTime(i.scheduled_time)}</span>
            <span className="flex-1">
              {ROUTINE_CATEGORIES[i.category].emoji} {i.title}
              <span className="text-muted-foreground"> · {i.days_of_week.length === 7 ? "Every day" : i.days_of_week.map((d) => DAYS[d - 1]).join(", ")}</span>
            </span>
            {!i.active && <StatusBadge tone="neutral">Paused</StatusBadge>}
            <Button size="sm" variant="ghost" onClick={() => onEdit(i)}>Edit</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemDialog({ seniorId, item, onClose }: { seniorId: string; item: RoutineItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const run = useServerFn(saveRoutineItem);
  const [category, setCategory] = useState<RoutineCategory>(item?.category ?? "medication");
  const [title, setTitle] = useState(item?.title ?? "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [time, setTime] = useState(item ? formatTime(item.scheduled_time) : "09:00");
  const [days, setDays] = useState<number[]>(item?.days_of_week ?? [1, 2, 3, 4, 5, 6, 7]);
  const [active, setActive] = useState(item?.active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const r = await run({ data: { seniorId, itemId: item?.id ?? null, category, title, details: details.trim() || null, time, days, active } });
      if (!r.ok) throw new Error(r.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["routine", seniorId] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit routine item" : "Add routine item"}</DialogTitle>
          <DialogDescription>Medicines, meals, sleep and other things that should happen at a set time.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <label className="text-sm font-medium">Type
            <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as RoutineCategory)}>
              {Object.entries(ROUTINE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Name
            <Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Amlodipine 5 mg" />
          </label>
          <label className="text-sm font-medium">Details (optional)
            <Input maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. after breakfast, 1 tablet" />
          </label>
          <label className="text-sm font-medium">Time
            <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Days</legend>
            <div className="mt-1 flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = days.includes(i + 1);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== i + 1) : [...days, i + 1])}
                    className={cn("min-h-9 rounded-md border px-3 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {item && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (uncheck to pause)
            </label>
          )}
          {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || days.length === 0 || !title.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
