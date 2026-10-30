import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ClipboardCheck, Info, ScanSearch, Sparkles, Sun } from "lucide-react";

import { Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatInZone } from "@/lib/seniors";
import { generateWellbeingSummary } from "@/lib/summary.functions";
import { DOMAIN_LABEL, PRIORITY_LABEL, QUALITY_LABEL } from "@/risk/labels";
import type { QualityStatus, ReviewPriority } from "@/risk/engine";

/**
 * "Current status" panel. Left: the rules engine's latest saved review level
 * (the only risk indication in Sahaara). Right: an on-demand AI narrative of
 * the last 14 days — unverified, not saved, never a score.
 */
export function WellbeingSummary({
  seniorId,
  timeZone,
  leftSlot,
}: {
  seniorId: string;
  timeZone: string;
  leftSlot?: React.ReactNode;
}) {
  const assessment = useQuery({
    queryKey: ["risk_assessments", seniorId, "latest-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_assessments")
        .select("priority, data_quality, changed_domains, created_at")
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as {
        priority: ReviewPriority;
        data_quality: QualityStatus;
        changed_domains: string[];
        created_at: string;
      } | null;
    },
  });
  const run = useServerFn(generateWellbeingSummary);
  const gen = useMutation({ mutationFn: () => run({ data: { seniorId } }) });
  const a = assessment.data;
  const p = a ? PRIORITY_LABEL[a.priority] : null;
  const res = gen.data;

  return (
    <section
      aria-labelledby="status-h"
      className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start"
    >
      <h2 id="status-h" className="sr-only">
        Current status
      </h2>

      {/* Left Column: Review level + Profile & Care context */}
      <div className="flex flex-col gap-4">
        <div className="surface flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <ScanSearch className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-semibold">Review level</h3>
            <span className="ml-auto text-xs text-muted-foreground">From the rules engine</span>
          </div>
          {assessment.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : assessment.isError ? (
            <Notice tone="critical" title="Couldn't load the latest assessment." />
          ) : !a || !p ? (
            <p className="text-sm text-muted-foreground">
              No assessment has been run yet. Run one from the "Review & follow-ups" tab.
            </p>
          ) : (
            <>
              <div>
                <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">{p.help}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Data</dt>
                <dd>{QUALITY_LABEL[a.data_quality]}</dd>
                <dt className="text-muted-foreground">Changes in</dt>
                <dd>
                  {a.changed_domains.length
                    ? a.changed_domains.map((d) => DOMAIN_LABEL[d] ?? d).join(", ")
                    : "None found in evaluated rules"}
                </dd>
                <dt className="text-muted-foreground">Assessed</dt>
                <dd>{formatInZone(a.created_at, timeZone)}</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                Sahaara shows review levels, not risk scores or diagnoses.
              </p>
            </>
          )}
        </div>

        {leftSlot}
      </div>

      <div className="surface flex flex-col gap-3 border-dashed p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-semibold">AI summary of the last 14 days</h3>
          <StatusBadge tone="warning">Unverified</StatusBadge>
          <Button
            size="sm"
            variant={res?.ok ? "outline" : "default"}
            className="ml-auto"
            loading={gen.isPending}
            onClick={() => gen.mutate()}
          >
            {!gen.isPending && <Sparkles aria-hidden="true" />}
            {res?.ok ? "Regenerate" : "Generate summary"}
          </Button>
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {!res && !gen.isPending && !gen.isError && (
            <p className="text-sm text-muted-foreground">
              Reads this person's observations and care notes from the last 14 days and writes a
              short update: how they've been, what was recorded today, and what data is missing. It
              is not saved and does not change any record.
            </p>
          )}
          {gen.isError && <Notice tone="critical" title="The summary couldn't be generated." />}
          {res && !res.ok && (
            <Notice tone="info" title="No summary">
              {res.message}
            </Notice>
          )}
          {res?.ok && (
            <>
              <p className="text-lg font-semibold leading-snug">{res.summary.headline}</p>
              <div className="flex items-start gap-2 rounded-lg bg-background-subtle p-3 text-sm">
                <Sun className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                  <span className="font-semibold">Today: </span>
                  {res.summary.today ?? "Nothing has been recorded today."}
                </p>
              </div>
              {res.summary.points.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {res.summary.points.map((pt, i) => (
                    <li key={i} className="flex gap-2">
                      <Info
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>
                        {pt.text}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({pt.evidence_ids.length} record{pt.evidence_ids.length === 1 ? "" : "s"})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {res.summary.notes_summary && (
                <p className="text-sm">
                  <span className="font-semibold">Care notes: </span>
                  {res.summary.notes_summary}
                </p>
              )}
              {res.summary.data_gaps.length > 0 && (
                <div className="text-sm">
                  <p className="flex items-center gap-1.5 font-semibold text-warning">
                    <AlertTriangle className="size-4" aria-hidden="true" /> Missing or old data
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {res.summary.data_gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {res.summary.suggested_checks.length > 0 && (
                <div className="text-sm">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <ClipboardCheck className="size-4" aria-hidden="true" /> Things to check
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {res.summary.suggested_checks.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                AI-generated from {res.observationCount} records at{" "}
                {formatInZone(res.generatedAt, timeZone)}. Check the observation history before
                acting. Not a diagnosis or risk score.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
