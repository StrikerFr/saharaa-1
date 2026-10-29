import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  Activity,
  ArrowLeft,
  BellRing,
  CalendarCheck,
  ClipboardList,
  Clock,
  FileText,
  Languages,
  LineChart as LineChartIcon,
  Pencil,
} from "lucide-react";

import { CaseDetail } from "@/components/review/case-detail";
import { OpenCaseButton } from "@/components/review/review-actions";
import { ReportsSection } from "@/components/reports/reports-section";
import { SeniorFamilyManager } from "@/components/seniors/senior-family-manager";
import { AssessmentPanel } from "@/components/seniors/assessment-panel";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { RecordBaseline } from "@/components/seniors/record-baseline";
import { RecordObservation } from "@/components/seniors/record-observation";
import { WellbeingSummary } from "@/components/seniors/wellbeing-summary";
import { DailyRoutine } from "@/components/seniors/daily-routine";
import { ObservationTrends } from "@/components/seniors/observation-trends";
import { MetricCard } from "@/components/shell/metric";
import { Page, Section } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OBSERVATION_ICON } from "@/lib/observation-icons";
import { listReports } from "@/lib/reports.functions";
import { CASE_STATUS_LABEL } from "@/lib/review-labels";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { uuidSchema } from "@/lib/auth";
import {
  ageFrom,
  BASELINE_FIELDS,
  CARE_STATUS,
  formatBaselineValue,
  formatInZone,
  formatObservationValue,
  HISTORY_PAGE_SIZE,
  isDelayedEntry,
  LANGUAGES,
  OBSERVATION_TYPES,
  SOURCES,
  type BaselineField,
  type ObservationType,
  type ObservationRow,
} from "@/lib/seniors";

const TABS = ["overview", "today", "observations", "alerts", "reports", "family"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/seniors/$seniorId/")({
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Senior profile — Sahaara" },
      { name: "description", content: "Profile, baseline and observation history." },
      { property: "og:title", content: "Senior profile — Sahaara" },
      { property: "og:description", content: "Profile, baseline and observation history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SeniorDetail,
});

function NotFound() {
  return (
    <Page title="Profile not found">
      <EmptyState icon={ClipboardList} title="This profile isn't available">
        It may not exist, or you may not have access to it.
      </EmptyState>
      <Button asChild variant="outline" className="self-start">
        <Link to="/seniors">
          <ArrowLeft aria-hidden="true" /> Back to seniors
        </Link>
      </Button>
    </Page>
  );
}

function SeniorDetail() {
  const { user } = Route.useRouteContext();
  const { seniorId } = Route.useParams();
  if (!uuidSchema.safeParse(seniorId).success) return <NotFound />;
  return (
    <CareAccessGateWrapper userId={user.id}>
      <Detail seniorId={seniorId} />
    </CareAccessGateWrapper>
  );
}

function CareAccessGateWrapper({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  return <CareAccessGate userId={userId}>{() => children}</CareAccessGate>;
}

function useNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ["names", unique],
    enabled: unique.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("profile_names", { _ids: unique });
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.id, r.display_name || "Team member"]));
    },
  });
}

function Detail({ seniorId }: { seniorId: string }) {
  const senior = useQuery({
    queryKey: ["senior", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seniors")
        .select("*")
        .eq("id", seniorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (senior.isPending)
    return (
      <div
        className="page-container flex flex-col gap-4 py-8"
        role="status"
        aria-label="Loading profile"
      >
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  if (senior.isError)
    return (
      <Page title="Senior profile">
        <Notice tone="critical" title="Couldn't load this profile." />
        <Button variant="outline" className="self-start" onClick={() => senior.refetch()}>
          Try again
        </Button>
      </Page>
    );
  if (!senior.data) return <NotFound />;
  return <Profile s={senior.data} seniorId={seniorId} />;
}

type SeniorRecord = Tables<"seniors">;

function Profile({ s, seniorId }: { s: SeniorRecord; seniorId: string }) {
  const { tab = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const age = ageFrom(s.date_of_birth);
  const tz = s.time_zone;
  const setTab = (t: string) =>
    navigate({
      search: { tab: t === "overview" ? undefined : (t as Tab) },
      replace: true,
      resetScroll: false,
    });

  return (
    <Page
      breadcrumbs={[{ label: "Seniors", link: { to: "/seniors" } }, { label: s.display_name }]}
      eyebrow={s.record_code}
      title={s.display_name}
      description={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={s.care_status === "active" ? "success" : "neutral"}>
            {CARE_STATUS[s.care_status]}
          </StatusBadge>
          {s.is_synthetic && <StatusBadge tone="warning">Synthetic test record</StatusBadge>}
          <span>{age != null ? `${age} years` : "Age not recorded"}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Languages className="size-4" aria-hidden="true" /> {LANGUAGES[s.preferred_language]}
          </span>
          <span aria-hidden="true">·</span>
          <span>{tz}</span>
        </span>
      }
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/seniors/$seniorId/edit" params={{ seniorId }}>
              <Pencil aria-hidden="true" /> Edit profile
            </Link>
          </Button>
          <RecordObservation seniorId={seniorId} />
        </>
      }
    >
      <SummaryStrip seniorId={seniorId} timeZone={tz} onTab={setTab} />

      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl p-1 sm:w-auto">
          <TabsTrigger value="overview" className="min-h-10 px-4">
            Overview
          </TabsTrigger>
          <TabsTrigger value="today" className="min-h-10 px-4">
            Today & routine
          </TabsTrigger>
          <TabsTrigger value="observations" className="min-h-10 px-4">
            Observations
          </TabsTrigger>
          <TabsTrigger value="alerts" className="min-h-10 px-4">
            Review & follow-ups
          </TabsTrigger>
          <TabsTrigger value="reports" className="min-h-10 px-4">
            Reports & AI review
          </TabsTrigger>
          <TabsTrigger value="family" className="min-h-10 px-4">
            Family & Caregivers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-8">
          <WellbeingSummary seniorId={seniorId} timeZone={tz} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="surface p-5" aria-labelledby="profile-h">
              <h2 id="profile-h" className="font-semibold">
                Profile
              </h2>
              <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Age</dt>
                <dd>{age != null ? `${age} years` : <Missing />}</dd>
                <dt className="text-muted-foreground">Date of birth</dt>
                <dd className="text-data font-normal">{s.date_of_birth ?? <Missing />}</dd>
                <dt className="text-muted-foreground">Language</dt>
                <dd>{LANGUAGES[s.preferred_language]}</dd>
                <dt className="text-muted-foreground">Time zone</dt>
                <dd>{tz}</dd>
              </dl>
            </section>
            <section className="surface flex flex-col gap-3 p-5" aria-labelledby="context-h">
              <h2 id="context-h" className="font-semibold">
                Care context
              </h2>
              <div className="text-sm">
                <h3 className="font-semibold text-muted-foreground">Communication</h3>
                <p className="mt-0.5 whitespace-pre-line">{s.communication_notes ?? <Missing />}</p>
              </div>
              <div className="text-sm">
                <h3 className="font-semibold text-muted-foreground">Context</h3>
                <p className="mt-0.5 whitespace-pre-line">{s.care_context ?? <Missing />}</p>
              </div>
            </section>
          </div>
          <Latest seniorId={seniorId} timeZone={tz} onMore={() => setTab("observations")} />
          <Baselines seniorId={seniorId} timeZone={tz} />
          <p className="text-xs text-muted-foreground">
            Profile created {formatInZone(s.created_at, tz)} · last updated{" "}
            {formatInZone(s.updated_at, tz)} (version {s.version}). Times shown in {tz}.
          </p>
        </TabsContent>

        <TabsContent value="today" className="flex flex-col gap-8">
          <DailyRoutine seniorId={seniorId} timeZone={tz} />
        </TabsContent>

        <TabsContent value="observations" className="flex flex-col gap-8">
          <ObservationTrends seniorId={seniorId} timeZone={tz} />
          <History seniorId={seniorId} timeZone={tz} />
        </TabsContent>

        <TabsContent value="alerts" className="flex flex-col gap-8">
          <ReviewSection seniorId={seniorId} timeZone={tz} />
          <AssessmentPanel seniorId={seniorId} timeZone={tz} />
        </TabsContent>

        <TabsContent value="reports" className="flex flex-col gap-8">
          <ReportsSection seniorId={seniorId} timeZone={tz} />
        </TabsContent>

        <TabsContent value="family" className="flex flex-col gap-8">
          <SeniorFamilyManager seniorId={seniorId} seniorName={s.display_name} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/** At-a-glance metrics; each opens the tab holding the detail. Shares query keys with the tabs. */
function SummaryStrip({
  seniorId,
  timeZone,
  onTab,
}: {
  seniorId: string;
  timeZone: string;
  onTab: (t: Tab) => void;
}) {
  const latest = useLatest(seniorId);
  const cases = useLatestCase(seniorId);
  const tasks = useQuery({
    queryKey: ["senior-open-tasks", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follow_up_tasks")
        .select("due_at")
        .eq("senior_id", seniorId)
        .in("status", ["open", "in_progress"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as { due_at: string | null }[];
    },
  });
  const listFn = useServerFn(listReports);
  const reports = useQuery({
    queryKey: ["reports", seniorId],
    queryFn: () => listFn({ data: { seniorId } }),
  });

  const newest = latest.data?.reduce<ObservationRow | null>(
    (m, o) => (!m || o.observed_at > m.observed_at ? o : m),
    null,
  );
  const c = cases.data?.[0];
  const caseActive = c && ["needs_review", "in_review", "follow_up_required"].includes(c.status);
  const now = Date.now();
  const overdue = (tasks.data ?? []).filter(
    (t) => t.due_at && new Date(t.due_at).getTime() < now,
  ).length;
  const nextDue = (tasks.data ?? []).find((t) => t.due_at)?.due_at;
  const pending = (reports.data ?? []).filter((r) => r.status === "pending_review").length;
  const dash = <span className="text-muted-foreground">…</span>;

  const btn = (t: Tab, card: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => onTab(t)}
      aria-label={label}
      className="min-w-0 rounded-xl text-left transition-standard hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {card}
    </button>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {btn(
        "observations",
        <MetricCard
          icon={Clock}
          label="Latest observation"
          value={
            latest.isPending ? (
              dash
            ) : newest ? (
              <span className="text-lg">{OBSERVATION_TYPES[newest.type].label}</span>
            ) : (
              <span className="text-lg text-muted-foreground">None yet</span>
            )
          }
          hint={
            newest
              ? formatInZone(newest.observed_at, timeZone)
              : "No data is not the same as normal"
          }
        />,
        "Latest observation — open observations",
      )}
      {btn(
        "alerts",
        <MetricCard
          icon={BellRing}
          label="Review case"
          value={
            cases.isPending ? (
              dash
            ) : c ? (
              <span className="text-lg">
                {CASE_STATUS_LABEL[c.status as keyof typeof CASE_STATUS_LABEL]?.label ?? c.status}
              </span>
            ) : (
              <span className="text-lg text-muted-foreground">None open</span>
            )
          }
          hint={c ? `Opened ${formatInZone(c.opened_at, timeZone)}` : "No case has been opened"}
          emphasis={!!caseActive}
        />,
        "Review case — open review and follow-ups",
      )}
      {btn(
        "alerts",
        <MetricCard
          icon={CalendarCheck}
          label="Open follow-ups"
          value={tasks.isPending ? dash : (tasks.data?.length ?? 0)}
          hint={
            overdue > 0
              ? `${overdue} overdue`
              : nextDue
                ? `Next due ${formatInZone(nextDue, timeZone)}`
                : "Nothing due"
          }
          emphasis={overdue > 0}
        />,
        "Open follow-ups — open review and follow-ups",
      )}
      {btn(
        "reports",
        <MetricCard
          icon={FileText}
          label="Reports to review"
          value={reports.isPending ? dash : reports.isError ? "—" : pending}
          hint={`${reports.data?.length ?? 0} reports in total`}
          emphasis={pending > 0}
        />,
        "Reports to review — open reports",
      )}
    </div>
  );
}

function useLatest(seniorId: string) {
  return useQuery({
    queryKey: ["latest", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("latest_observations", { _senior: seniorId });
      if (error) throw error;
      return data as unknown as ObservationRow[];
    },
  });
}

function useLatestCase(seniorId: string) {
  return useQuery({
    queryKey: ["senior-review-cases", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_cases")
        .select("id, status, opened_at")
        .eq("senior_id", seniorId)
        .order("opened_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data ?? []) as { id: string; status: string; opened_at: string }[];
    },
  });
}

function Missing() {
  return <span className="text-subtle-foreground">Not recorded</span>;
}

/**
 * The senior's review case (if any) and the entry point to open one from the
 * latest assessment. The case list is org-scoped by RLS; the latest case per
 * senior is shown, open or closed, so history is never hidden.
 */
function ReviewSection({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const cases = useLatestCase(seniorId);
  const latestAssessment = useQuery({
    queryKey: ["risk_assessments", seniorId, "latest"],
    enabled: (cases.data ?? []).length === 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_assessments")
        .select("id")
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  if (cases.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Loading review case…
      </p>
    );
  if (cases.isError) return <Notice tone="critical" title="Couldn't load the review case." />;

  const current = cases.data?.[0];
  if (current) return <CaseDetail caseId={current.id} timeZone={timeZone} />;

  return (
    <Section
      title="Review case"
      description="No review case is open for this person. Open one from the latest assessment when a coordinator decides human review is needed."
    >
      {latestAssessment.data ? (
        <OpenCaseButton
          seniorId={seniorId}
          assessmentId={latestAssessment.data.id}
          onOpened={() => cases.refetch()}
        />
      ) : (
        <EmptyState icon={ClipboardList} title="No assessment to review yet">
          Run an assessment first; a coordinator can then open a review case from it.
        </EmptyState>
      )}
    </Section>
  );
}

function Baselines({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const q = useQuery({
    queryKey: ["baselines", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_baselines", { _senior: seniorId });
      if (error) throw error;
      return data;
    },
  });
  const byField = new Map((q.data ?? []).map((b) => [b.field, b]));
  return (
    <Section
      title="Baseline"
      description="Recorded reference points for this person. Not a statement of what is medically normal."
      action={<RecordBaseline seniorId={seniorId} />}
    >
      {q.isPending ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : q.isError ? (
        <Notice tone="critical" title="Couldn't load the baseline." />
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {(Object.keys(BASELINE_FIELDS) as BaselineField[]).map((f) => {
            const b = byField.get(f);
            return (
              <li key={f} className="flex min-w-0 flex-col gap-0.5 bg-card p-4">
                <span className="text-xs font-semibold text-muted-foreground">
                  {BASELINE_FIELDS[f].label}
                </span>
                {b ? (
                  <>
                    <span className="text-data text-base">{formatBaselineValue(b)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatInZone(b.captured_at, timeZone)} · {SOURCES[b.source]}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-subtle-foreground">Not recorded</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Latest({
  seniorId,
  timeZone,
  onMore,
}: {
  seniorId: string;
  timeZone: string;
  onMore: () => void;
}) {
  const q = useLatest(seniorId);
  return (
    <Section
      title="Latest observations"
      description="The most recent entry of each type. Types with no entries are not shown as normal."
      action={
        <Button variant="ghost" size="sm" onClick={onMore}>
          <LineChartIcon aria-hidden="true" /> Trends & history
        </Button>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : q.isError ? (
        <Notice tone="critical" title="Couldn't load observations." />
      ) : q.data.length === 0 ? (
        <EmptyState icon={Activity} title="No observations yet">
          Record the first observation to start this person's history.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {q.data
            .filter((o) => o.type !== "care_note")
            .map((o) => {
              const Icon = OBSERVATION_ICON[o.type];
              return (
                <li key={o.id} className="surface flex min-w-0 items-start gap-3 p-4">
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {OBSERVATION_TYPES[o.type].label}
                    </p>
                    <p className="text-data text-lg leading-snug">{formatObservationValue(o)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatInZone(o.observed_at, timeZone)}
                      {o.verification === "unverified" && " · Unverified"}
                    </p>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </Section>
  );
}

function History({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const [type, setType] = useState<ObservationType | "all">("all");
  const q = useInfiniteQuery({
    queryKey: ["observations", seniorId, type],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * HISTORY_PAGE_SIZE;
      let query = supabase
        .from("observations")
        .select(
          "id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, recorded_at, recorded_by, source, verification",
        )
        .eq("senior_id", seniorId);
      if (type !== "all") query = query.eq("type", type);
      const { data, error } = await query
        .order("observed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      return data as unknown as ObservationRow[];
    },
    getNextPageParam: (last, all) => (last.length === HISTORY_PAGE_SIZE ? all.length : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  const names = useNames(rows.map((r) => r.recorded_by));

  // Group consecutive rows by observed calendar day (rows are already newest first).
  const dayFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone });
  const timeFmt = new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone });
  const groups: { day: string; items: ObservationRow[] }[] = [];
  for (const r of rows) {
    const day = dayFmt.format(new Date(r.observed_at));
    const g = groups.at(-1);
    if (g && g.day === day) g.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <Section
      title="Observation history"
      description={`Newest first, by when it was observed. Times in ${timeZone}.`}
      action={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ObservationType | "all")}
            className="h-10 rounded-lg border border-input bg-card px-3 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="all">All types</option>
            {(Object.keys(OBSERVATION_TYPES) as ObservationType[]).map((t) => (
              <option key={t} value={t}>
                {OBSERVATION_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : q.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="critical" title="Couldn't load the history." />
          <Button variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">
          No observations recorded{type !== "all" ? " of this type" : ""}.
        </p>
      ) : (
        <>
          <div className="surface divide-y divide-border">
            {groups.map((g) => (
              <section key={g.day} aria-label={g.day}>
                <h3 className="bg-background-subtle px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.day}
                </h3>
                <ol className="divide-y divide-border">
                  {g.items.map((o) => {
                    const delayed = isDelayedEntry(o.observed_at, o.recorded_at);
                    const Icon = OBSERVATION_ICON[o.type];
                    return (
                      <li
                        key={o.id}
                        className="grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm"
                      >
                        <time
                          dateTime={o.observed_at}
                          className="text-data font-normal text-muted-foreground"
                        >
                          {timeFmt.format(new Date(o.observed_at))}
                        </time>
                        <Icon className="mt-0.5 size-4 text-primary" aria-hidden="true" />
                        <div className="min-w-0">
                          <p>
                            <span className="font-semibold">
                              {OBSERVATION_TYPES[o.type].label}:
                            </span>{" "}
                            <span
                              className={
                                o.type === "care_note"
                                  ? "whitespace-pre-line"
                                  : "text-data font-normal"
                              }
                            >
                              {formatObservationValue(o)}
                            </span>
                          </p>
                          {o.note && o.type !== "care_note" && (
                            <p className="mt-0.5 whitespace-pre-line text-muted-foreground">
                              {o.note}
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-subtle-foreground">
                            {SOURCES[o.source]} ·{" "}
                            {o.verification === "unverified" ? "Unverified" : "Verified"} · entered
                            by {(o.recorded_by && names.data?.[o.recorded_by]) || "a team member"}
                            {delayed && (
                              <>
                                {" "}
                                ·{" "}
                                <span className="font-semibold text-warning">
                                  entered later, {formatInZone(o.recorded_at, timeZone)}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
          {q.hasNextPage && (
            <Button
              variant="outline"
              className="self-start"
              loading={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              Load older observations
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
