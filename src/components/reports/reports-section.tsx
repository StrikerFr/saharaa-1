import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileAudio, FileText, MessagesSquare } from "lucide-react";

import { NewReport } from "@/components/reports/new-report";
import { Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { REPORT_STATUS_LABEL } from "@/lib/reports";
import { getAiProviderStatus, listReports } from "@/lib/reports.functions";
import { formatInZone } from "@/lib/seniors";

export function useAiStatus() {
  const fn = useServerFn(getAiProviderStatus);
  return useQuery({ queryKey: ["ai-status"], queryFn: () => fn(), staleTime: 300_000 });
}

export function ReportsSection({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const status = useAiStatus();
  const list = useServerFn(listReports);
  const reports = useQuery({
    queryKey: ["reports", seniorId],
    queryFn: () => list({ data: { seniorId } }),
  });
  return (
    <Section
      title="Reports & voice notes"
      description="Written reports and voice notes. AI suggestions stay unverified until a coordinator reviews them."
    >
      <div className="flex flex-wrap items-center gap-3">
        <NewReport seniorId={seniorId} llm={!!status.data?.llm} stt={!!status.data?.stt} />
        {status.data && !status.data.tts && (
          <span className="text-sm text-muted-foreground">Read-aloud is not configured.</span>
        )}
      </div>
      {reports.isError && (
        <Notice tone="critical" title="Couldn't load reports">
          {(reports.error as Error).message}
        </Notice>
      )}
      {reports.data && reports.data.length === 0 && (
        <EmptyState icon={MessagesSquare} title="No reports yet">
          Submit a written report or a voice note to get started.
        </EmptyState>
      )}
      {reports.data && reports.data.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {reports.data.map((r) => {
            const s = REPORT_STATUS_LABEL[r.status];
            const Icon = r.source_type === "transcribed_audio" ? FileAudio : FileText;
            return (
              <li key={r.id}>
                <Link
                  to="/seniors/$seniorId/reports/$reportId"
                  params={{ seniorId, reportId: r.id }}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">
                        {r.source_type === "transcribed_audio" ? "Voice note" : "Written report"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        Submitted {formatInZone(r.submitted_at, timeZone)}
                      </span>
                    </span>
                  </span>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
