import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ClipboardList,
  Eye,
  FileText,
  Filter,
  Info,
  Mic,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";

import { DailyVolumeCard } from "@/components/charts/daily-volume";
import { StatusBars } from "@/components/charts/charts";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { MetricCard, MetricGrid } from "@/components/shell/metric";
import { Page, Section } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { tally } from "@/lib/charts";
import { REPORT_STATUS_LABEL } from "@/lib/reports";
import { CASE_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/review-labels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Clinical Reports & Analytics — Sahaara" },
      { name: "description", content: "Cohort activity, clinical review workload, and telemetry coverage." },
      { property: "og:title", content: "Clinical Reports & Analytics — Sahaara" },
      {
        property: "og:description",
        content: "Cohort activity, clinical review workload, and telemetry coverage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

const CAP = 5000;
const COVERAGE_DAYS = 7;

interface CareReportRow {
  id: string;
  senior_id: string;
  source_type: "typed_text" | "transcribed_audio";
  reporter_relation: "family" | "care_worker" | "coordinator";
  status: keyof typeof REPORT_STATUS_LABEL;
  original_text: string;
  submitted_at: string;
  seniors: {
    display_name: string;
    record_code: string;
  } | null;
}

function whenRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function ReportsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      breadcrumbs={[{ label: "Reports" }]}
      title="Cohort Reports & Analytics"
      description="Aggregated clinical health metrics, daily telemetry cadence, and care review workload across your organisation's active senior cohort."
    >
      <CareAccessGate userId={user.id}>{() => <Body />}</CareAccessGate>
    </Page>
  );
}

/** All reads go through the signed-in user's row-level security. */
function useCohort(days: number) {
  return useQuery({
    queryKey: ["cohort-report", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const coverageSince = new Date(Date.now() - COVERAGE_DAYS * 86_400_000).toISOString();

      const [obs, cases, tasks, reports, seniors] = await Promise.all([
        supabase
          .from("observations")
          .select("observed_at, senior_id")
          .gte("observed_at", since)
          .limit(CAP),
        supabase.from("review_cases").select("status").limit(CAP),
        supabase.from("follow_up_tasks").select("status, due_at").limit(CAP),
        (supabase as any)
          .from("care_reports")
          .select(
            "id, senior_id, source_type, reporter_relation, status, original_text, submitted_at, seniors(display_name, record_code)",
          )
          .order("submitted_at", { ascending: false })
          .limit(50),
        supabase.from("seniors").select("id").eq("care_status", "active").limit(CAP),
      ]);

      for (const r of [obs, cases, tasks, reports, seniors]) if (r.error) throw r.error;

      const o = (obs.data ?? []) as { observed_at: string; senior_id: string }[];
      const recent = new Set(
        o.filter((x) => x.observed_at >= coverageSince).map((x) => x.senior_id),
      );
      const active = (seniors.data ?? []) as { id: string }[];
      const reportRows = (reports.data ?? []) as unknown as CareReportRow[];

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
        reportRows,
        reportStatus: reportRows.map((r) => r.status),
        activeSeniors: active.length,
        withoutRecent: active.filter((s) => !recent.has(s.id)).length,
      };
    },
  });
}

function Body() {
  const [days, setDays] = useState<number>(30);
  const [reportFilter, setReportFilter] = useState<"all" | "pending" | "audio" | "family">("all");
  const q = useCohort(days);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (q.isPending)
    return (
      <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading reports">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-2xl" />
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
  const coveredCount = Math.max(0, d.activeSeniors - d.withoutRecent);
  const coveragePercent =
    d.activeSeniors > 0 ? Math.round((coveredCount / d.activeSeniors) * 100) : 100;

  // Filtered recent reports feed
  const filteredReports = d.reportRows.filter((r) => {
    if (reportFilter === "pending") return r.status === "pending_review";
    if (reportFilter === "audio") return r.source_type === "transcribed_audio";
    if (reportFilter === "family") return r.reporter_relation === "family";
    return true;
  });

  // Calculate daily telemetry stats
  const totalObs = d.observedAt.length;
  const dailyAvg = (totalObs / days).toFixed(1);

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Executive Cohort KPI Grid */}
      <MetricGrid label="Cohort summary">
        {/* Metric 1: Active Senior Cohort */}
        <div role="listitem">
          <MetricCard
            icon={Users}
            label="Active senior cohort"
            value={d.activeSeniors}
            hint="Seniors enrolled in daily monitoring"
            link={{ to: "/seniors" }}
          />
        </div>

        {/* Metric 2: 7-Day Telemetry Coverage */}
        <div role="listitem">
          <MetricCard
            icon={Activity}
            label={`7-Day telemetry coverage`}
            value={`${coveragePercent}%`}
            hint={
              d.withoutRecent > 0
                ? `${d.withoutRecent} senior pending observation (missing ≠ safe)`
                : "All seniors have observations this week"
            }
            emphasis={d.withoutRecent > 0}
          />
        </div>

        {/* Metric 3: Overdue Follow-up Tasks */}
        <div role="listitem">
          <MetricCard
            icon={CalendarCheck}
            label="Overdue follow-ups"
            value={overdue}
            hint={`${openTasks.length} total open tasks under care plan`}
            emphasis={overdue > 0}
            link={{ to: "/follow-ups" }}
          />
        </div>

        {/* Metric 4: Care Reports Awaiting Review */}
        <div role="listitem">
          <MetricCard
            icon={FileText}
            label="Reports awaiting review"
            value={awaitingReview}
            hint={
              awaitingReview > 0
                ? "Pending human verification of AI cues"
                : "All submissions confirmed"
            }
            emphasis={awaitingReview > 0}
          />
        </div>
      </MetricGrid>

      {/* 2. Interactive Telemetry Volume Section with Timeframe Filter */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <BarChart3 className="size-5 text-primary" />
              Observation Telemetry Cadence
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Total volume: <strong className="text-foreground">{totalObs}</strong> observations · Daily average: <strong className="text-foreground">{dailyAvg}</strong>/day in {tz}.
            </p>
          </div>

          {/* Timeframe Selector Tabs */}
          <div className="inline-flex rounded-xl bg-muted/70 p-1 border border-border/60">
            {[7, 14, 30, 90].map((numDays) => (
              <button
                key={numDays}
                type="button"
                onClick={() => setDays(numDays)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                  days === numDays
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {numDays}D
              </button>
            ))}
          </div>
        </div>

        <DailyVolumeCard
          title={`Daily observation volume (${days} Days)`}
          timestamps={d.observedAt}
          days={days}
          timeZone={tz}
          unit="observations"
          truncated={d.obsTruncated}
        />
      </div>

      {/* 3. Three Workload & Coordination Breakdowns */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Card 1: Review Cases */}
        <Breakdown
          icon={ClipboardList}
          title="Review cases by status"
          definition="Every clinical review case in your organisation, active or closed."
          ctaLink="/alerts"
          ctaText="Manage alerts & review cases"
          rows={tally(
            d.caseStatus,
            Object.keys(CASE_STATUS_LABEL) as (keyof typeof CASE_STATUS_LABEL)[],
          ).map((r) => ({ label: CASE_STATUS_LABEL[r.key].label, count: r.count }))}
        />

        {/* Card 2: Follow-up Tasks */}
        <Breakdown
          icon={CalendarCheck}
          title="Follow-up tasks by status"
          definition={`All follow-up tasks. ${overdue} open task${overdue === 1 ? " is" : "s are"} past due.`}
          ctaLink="/follow-ups"
          ctaText="Manage follow-up tasks"
          rows={tally(
            d.tasks.map((t) => t.status),
            Object.keys(TASK_STATUS_LABEL) as (keyof typeof TASK_STATUS_LABEL)[],
          ).map((r) => ({ label: TASK_STATUS_LABEL[r.key].label, count: r.count }))}
        />

        {/* Card 3: Care Reports & Notes */}
        <Breakdown
          icon={FileText}
          title="Written reports & voice notes"
          definition="Submitted care reports by review stage. AI suggestions stay unverified until a coordinator confirms them."
          ctaLink="/reports#recent-submissions"
          ctaText="Review submitted notes below"
          rows={tally(
            d.reportStatus,
            Object.keys(REPORT_STATUS_LABEL) as (keyof typeof REPORT_STATUS_LABEL)[],
          ).map((r) => ({ label: REPORT_STATUS_LABEL[r.key].label, count: r.count }))}
        />
      </div>

      {/* 4. Interactive Recent Care Reports & Submissions Feed */}
      <section
        id="recent-submissions"
        className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-xs"
        aria-labelledby="reports-feed-h"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-4">
          <div>
            <h2 id="reports-feed-h" className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              Recent Care Reports & Voice Submissions
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Submitted by family caregivers, health workers, and coordinators awaiting attributable review.
            </p>
          </div>

          {/* Submissions Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setReportFilter("all")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                reportFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              All ({d.reportRows.length})
            </button>
            <button
              type="button"
              onClick={() => setReportFilter("pending")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                reportFilter === "pending"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Pending ({awaitingReview})
            </button>
            <button
              type="button"
              onClick={() => setReportFilter("audio")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                reportFilter === "audio"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Voice Notes
            </button>
            <button
              type="button"
              onClick={() => setReportFilter("family")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                reportFilter === "family"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Family
            </button>
          </div>
        </div>

        {filteredReports.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No care reports match the selected filter.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredReports.map((report) => (
              <div
                key={report.id}
                className="group flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-background/60 p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-xs"
              >
                <div className="flex flex-col gap-2">
                  {/* Senior Info & Status Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <Link
                        to="/seniors/$seniorId"
                        params={{ seniorId: report.senior_id }}
                        className="font-bold text-sm text-foreground hover:text-primary transition-colors hover:underline tracking-tight"
                      >
                        {report.seniors?.display_name ?? "Senior"}
                      </Link>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {report.seniors?.record_code ?? ""}
                      </span>
                    </div>

                    {report.status === "pending_review" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/25 px-2 py-0.5 text-[11px] font-semibold">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Pending Review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-medium">
                        <CheckCircle2 className="size-3 text-emerald-600" />
                        Confirmed
                      </span>
                    )}
                  </div>

                  {/* Submission Modality & Submitter Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {report.source_type === "transcribed_audio" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[11px] font-medium">
                        <Mic className="size-3" />
                        Voice Note
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <FileText className="size-3" />
                        Written Note
                      </span>
                    )}

                    <span className="capitalize text-muted-foreground text-[11px]">
                      via {report.reporter_relation.replace("_", " ")}
                    </span>
                    <span className="text-muted-foreground/40">•</span>
                    <span className="text-muted-foreground text-[11px]">
                      {whenRelative(report.submitted_at)}
                    </span>
                  </div>

                  {/* Content Preview */}
                  <p className="line-clamp-3 text-xs sm:text-sm text-foreground/90 leading-relaxed bg-muted/20 p-2.5 rounded-lg border border-border/40">
                    &ldquo;{report.original_text}&rdquo;
                  </p>
                </div>

                {/* Direct Action Link */}
                <div className="border-t border-border/40 pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {report.status === "pending_review" ? "AI extraction pending human review" : "Validated & recorded"}
                  </span>
                  <Link
                    to="/seniors/$seniorId"
                    params={{ seniorId: report.senior_id }}
                    search={{ tab: "reports" }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>Review in dossier</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Clinical Safety & Methodology Reference */}
      <Section title="How these numbers are calculated">
        <ul className="list-disc space-y-1.5 pl-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          <li>
            All figures are live, attributable counts derived strictly from your organisation's
            RLS-scoped records; nothing is estimated or interpolated.
          </li>
          <li>
            Observation volume uses the exact timestamp each observation was recorded, grouped by
            day in your active local timezone ({tz}).
          </li>
          <li>
            <strong className="text-foreground font-semibold">
              &ldquo;No observation in {COVERAGE_DAYS} days&rdquo;
            </strong>{" "}
            indicates missing telemetry data. In care safety, absent data is never presented as
            reassurance that a senior is safe or well.
          </li>
          <li>
            Cohort reports reflect operational activity and workload. They are not clinical
            diagnoses, medical advice, or algorithmic risk scores.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Breakdown({
  icon: Icon,
  title,
  definition,
  ctaLink,
  ctaText,
  rows,
}: {
  icon: typeof Activity;
  title: string;
  definition: string;
  ctaLink?: string;
  ctaText?: string;
  rows: { label: string; count: number }[];
}) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <section className="surface flex min-w-0 flex-col justify-between gap-3 p-4 sm:p-5 rounded-2xl shadow-xs border border-border/80">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2.5">
          <Icon className="size-4 text-primary shrink-0" aria-hidden="true" />
          <h2 className="font-semibold text-sm sm:text-base text-foreground tracking-tight">{title}</h2>
          <span className="text-data ml-auto text-xs sm:text-sm font-bold text-foreground tabular-nums bg-muted/80 px-2 py-0.5 rounded-md border border-border/50">
            {total} total
          </span>
        </div>

        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No records recorded yet.</p>
        ) : (
          <StatusBars rows={rows} />
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">{definition}</p>
      </div>

      {ctaLink && ctaText && (
        <div className="border-t border-border/40 pt-2.5 mt-1">
          <Link
            to={ctaLink}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <span>{ctaText}</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
