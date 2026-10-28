import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarCheck, ClipboardList, FileText, Info } from "lucide-react";

import { DailyVolumeCard } from "@/components/charts/daily-volume";
import { StatusBars } from "@/components/charts/charts";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { MetricCard, MetricGrid } from "@/components/shell/metric";
import { Page, Section } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { tally } from "@/lib/charts";
import { REPORT_STATUS_LABEL } from "@/lib/reports";
import { CASE_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/review-labels";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Sahaara" },
      { name: "description", content: "Cohort activity, review workload and data coverage." },
      { property: "og:title", content: "Reports — Sahaara" },
      {
        property: "og:description",
        content: "Cohort activity, review workload and data coverage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

// care_reports is not in the generated types yet (Phase 7 table); read it untyped.
const untyped = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: Error | null }>;
    };
  };
};
const DAYS = 30;
const CAP = 5000;
const COVERAGE_DAYS = 7;

function ReportsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      breadcrumbs={[{ label: "Reports" }]}
      title="Reports"
      description="Counts and trends computed from your organisation's records. Definitions are listed under each chart."
    >
      <CareAccessGate userId={user.id}>{() => <Body />}</CareAccessGate>
    </Page>
  );
}

/** All reads go through the signed-in user's row-level security. */
function useCohort() {
  return useQuery({
    queryKey: ["cohort-report", DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
      const coverageSince = new Date(Date.now() - COVERAGE_DAYS * 86_400_000).toISOString();
      const [obs, cases, tasks, reports, seniors] = await Promise.all([
        supabase
          .from("observations")
          .select("observed_at, senior_id")
          .gte("observed_at", since)
          .limit(CAP),
        supabase.from("review_cases").select("status").limit(CAP),
        supabase.from("follow_up_tasks").select("status, due_at").limit(CAP),
        untyped.from("care_reports").select("status").limit(CAP),
        supabase.from("seniors").select("id").eq("care_status", "active").limit(CAP),
      ]);
      for (const r of [obs, cases, tasks, reports, seniors]) if (r.error) throw r.error;
      const o = (obs.data ?? []) as { observed_at: string; senior_id: string }[];
      const recent = new Set(
        o.filter((x) => x.observed_at >= coverageSince).map((x) => x.senior_id),
      );
      const active = (seniors.data ?? []) as { id: string }[];
      return {
        observedAt: o.map((x) => x.observed_at),
        obsTruncated: o.length === CAP,
        caseStatus: ((cases.data ?? []) as { status: keyof typeof CASE_STATUS_LABEL }[]).map(
          (c) => c.status,
        ),
        tasks: (tasks.data ?? []) as {
          status: keyof typeof TASK_STATUS_LABEL;
          due_at: string | null;
        }[],
        reportStatus: (
          (reports.data ?? []) as unknown as { status: keyof typeof REPORT_STATUS_LABEL }[]
        ).map((r) => r.status),
        activeSeniors: active.length,
        withoutRecent: active.filter((s) => !recent.has(s.id)).length,
      };
    },
  });
}

function Body() {
  const q = useCohort();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (q.isPending)
    return (
      <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading reports">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    );
  if (q.isError)
    return (
      <Notice tone="critical" title="Couldn't load reports">
        {(q.error as Error).message}
      </Notice>
    );
  const d = q.data;
  const now = Date.now();
  const openTasks = d.tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const overdue = openTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
  const awaitingReview = d.reportStatus.filter((s) => s === "pending_review").length;

  return (
    <>
      <MetricGrid label="Cohort summary">
        <div role="listitem">
          <MetricCard
            icon={Activity}
            label="Active seniors"
            value={d.activeSeniors}
            link={{ to: "/seniors" }}
          />
        </div>
        <div role="listitem">
          <MetricCard
            icon={Info}
            label={`No observation in ${COVERAGE_DAYS} days`}
            value={d.withoutRecent}
            hint="Active seniors with no recent data — not a sign they are well"
            emphasis={d.withoutRecent > 0}
          />
        </div>
        <div role="listitem">
          <MetricCard
            icon={CalendarCheck}
            label="Overdue follow-ups"
            value={overdue}
            emphasis={overdue > 0}
            link={{ to: "/follow-ups" }}
          />
        </div>
        <div role="listitem">
          <MetricCard
            icon={FileText}
            label="Reports awaiting review"
            value={awaitingReview}
            emphasis={awaitingReview > 0}
          />
        </div>
      </MetricGrid>

      <DailyVolumeCard
        title="Observation volume"
        timestamps={d.observedAt}
        days={DAYS}
        timeZone={tz}
        unit="observations"
        truncated={d.obsTruncated}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown
          icon={ClipboardList}
          title="Review cases by status"
          definition="Every review case in your organisation, open or closed."
          rows={tally(
            d.caseStatus,
            Object.keys(CASE_STATUS_LABEL) as (keyof typeof CASE_STATUS_LABEL)[],
          ).map((r) => ({ label: CASE_STATUS_LABEL[r.key].label, count: r.count }))}
        />
        <Breakdown
          icon={CalendarCheck}
          title="Follow-up tasks by status"
          definition={`All follow-up tasks. ${overdue} open task${overdue === 1 ? " is" : "s are"} past due.`}
          rows={tally(
            d.tasks.map((t) => t.status),
            Object.keys(TASK_STATUS_LABEL) as (keyof typeof TASK_STATUS_LABEL)[],
          ).map((r) => ({ label: TASK_STATUS_LABEL[r.key].label, count: r.count }))}
        />
        <Breakdown
          icon={FileText}
          title="Written reports & voice notes"
          definition="Submitted reports by review stage. AI suggestions inside them stay unverified until a person confirms them."
          rows={tally(
            d.reportStatus,
            Object.keys(REPORT_STATUS_LABEL) as (keyof typeof REPORT_STATUS_LABEL)[],
          ).map((r) => ({ label: REPORT_STATUS_LABEL[r.key].label, count: r.count }))}
        />
      </div>

      <Section title="How these numbers are calculated">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            All figures are live counts of records your account is allowed to see; nothing is
            estimated.
          </li>
          <li>
            Observation volume uses the time each observation happened, grouped by day in your time
            zone ({tz}).
          </li>
          <li>
            "No observation in {COVERAGE_DAYS} days" means missing data. It is not evidence that a
            person is well.
          </li>
          <li>
            These reports describe activity. They are not risk scores or clinical assessments.
          </li>
        </ul>
      </Section>
    </>
  );
}

function Breakdown({
  icon: Icon,
  title,
  definition,
  rows,
}: {
  icon: typeof Activity;
  title: string;
  definition: string;
  rows: { label: string; count: number }[];
}) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <section className="surface flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">{title}</h2>
        <span className="text-data ml-auto text-sm text-muted-foreground">{total} total</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">No records yet.</p>
      ) : (
        <StatusBars rows={rows} />
      )}
      <p className="text-xs text-muted-foreground">{definition}</p>
    </section>
  );
}
