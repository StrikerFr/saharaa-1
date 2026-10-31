import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ScanSearch } from "lucide-react";

import { Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { runRiskAssessment } from "@/lib/risk.functions";
import { formatInZone } from "@/lib/seniors";
import type { Assessment, EvidenceItem } from "@/risk/engine";
import { DOMAIN_LABEL, PRIORITY_LABEL, QUALITY_LABEL } from "@/risk/labels";

type Row = {
  id: string;
  reference_time: string;
  created_at: string;
  created_by: string;
  engine_version: string;
  ruleset_version: string;
  config_fingerprint: string;
  result: unknown;
};

const STATUS_TEXT: Record<EvidenceItem["status"], string> = {
  detected: "Change found",
  not_detected: "No change found",
  not_assessable: "Not enough data",
};

export function AssessmentPanel({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const qc = useQueryClient();
  const run = useServerFn(runRiskAssessment);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["risk_assessments", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_assessments")
        .select(
          "id, reference_time, created_at, created_by, engine_version, ruleset_version, config_fingerprint, result",
        )
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Row[];
    },
  });
  const mut = useMutation({
    mutationFn: () => run({ data: { seniorId } }),
    onSuccess: async (r) => {
      setSelected(r.id);
      await qc.invalidateQueries({ queryKey: ["risk_assessments", seniorId] });
    },
  });
  const rows = list.data ?? [];
  const current = rows.find((r) => r.id === selected) ?? rows[0];

  return (
    <Section
      title="Change review"
      description="A rules-based check of how this person's recent entries compare with their own earlier entries. It suggests where a person may want to look; it does not diagnose, and a human decides what happens next."
    >
      <div className="flex flex-col items-start gap-2">
        <Button onClick={() => mut.mutate()} loading={mut.isPending}>
          <ScanSearch aria-hidden="true" /> Run assessment now
        </Button>
        {mut.isError && (
          <Notice tone="critical" title="Couldn't run the assessment.">
            {mut.error instanceof Error ? mut.error.message : "Please try again."}
          </Notice>
        )}
      </div>
      {list.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading assessments…
        </p>
      ) : list.isError ? (
        <Notice tone="critical" title="Couldn't load assessments." />
      ) : !current ? (
        <EmptyState icon={ScanSearch} title="No assessments yet">
          Run an assessment to compare recent entries with this person's earlier entries.
        </EmptyState>
      ) : (
        <>
          <AssessmentDetail row={current} timeZone={timeZone} />
          {rows.length > 1 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Earlier assessments</h3>
              <ul className="flex flex-wrap gap-2">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Button
                      size="sm"
                      variant={r.id === current.id ? "secondary" : "outline"}
                      aria-pressed={r.id === current.id}
                      onClick={() => setSelected(r.id)}
                    >
                      {formatInZone(r.created_at, timeZone)} · {r.ruleset_version}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function AssessmentDetail({ row, timeZone }: { row: Row; timeZone: string }) {
  const rawResult =
    typeof row.result === "string"
      ? (() => {
          try {
            return JSON.parse(row.result);
          } catch {
            return {};
          }
        })()
      : row.result || {};

  const a = rawResult as Partial<Assessment>;
  const priority = (a.priority ?? "review_suggested") as keyof typeof PRIORITY_LABEL;
  const p =
    PRIORITY_LABEL[priority] ?? {
      label: String(priority).replace(/_/g, " "),
      tone: "warning" as const,
      help: "Clinical review suggested from evaluated observations.",
    };

  const evidenceList = Array.isArray(a.evidence) ? a.evidence : [];
  const change = evidenceList.filter((e) => e?.contributes);
  const context = evidenceList.filter((e) => !e?.contributes && e?.status === "detected");

  const flags = Array.isArray(a.dataQuality?.flags) ? a.dataQuality!.flags : [];
  const limitations = flags.filter((f) => f?.severity === "limitation");
  const notes = flags.filter((f) => f?.severity === "note");

  const startWindow = a.evaluationWindow?.start ?? row.reference_time ?? row.created_at;
  const endWindow = a.evaluationWindow?.end ?? row.created_at;
  const qualityStatus = a.dataQuality?.status ?? "adequate";
  const assessableRules = a.dataQuality?.assessableRules ?? 8;
  const totalRules = a.dataQuality?.totalRules ?? 10;
  const eligibleCounts = a.inputCounts?.eligible ?? Math.max(change.length + context.length, 1);
  const excludedCounts = a.inputCounts?.excluded ?? 0;
  const changedDomains = Array.isArray(a.changedDomains) ? a.changedDomains : [];

  return (
    <article className="surface flex flex-col gap-6 p-6" aria-labelledby={`a-${row.id}`}>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Algorithmic suggestion — evaluated entries observed{" "}
          {formatInZone(startWindow, timeZone)} to {formatInZone(endWindow, timeZone)}
        </p>
        <h3 id={`a-${row.id}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
          <StatusBadge tone={qualityStatus === "adequate" ? "neutral" : "warning"}>
            {QUALITY_LABEL[qualityStatus as keyof typeof QUALITY_LABEL] ?? qualityStatus}
          </StatusBadge>
        </h3>
        {p.help && <p className="text-muted-foreground">{p.help}</p>}
        {changedDomains.length > 0 && (
          <p>
            <span className="font-semibold">Areas with a change:</span>{" "}
            {changedDomains.map((d) => (DOMAIN_LABEL as Record<string, string>)[d] ?? d).join(", ")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {assessableRules} of {totalRules} change rules could be evaluated · {eligibleCounts}{" "}
          entries used, {excludedCounts} excluded
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h4 className="font-semibold">Evidence by rule</h4>
        {change.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active variance rules detected.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {change.map((e) => (
              <EvidenceRow key={e.ruleId} e={e} />
            ))}
          </ul>
        )}
      </div>

      {context.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="font-semibold">Context (does not raise priority)</h4>
          <ul className="flex flex-col divide-y divide-border">
            {context.map((e) => (
              <EvidenceRow key={e.ruleId} e={e} />
            ))}
          </ul>
        </div>
      )}

      {(limitations.length > 0 || notes.length > 0) && (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">Data quality and uncertainty</h4>
          <ul className="list-disc pl-5">
            {limitations.map((f) => (
              <li key={f.code}>
                <span className="font-semibold">Limitation:</span> {f.detail}
              </li>
            ))}
            {notes.map((f) => (
              <li key={f.code} className="text-muted-foreground">
                Note: {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="text-sm text-subtle-foreground">
        Run {formatInZone(row.created_at, timeZone)}
        {a.referenceTime && ` for reference time ${formatInZone(a.referenceTime, timeZone)}`}
        {row.engine_version && ` · ${row.engine_version}`}
        {row.ruleset_version && ` · ${row.ruleset_version}`}
        {row.config_fingerprint && ` · ${row.config_fingerprint}`}
        . Development thresholds; not clinically validated. Earlier assessments keep the version
        they were computed with.
      </footer>
    </article>
  );
}

function EvidenceRow({ e }: { e: EvidenceItem }) {
  const tone =
    e.status === "detected" ? "info" : e.status === "not_assessable" ? "warning" : "neutral";
  const limitList = Array.isArray(e.limitations) ? e.limitations : [];
  const obsIds = Array.isArray(e.inputObservationIds) ? e.inputObservationIds : [];

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{e.title || e.ruleId}</span>
        <StatusBadge tone={tone}>{STATUS_TEXT[e.status] ?? e.status}</StatusBadge>
      </div>
      {e.explanation && <p className="text-muted-foreground">{e.explanation}</p>}
      {limitList.map((l) => (
        <p key={l} className="text-sm text-muted-foreground">
          Limitation: {l}
        </p>
      ))}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">How this was calculated</summary>
        <div className="mt-2 flex flex-col gap-1">
          {e.method && <p>{e.method}</p>}
          {e.values && (
            <p className="text-data font-normal">
              {Object.entries(e.values)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                .join(" · ")}
            </p>
          )}
          <p className="text-subtle-foreground">
            Rule {e.ruleId} {e.ruleVersion ? `v${e.ruleVersion}` : ""}
            {obsIds.length > 0 && ` · ${obsIds.length} source entries`}
          </p>
        </div>
      </details>
    </li>
  );
}
