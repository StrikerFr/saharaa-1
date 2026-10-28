import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { selectCls } from "@/lib/form-styles";
import {
  buildObservation,
  ENTRY_SOURCES,
  friendlyDbError,
  OBSERVATION_TYPES,
  SOURCES,
  toLocalInputValue,
  type ObservationDef,
  type ObservationDraft,
  type ObservationType,
} from "@/lib/seniors";

const fresh = (): ObservationDraft => ({
  type: "heart_rate",
  value1: "",
  value2: "",
  choice: "",
  note: "",
  observedAt: toLocalInputValue(new Date()),
  source: "manual_entry",
});

export function RecordObservation({ seniorId }: { seniorId: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<ObservationDraft>(fresh);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // One idempotency key per draft: double-submits and retries can't create duplicates.
  const requestId = useRef(crypto.randomUUID());
  const qc = useQueryClient();
  const def: ObservationDef = OBSERVATION_TYPES[d.type];
  const set = <K extends keyof ObservationDraft>(k: K, v: ObservationDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async (
      v: NonNullable<ReturnType<typeof buildObservation> & { ok: true }>["value"],
    ) => {
      const { error } = await supabase
        .from("observations")
        .insert({ ...v, senior_id: seniorId, client_request_id: requestId.current });
      // A duplicate key here means the same draft already saved (e.g. network retry) — treat as saved.
      if (error && !(error.code === "23505" && error.message.includes("client_request_id")))
        throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["observations", seniorId] });
      qc.invalidateQueries({ queryKey: ["latest", seniorId] });
      toast.success("Observation saved");
      requestId.current = crypto.randomUUID();
      setD(fresh());
      setOpen(false);
    },
    onError: (e: { code?: string }) => setServerError(friendlyDbError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setServerError(null);
    const r = buildObservation(d);
    if (!r.ok) {
      setErrors(r.errors as Record<string, string>);
      return;
    }
    setErrors({});
    save.mutate(r.value);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!save.isPending) setOpen(o);
        if (o) {
          setServerError(null);
          setD((p) => ({ ...p, observedAt: toLocalInputValue(new Date()) }));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Record observation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">Record observation</DialogTitle>
          <DialogDescription>
            Record what was seen or reported. This is a record, not an assessment.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-5">
          {serverError && <Notice tone="critical" title={serverError} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="obs-type">Type</Label>
            <select
              id="obs-type"
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
              id="value1"
              type="number"
              inputMode="decimal"
              step={def.step}
              label={`${def.label} (${def.unit})`}
              value={d.value1}
              onChange={(e) => set("value1", e.target.value)}
              error={errors["value1"]}
            />
          )}
          {def.kind === "pair" && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                id="value1"
                type="number"
                inputMode="numeric"
                label="Systolic (mmHg)"
                value={d.value1}
                onChange={(e) => set("value1", e.target.value)}
                error={errors["value1"]}
              />
              <Field
                id="value2"
                type="number"
                inputMode="numeric"
                label="Diastolic (mmHg)"
                value={d.value2}
                onChange={(e) => set("value2", e.target.value)}
                error={errors["value2"]}
              />
            </div>
          )}
          {def.kind === "choice" && (
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={errors["choice"] ? "choice-error" : undefined}
            >
              <legend className="mb-1 text-sm font-medium">{def.label}</legend>
              {Object.entries(def.options).map(([k, l]) => (
                <label
                  key={k}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="radio"
                    name="choice"
                    value={k}
                    checked={d.choice === k}
                    onChange={() => set("choice", k)}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  {l}
                </label>
              ))}
              {errors["choice"] && (
                <p id="choice-error" className="text-sm font-semibold text-critical">
                  {errors["choice"]}
                </p>
              )}
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="note">{def.kind === "note" ? "Note" : "Note (optional)"}</Label>
            <Textarea
              id="note"
              rows={def.kind === "note" ? 5 : 2}
              value={d.note}
              onChange={(e) => set("note", e.target.value)}
              aria-invalid={errors["note"] ? true : undefined}
              aria-describedby={errors["note"] ? "note-error" : undefined}
            />
            {errors["note"] && (
              <p id="note-error" className="text-sm font-semibold text-critical">
                {errors["note"]}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="observedAt"
              type="datetime-local"
              label="Observed at"
              value={d.observedAt}
              onChange={(e) => set("observedAt", e.target.value)}
              error={errors["observedAt"]}
              hint="Your device's local time."
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor="source">Source</Label>
              <select
                id="source"
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
          </div>
          <p className="text-sm text-muted-foreground">
            Saved as unverified. The time you save it is recorded separately.
          </p>
          <Button type="submit" loading={save.isPending} className="self-start">
            Save observation
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
