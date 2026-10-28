import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  BASELINE_FIELDS,
  BASELINE_STATUS,
  buildBaseline,
  ENTRY_SOURCES,
  friendlyDbError,
  SOURCES,
  toLocalInputValue,
  type BaselineDraft,
  type BaselineField,
  type BaselineStatus,
  type ObservationDef,
} from "@/lib/seniors";
import { selectCls } from "@/lib/form-styles";

const fresh = (field: BaselineField = "resting_heart_rate"): BaselineDraft => ({
  field,
  status: "recorded",
  value1: "",
  value2: "",
  choice: "",
  note: "",
  capturedAt: toLocalInputValue(new Date()),
  source: "manual_entry",
});

export function RecordBaseline({ seniorId }: { seniorId: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<BaselineDraft>(() => fresh());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const qc = useQueryClient();
  const def: ObservationDef = BASELINE_FIELDS[d.field];
  const set = <K extends keyof BaselineDraft>(k: K, v: BaselineDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async (v: Extract<ReturnType<typeof buildBaseline>, { ok: true }>["value"]) => {
      const { error } = await supabase
        .from("senior_baselines")
        .insert({ ...v, senior_id: seniorId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["baselines", seniorId] });
      toast.success("Baseline saved");
      setD(fresh(d.field));
      setOpen(false);
    },
    onError: (e: { code?: string }) => setServerError(friendlyDbError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setServerError(null);
    const r = buildBaseline(d);
    if (!r.ok) return setErrors(r.errors as Record<string, string>);
    setErrors({});
    save.mutate(r.value);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="outline">Update baseline</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">Update baseline</DialogTitle>
          <DialogDescription>
            A reference point for this person — not a judgement of what is medically normal. Earlier
            values are kept.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-5">
          {serverError && <Notice tone="critical" title={serverError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bl-field">Baseline</Label>
              <select
                id="bl-field"
                className={selectCls}
                value={d.field}
                onChange={(e) => {
                  setD(fresh(e.target.value as BaselineField));
                  setErrors({});
                }}
              >
                {Object.entries(BASELINE_FIELDS).map(([k, f]) => (
                  <option key={k} value={k}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bl-status">Status</Label>
              <select
                id="bl-status"
                className={selectCls}
                value={d.status}
                onChange={(e) => set("status", e.target.value as BaselineStatus)}
              >
                {Object.entries(BASELINE_STATUS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {d.status === "recorded" && def.kind === "numeric" && (
            <Field
              id="bl-value1"
              type="number"
              inputMode="decimal"
              step={def.step}
              label={`Value (${def.unit})`}
              value={d.value1}
              onChange={(e) => set("value1", e.target.value)}
              error={errors["value1"]}
            />
          )}
          {d.status === "recorded" && def.kind === "pair" && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                id="bl-value1"
                type="number"
                label="Systolic (mmHg)"
                value={d.value1}
                onChange={(e) => set("value1", e.target.value)}
                error={errors["value1"]}
              />
              <Field
                id="bl-value2"
                type="number"
                label="Diastolic (mmHg)"
                value={d.value2}
                onChange={(e) => set("value2", e.target.value)}
                error={errors["value2"]}
              />
            </div>
          )}
          {d.status === "recorded" && def.kind === "choice" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="bl-choice">Value</Label>
              <select
                id="bl-choice"
                className={selectCls}
                value={d.choice}
                onChange={(e) => set("choice", e.target.value)}
                aria-invalid={errors["choice"] ? true : undefined}
                aria-describedby={errors["choice"] ? "bl-choice-error" : undefined}
              >
                <option value="">Choose…</option>
                {Object.entries(def.options).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {errors["choice"] && (
                <p id="bl-choice-error" className="text-sm font-semibold text-critical">
                  {errors["choice"]}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="capturedAt"
              type="datetime-local"
              label="Captured / confirmed at"
              value={d.capturedAt}
              onChange={(e) => set("capturedAt", e.target.value)}
              error={errors["capturedAt"]}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor="bl-source">Source</Label>
              <select
                id="bl-source"
                className={selectCls}
                value={d.source}
                onChange={(e) => set("source", e.target.value as BaselineDraft["source"])}
              >
                {ENTRY_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCES[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bl-note">Note (optional)</Label>
            <Textarea
              id="bl-note"
              rows={2}
              value={d.note}
              onChange={(e) => set("note", e.target.value)}
            />
            {errors["note"] && (
              <p className="text-sm font-semibold text-critical">{errors["note"]}</p>
            )}
          </div>
          <Button type="submit" loading={save.isPending} className="self-start">
            Save baseline
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
