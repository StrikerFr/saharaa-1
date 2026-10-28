import { useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Bot, CheckCircle2, ClipboardList, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { useAiStatus } from "@/components/reports/reports-section";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uuidSchema } from "@/lib/auth";
import {
  CERTAINTY_LABELS,
  CUE_TYPE_LABELS,
  POLARITY_LABELS,
  SPEAKER_LABELS,
  suggestObservation,
  TEMPORALITY_LABELS,
} from "@/lib/ai/cues";
import { selectCls } from "@/lib/form-styles";
import {
  canCorrectTranscript,
  canRetryExtraction,
  canReviewCue,
  EVENT_LABEL,
  LANGUAGE_LABEL,
  RELATION_LABEL,
  REPORT_STATUS_LABEL,
  type CareReportRow,
  type ReportCueRow,
} from "@/lib/reports";
import {
  confirmCue,
  correctTranscript,
  getReport,
  rejectCue,
  requestClarification,
  retryExtraction,
  speakConfirmedSummary,
} from "@/lib/reports.functions";
import {
  buildObservation,
  ENTRY_SOURCES,
  OBSERVATION_TYPES,
  SOURCES,
  toLocalInputValue,
  type ObservationDraft,
  type ObservationType,
} from "@/lib/seniors";

export const Route = createFileRoute("/_authenticated/seniors/$seniorId/reports/$reportId")({
  head: () => ({
    meta: [
      { title: "Review report — Sahaara" },
      {
        name: "description",
        content: "Review a wellbeing report and its unverified AI suggestions.",
      },
      { property: "og:title", content: "Review report — Sahaara" },
      {
        property: "og:description",
        content: "Review a wellbeing report and its unverified AI suggestions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { user } = Route.useRouteContext();
  const { seniorId, reportId } = Route.useParams();
  if (!uuidSchema.safeParse(reportId).success || !uuidSchema.safeParse(seniorId).success)
    return <Missing seniorId={seniorId} />;
  return (
    <CareAccessGate userId={user.id}>
      {() => <Review seniorId={seniorId} reportId={reportId} />}
    </CareAccessGate>
  );
}

function Missing({ seniorId }: { seniorId: string }) {
  return (
    <Page title="Report not found">
      <EmptyState icon={ClipboardList} title="This report isn't available">
        It may not exist, or you may not have access to it.
      </EmptyState>
      <BackLink seniorId={seniorId} />
    </Page>
  );
}

function BackLink({ seniorId }: { seniorId: string }) {
  return (
    <Button asChild variant="outline" className="self-start">
      <Link to="/seniors/$seniorId" params={{ seniorId }}>
        <ArrowLeft aria-hidden="true" /> Back to profile
      </Link>
    </Button>
  );
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

function Review({ seniorId, reportId }: { seniorId: string; reportId: string }) {
  const get = useServerFn(getReport);
  const ai = useAiStatus();
  const q = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => get({ data: { reportId } }),
  });
  if (q.isPending)
    return (
      <Page title="Loading report…">
        <p className="text-muted-foreground">Loading…</p>
      </Page>
    );
  if (q.isError)
    return (
      <Page title="Report">
        <Notice tone="critical" title={(q.error as Error).message} />
        <BackLink seniorId={seniorId} />
      </Page>
    );
  const { report, cues, events } = q.data;
  if (report.senior_id !== seniorId) return <Missing seniorId={seniorId} />;
  const st = REPORT_STATUS_LABEL[report.status];
  const current = cues.filter((c) => c.review_status !== "superseded");
  const confirmed = current.filter((c) => c.review_status === "confirmed");
  const audio = report.source_type === "transcribed_audio";

  return (
    <Page
      eyebrow={audio ? "Voice note" : "Written report"}
      title="Review report"
      description={`Submitted ${fmt(report.submitted_at)} · ${RELATION_LABEL[report.reporter_relation]} · ${LANGUAGE_LABEL[report.declared_language]}`}
      actions={<BackLink seniorId={seniorId} />}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        {report.event_time && (
          <span className="text-sm text-muted-foreground">
            Event time: {fmt(report.event_time)}
          </span>
        )}
      </div>

      <SourceText report={report} cues={current} />
      <ExtractionControls report={report} llm={!!ai.data?.llm} />

      <Section
        title="Suggestions"
        description="Generated by AI from the report. They are not clinical findings. Only what you confirm is recorded as an observation."
      >
        {report.status === "needs_clarification" && (
          <Notice tone="info" title="Clarification needed">
            {report.clarification_note ??
              "The AI could not interpret this report confidently. Check with the reporter, then correct the transcript or submit a new report."}
          </Notice>
        )}
        {current.length === 0 &&
          report.status !== "failed" &&
          report.status !== "pending_extraction" && (
            <p className="text-muted-foreground">
              No wellbeing suggestions were found in this report.
            </p>
          )}
        <ul className="flex flex-col gap-4">
          {current.map((c) => (
            <CueCard key={c.id} cue={c} report={report} />
          ))}
        </ul>
        {report.status !== "reviewed" && <Clarify reportId={report.id} />}
      </Section>

      {confirmed.length > 0 && <ReadAloud reportId={report.id} enabled={!!ai.data?.tts} />}

      <Section title="History">
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2">
              <span className="text-muted-foreground">{fmt(e.at)}</span>
              <span>{EVENT_LABEL[e.action] ?? e.action}</span>
            </li>
          ))}
        </ol>
        {report.llm_model && (
          <p className="text-sm text-muted-foreground">
            Model {report.llm_model} · schema {report.extraction_schema_version}
            {report.stt_model ? ` · transcription ${report.stt_model}` : ""}
          </p>
        )}
      </Section>
    </Page>
  );
}

function useInvalidate(reportId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["report", reportId] });
    void qc.invalidateQueries({ queryKey: ["reports"] });
  };
}

function SourceText({ report, cues }: { report: CareReportRow; cues: ReportCueRow[] }) {
  const audio = report.source_type === "transcribed_audio";
  const [draft, setDraft] = useState(report.reviewed_text ?? report.original_text);
  const [err, setErr] = useState<string | null>(null);
  const fix = useServerFn(correctTranscript);
  const invalidate = useInvalidate(report.id);
  const save = useMutation({
    mutationFn: () => fix({ data: { reportId: report.id, text: draft.trim() } }),
    onSuccess: () => {
      toast.success("Transcript correction saved");
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const editable = audio && canCorrectTranscript(report, cues);
  return (
    <Section
      title={audio ? "Transcript" : "Original report"}
      description={
        audio
          ? "Machine transcript from the voice note. It may contain errors — read it and correct it before analysis."
          : "Exactly as submitted."
      }
    >
      {audio && (
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="warning">Machine transcript · unverified</StatusBadge>
          {report.stt_language && (
            <span className="text-sm text-muted-foreground">
              Detected language: {report.stt_language}
            </span>
          )}
          {report.stt_duration_s != null && (
            <span className="text-sm text-muted-foreground">
              {report.stt_duration_s}s audio (not stored)
            </span>
          )}
        </div>
      )}
      <blockquote className="whitespace-pre-wrap rounded-xl border border-border bg-card p-4">
        {report.original_text}
      </blockquote>
      {report.reviewed_text && (
        <div>
          <p className="text-sm font-semibold">Corrected by a reviewer</p>
          <blockquote className="mt-1 whitespace-pre-wrap rounded-xl border border-border bg-card p-4">
            {report.reviewed_text}
          </blockquote>
        </div>
      )}
      {editable && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            if (!save.isPending) save.mutate();
          }}
        >
          <Label htmlFor="transcript-fix">Correct the transcript</Label>
          <Textarea
            id="transcript-fix"
            rows={4}
            maxLength={8000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {err && <Notice tone="critical" title={err} />}
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            disabled={save.isPending || !draft.trim()}
          >
            {save.isPending ? "Saving…" : "Save correction"}
          </Button>
        </form>
      )}
    </Section>
  );
}

function ExtractionControls({ report, llm }: { report: CareReportRow; llm: boolean }) {
  const retry = useServerFn(retryExtraction);
  const invalidate = useInvalidate(report.id);
  const [msg, setMsg] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => retry({ data: { reportId: report.id } }),
    onSuccess: (r) => {
      setMsg(r.ok ? null : r.message);
      if (r.ok) toast.success(`Analysis finished: ${r.cueCount} suggestion(s) to review`);
      invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  if (!canRetryExtraction(report.status)) return null;
  const first = report.status === "pending_extraction";
  return (
    <div className="flex flex-col gap-3">
      {report.status === "failed" && (
        <Notice tone="warning" title="AI analysis didn't complete">
          The report is saved and nothing was recorded. You can try the analysis again.
        </Notice>
      )}
      {msg && <Notice tone="critical" title={msg} />}
      {!llm ? (
        <Notice tone="info" title="AI analysis is not configured">
          The report is kept. Record observations manually from the profile.
        </Notice>
      ) : (
        <Button
          variant={first ? "default" : "outline"}
          className="self-start"
          disabled={run.isPending}
          onClick={() => {
            setMsg(null);
            run.mutate();
          }}
        >
          <Bot aria-hidden="true" />
          {run.isPending ? "Analysing…" : first ? "Analyse with AI" : "Re-run AI analysis"}
        </Button>
      )}
    </div>
  );
}

function CueCard({ cue, report }: { cue: ReportCueRow; report: CareReportRow }) {
  const c = cue.cue;
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reject = useServerFn(rejectCue);
  const invalidate = useInvalidate(report.id);
  const rej = useMutation({
    mutationFn: () => reject({ data: { cueId: cue.id, reason } }),
    onSuccess: () => {
      toast.success("Suggestion rejected");
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const confirmed = cue.review_status === "confirmed";
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{CUE_TYPE_LABELS[c.cueType]}</h3>
        {confirmed ? (
          <StatusBadge tone="success">Confirmed observation</StatusBadge>
        ) : cue.review_status === "rejected" ? (
          <StatusBadge tone="neutral">Rejected</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Unverified AI suggestion</StatusBadge>
        )}
      </div>
      <p>{cue.reviewer_description ?? c.description}</p>
      <blockquote className="border-l-4 border-border pl-3 text-muted-foreground">
        “{c.evidenceText}”
      </blockquote>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="inline font-semibold">Status: </dt>
          <dd className="inline">{POLARITY_LABELS[c.polarity]}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Time: </dt>
          <dd className="inline">
            {TEMPORALITY_LABELS[c.temporality]}
            {c.reportedTimeText ? ` (“${c.reportedTimeText}”)` : ""}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Wording: </dt>
          <dd className="inline">{CERTAINTY_LABELS[c.certainty]}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Source: </dt>
          <dd className="inline">{SPEAKER_LABELS[c.speaker]}</dd>
        </div>
        {c.statedMeasurement && (
          <div>
            <dt className="inline font-semibold">Stated value: </dt>
            <dd className="inline">{c.statedMeasurement} (as reported, not verified)</dd>
          </div>
        )}
      </dl>
      {c.limitations.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {c.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {cue.reject_reason && (
        <p className="text-sm text-muted-foreground">Reason: {cue.reject_reason}</p>
      )}
      {err && <Notice tone="critical" title={err} />}
      {canReviewCue(cue.review_status) && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setConfirming(true)}>
            <CheckCircle2 aria-hidden="true" /> Confirm…
          </Button>
          {!rejecting ? (
            <Button variant="outline" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (!rej.isPending) rej.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={`reason-${cue.id}`}>Reason (optional)</Label>
                <input
                  id={`reason-${cue.id}`}
                  className={selectCls}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={rej.isPending}>
                {rej.isPending ? "Rejecting…" : "Reject suggestion"}
              </Button>
            </form>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmDialog cue={cue} report={report} onClose={() => setConfirming(false)} />
      )}
    </li>
  );
}

function ConfirmDialog({
  cue,
  report,
  onClose,
}: {
  cue: ReportCueRow;
  report: CareReportRow;
  onClose: () => void;
}) {
  const sug = suggestObservation(cue.cue);
  const defaultSource =
    report.reporter_relation === "senior"
      ? "reported_by_senior"
      : report.reporter_relation === "family"
        ? "reported_by_family"
        : "manual_entry";
  const [d, setD] = useState<ObservationDraft>({
    type: sug.type,
    value1: sug.value1,
    value2: sug.value2,
    choice: sug.choice,
    note: sug.note,
    observedAt: toLocalInputValue(
      report.event_time ? new Date(report.event_time) : new Date(report.submitted_at),
    ),
    source: defaultSource,
  });
  const [desc, setDesc] = useState(cue.cue.description);
  const [errors, setErrors] = useState<
    Partial<Record<"value1" | "value2" | "choice" | "note" | "observedAt", string>>
  >({});
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);
  const confirm = useServerFn(confirmCue);
  const invalidate = useInvalidate(report.id);
  const qc = useQueryClient();
  const def = OBSERVATION_TYPES[d.type];
  const set = <K extends keyof ObservationDraft>(k: K, v: ObservationDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: (v: Extract<ReturnType<typeof buildObservation>, { ok: true }>["value"]) =>
      confirm({
        data: {
          cueId: cue.id,
          type: v.type,
          valueNumeric: v.value_numeric ?? null,
          valueNumeric2: v.value_numeric_2 ?? null,
          valueText: v.value_text ?? null,
          unit: (v.unit ?? null) as "bpm" | "mmHg" | "kg" | "h" | null,
          note: v.note ?? null,
          observedAt: v.observed_at,
          source: v.source as (typeof ENTRY_SOURCES)[number],
          description: desc,
        },
      }),
    onSuccess: () => {
      toast.success("Confirmed and recorded as an observation");
      void qc.invalidateQueries({ queryKey: ["observations", report.senior_id] });
      void qc.invalidateQueries({ queryKey: ["latest", report.senior_id] });
      invalidate();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
    onSettled: () => {
      busy.current = false;
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setErr(null);
    const r = buildObservation(d);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    busy.current = true;
    save.mutate(r.value);
  }
  const notDefinite = cue.cue.polarity !== "positive" || cue.cue.temporality !== "current";
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">Confirm as observation</DialogTitle>
          <DialogDescription>
            You are confirming that this was reported. It is saved as an unverified, reported
            observation and then counts in the next risk assessment.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {err && <Notice tone="critical" title={err} />}
          {notDefinite && (
            <Notice tone="info" title="Not a current, positive report">
              The AI read this as {POLARITY_LABELS[cue.cue.polarity].toLowerCase()} /{" "}
              {TEMPORALITY_LABELS[cue.cue.temporality].toLowerCase()}, so it defaults to a care
              note.
            </Notice>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-desc">Description (edit if the AI got it wrong)</Label>
            <Textarea
              id="c-desc"
              rows={2}
              maxLength={500}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-type">Record as</Label>
            <select
              id="c-type"
              className={selectCls}
              value={d.type}
              onChange={(e) => {
                set("type", e.target.value as ObservationType);
                setErrors({});
              }}
            >
              {Object.entries(OBSERVATION_TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {def.kind === "numeric" && (
            <Field
              id="c-v1"
              type="number"
              inputMode="decimal"
              step={def.step}
              label={`${def.label} (${def.unit})`}
              value={d.value1}
              error={errors.value1}
              onChange={(e) => set("value1", e.target.value)}
            />
          )}
          {def.kind === "pair" && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="c-v1"
                type="number"
                label="Systolic (mmHg)"
                value={d.value1}
                error={errors.value1}
                onChange={(e) => set("value1", e.target.value)}
              />
              <Field
                id="c-v2"
                type="number"
                label="Diastolic (mmHg)"
                value={d.value2}
                error={errors.value2}
                onChange={(e) => set("value2", e.target.value)}
              />
            </div>
          )}
          {def.kind === "choice" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-choice">{def.label}</Label>
              <select
                id="c-choice"
                className={selectCls}
                value={d.choice}
                onChange={(e) => set("choice", e.target.value)}
                aria-invalid={errors.choice ? true : undefined}
              >
                <option value="">Choose…</option>
                {Object.entries(def.options).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v as string}
                  </option>
                ))}
              </select>
              {errors.choice && (
                <p className="text-sm font-semibold text-critical">{errors.choice}</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-note">Note</Label>
            <Textarea
              id="c-note"
              rows={3}
              maxLength={2000}
              value={d.note}
              onChange={(e) => set("note", e.target.value)}
            />
            {errors.note && <p className="text-sm font-semibold text-critical">{errors.note}</p>}
          </div>
          <Field
            id="c-time"
            type="datetime-local"
            label="When it happened"
            value={d.observedAt}
            error={errors.observedAt}
            onChange={(e) => set("observedAt", e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-source">Source</Label>
            <select
              id="c-source"
              className={selectCls}
              value={d.source}
              onChange={(e) => set("source", e.target.value as ObservationDraft["source"])}
            >
              {ENTRY_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCES[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Confirm and record"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Clarify({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(requestClarification);
  const invalidate = useInvalidate(reportId);
  const m = useMutation({
    mutationFn: () => fn({ data: { reportId, note: note.trim() } }),
    onSuccess: () => {
      toast.success("Marked as needing clarification");
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });
  if (!open)
    return (
      <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        Mark as needing clarification
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (!m.isPending) m.mutate();
      }}
    >
      <Label htmlFor="clar-note">What needs clarifying?</Label>
      <Textarea
        id="clar-note"
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {err && <Notice tone="critical" title={err} />}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={m.isPending || note.trim().length < 2}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReadAloud({ reportId, enabled }: { reportId: string; enabled: boolean }) {
  const fn = useServerFn(speakConfirmedSummary);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => fn({ data: { reportId } }),
    onSuccess: (r) => {
      if (!r.ok) return setErr(r.message);
      setUrl(`data:${r.contentType};base64,${r.audioBase64}`);
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <Section
      title="Listen"
      description="Reads out only the observations a coordinator confirmed, without the senior's name. The text is sent to ElevenLabs to make the audio."
    >
      {!enabled ? (
        <Notice tone="info" title="Read-aloud is not configured" />
      ) : (
        <Button
          variant="outline"
          className="self-start"
          disabled={m.isPending}
          onClick={() => {
            setErr(null);
            m.mutate();
          }}
        >
          <Volume2 aria-hidden="true" />{" "}
          {m.isPending ? "Generating audio…" : "Read confirmed summary aloud"}
        </Button>
      )}
      {err && <Notice tone="critical" title={err} />}
      {url && (
        <audio
          controls
          autoPlay
          src={url}
          onError={() => setErr("This browser couldn't play the audio.")}
        >
          <track kind="captions" />
        </audio>
      )}
    </Section>
  );
}
