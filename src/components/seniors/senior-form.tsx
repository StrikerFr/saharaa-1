import { useState, type FormEvent } from "react";
import type { z } from "zod";

import { Field } from "@/components/auth/field";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectCls } from "@/lib/form-styles";
import {
  CARE_STATUS,
  createSeniorSchema,
  LANGUAGES,
  seniorSchema,
  TIME_ZONES,
} from "@/lib/seniors";

export type SeniorFormValues = {
  recordCode: string;
  displayName: string;
  dateOfBirth: string;
  preferredLanguage: "en" | "hi" | "other";
  timeZone: (typeof TIME_ZONES)[number];
  careStatus: "active" | "paused" | "discharged";
  communicationNotes: string;
  careContext: string;
  isSynthetic: boolean;
};
export type SeniorParsed = z.infer<typeof createSeniorSchema>;

export const emptySenior: SeniorFormValues = {
  recordCode: "",
  displayName: "",
  dateOfBirth: "",
  preferredLanguage: "en",
  timeZone: "Asia/Kolkata",
  careStatus: "active",
  communicationNotes: "",
  careContext: "",
  isSynthetic: false,
};

export function SeniorForm({
  initial,
  mode,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  initial: SeniorFormValues;
  mode: "create" | "edit";
  submitting: boolean;
  serverError: string | null;
  onSubmit: (v: SeniorParsed) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof SeniorFormValues>(k: K, val: SeniorFormValues[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const schema =
      mode === "create"
        ? createSeniorSchema
        : seniorSchema.extend({ recordCode: createSeniorSchema.shape.recordCode.optional() });
    const p = schema.safeParse(v);
    if (!p.success) {
      const out: Record<string, string> = {};
      for (const i of p.error.issues) out[String(i.path[0])] ??= i.message;
      setErrors(out);
      document.getElementById(Object.keys(out)[0] ?? "")?.focus();
      return;
    }
    setErrors({});
    onSubmit({ ...p.data, recordCode: p.data.recordCode ?? v.recordCode } as SeniorParsed);
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
      {serverError && <Notice tone="critical" title={serverError} />}
      <div className="surface grid gap-5 p-6 sm:grid-cols-2">
        <Field
          id="displayName"
          label="Name"
          value={v.displayName}
          onChange={(e) => set("displayName", e.target.value)}
          error={errors["displayName"]}
          autoComplete="off"
        />
        <Field
          id="recordCode"
          label="Record ID"
          value={v.recordCode}
          onChange={(e) => set("recordCode", e.target.value)}
          error={errors["recordCode"]}
          hint={
            mode === "create"
              ? "Unique within your organisation. Can't be changed later."
              : "Record IDs can't be changed."
          }
          disabled={mode === "edit"}
          autoComplete="off"
        />
        <Field
          id="dateOfBirth"
          type="date"
          label="Date of birth (optional)"
          value={v.dateOfBirth}
          onChange={(e) => set("dateOfBirth", e.target.value)}
          error={errors["dateOfBirth"]}
          hint="Leave empty if not known."
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="careStatus">Care status</Label>
          <select
            id="careStatus"
            className={selectCls}
            value={v.careStatus}
            onChange={(e) => set("careStatus", e.target.value as SeniorFormValues["careStatus"])}
          >
            {Object.entries(CARE_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="preferredLanguage">Preferred language</Label>
          <select
            id="preferredLanguage"
            className={selectCls}
            value={v.preferredLanguage}
            onChange={(e) =>
              set("preferredLanguage", e.target.value as SeniorFormValues["preferredLanguage"])
            }
          >
            {Object.entries(LANGUAGES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="timeZone">Time zone</Label>
          <select
            id="timeZone"
            className={selectCls}
            value={v.timeZone}
            onChange={(e) => set("timeZone", e.target.value as SeniorFormValues["timeZone"])}
          >
            {TIME_ZONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="surface flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="communicationNotes">Communication preferences (optional)</Label>
          <Textarea
            id="communicationNotes"
            rows={3}
            value={v.communicationNotes}
            onChange={(e) => set("communicationNotes", e.target.value)}
            aria-invalid={errors["communicationNotes"] ? true : undefined}
            aria-describedby="communicationNotes-hint"
          />
          <p
            id="communicationNotes-hint"
            className={
              errors["communicationNotes"]
                ? "text-sm font-semibold text-critical"
                : "text-sm text-muted-foreground"
            }
          >
            {errors["communicationNotes"] ??
              "E.g. speaks slowly, prefers calls after 10am, hard of hearing on the left."}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="careContext">Care context (optional)</Label>
          <Textarea
            id="careContext"
            rows={4}
            value={v.careContext}
            onChange={(e) => set("careContext", e.target.value)}
            aria-invalid={errors["careContext"] ? true : undefined}
            aria-describedby="careContext-hint"
          />
          <p
            id="careContext-hint"
            className={
              errors["careContext"]
                ? "text-sm font-semibold text-critical"
                : "text-sm text-muted-foreground"
            }
          >
            {errors["careContext"] ??
              "Living situation and support arrangements. Record facts, not diagnoses."}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="isSynthetic"
            checked={v.isSynthetic}
            onCheckedChange={(c) => set("isSynthetic", c === true)}
            className="mt-1"
          />
          <Label htmlFor="isSynthetic" className="leading-relaxed">
            This is a synthetic test record, not a real person
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={submitting}>
          {mode === "create" ? "Create profile" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
