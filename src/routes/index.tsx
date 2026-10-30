import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ShieldCheck, Users } from "lucide-react";

import { QueueTable } from "@/components/review/queue-table";
import { SummaryCards } from "@/components/review/summary-cards";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { useMyRoles, useSession } from "@/hooks/use-session";
import { DailyVolumeCard } from "@/components/charts/daily-volume";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { OBSERVATION_ICON } from "@/lib/observation-icons";
import {
  formatInZone,
  formatObservationValue,
  OBSERVATION_TYPES,
  type ObservationRow,
} from "@/lib/seniors";
import { getOperationsSummary } from "@/lib/review.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Sahaara" },
      {
        name: "description",
        content: "Sahaara care-coordination workspace for supporting seniors living at home.",
      },
      { property: "og:title", content: "Overview — Sahaara" },
      {
        property: "og:description",
        content: "Sahaara care-coordination workspace for supporting seniors living at home.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://saharaa-1.vercel.app/" },
    ],
    links: [{ rel: "canonical", href: "https://saharaa-1.vercel.app/" }],
  }),
  component: Overview,
});

function Overview() {
  const { session, ready } = useSession();
  const roles = useMyRoles(session?.user?.id);
  const r = roles.data ?? [];
  const isFamilyOnly = r.includes("family") && !r.includes("coordinator") && !r.includes("admin");
  const navigate = Route.useNavigate();

  useEffect(() => {
    if (ready && session?.user && isFamilyOnly) {
      navigate({ to: "/family", replace: true });
    }
  }, [ready, session, isFamilyOnly, navigate]);

  // Signed-in coordinators get the operations dashboard; everyone else sees
  // the honest setup page. The session is client-side only, so the dashboard
  // renders after hydration — authorization itself is enforced server-side.
  if (ready && session?.user) {
    if (isFamilyOnly) {
      return null;
    }
    return (
      <Page
        eyebrow={new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date())}
        title="Overview"
        description="Care coordination dashboard. Monitor senior vitals, open alerts, and active follow-up tasks."
        actions={
          <Button asChild>
            <Link to="/seniors">
              <Users aria-hidden="true" /> Open seniors
            </Link>
          </Button>
        }
      >
        <CareAccessGate userId={session.user.id}>{() => <Dashboard />}</CareAccessGate>
      </Page>
    );
  }

  return <SetupPage />;
}

function Dashboard() {
  const run = useServerFn(getOperationsSummary);
  const summary = useQuery({
    queryKey: ["ops-summary"],
    queryFn: () => run(),
  });

  return (
    <>
      <Section title="Workload" description="Caseload overview and team operational queues.">
        {summary.isPending ? (
          <div
            className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
            role="status"
            aria-label="Loading the workload summary"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : summary.isError ? (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="critical" title="Couldn't load the workload summary." />
            <Button variant="outline" onClick={() => summary.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <SummaryCards summary={summary.data} />
        )}
      </Section>

      <Section
        title="Active care alerts"
        description="Seniors with recent changes in vitals, medication, or routine requiring coordinator review."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/alerts">
              All alerts <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <QueueTable />
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ObservationVolume />
        <RecentActivity />
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Sahaara assists coordinators. It does not diagnose conditions, prescribe medication, or
        replace clinicians or emergency services.
      </p>
    </>
  );
}

const VOLUME_DAYS = 14;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Observations per day, last 14 days, for the user's organisation (RLS-scoped). */
function ObservationVolume() {
  const tz = browserZone();
  const q = useQuery({
    queryKey: ["ops-observation-volume", VOLUME_DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - VOLUME_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("observations")
        .select("observed_at")
        .gte("observed_at", since)
        .limit(5000);
      if (error) throw error;
      return (data ?? []).map((r) => r.observed_at);
    },
  });
  if (q.isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (q.isError) return <Notice tone="critical" title="Couldn't load observation volume." />;
  return (
    <DailyVolumeCard
      title="Observations per day"
      timestamps={q.data}
      days={VOLUME_DAYS}
      timeZone={tz}
      unit="observations"
    />
  );
}

/** Latest observations across the organisation, newest first. */
function RecentActivity() {
  const q = useQuery({
    queryKey: ["ops-recent-observations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("observations")
        .select(
          "id, senior_id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, verification, seniors(display_name)",
        )
        .order("recorded_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data as unknown as (ObservationRow & {
        senior_id: string;
        seniors: { display_name: string } | null;
      })[];
    },
  });
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-xs" aria-labelledby="recent-h">
      <div>
        <h3 id="recent-h" className="font-bold text-base text-foreground">
          Recent observations
        </h3>
        <p className="text-xs text-muted-foreground">Latest care readings recorded across your organisation.</p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : q.isError ? (
        <Notice tone="critical" title="Couldn't load recent activity." />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No observations recorded yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border/60">
          {q.data.map((o) => {
            const Icon = OBSERVATION_ICON[o.type];
            return (
              <li key={o.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <p className="truncate font-medium text-foreground">
                      <Link
                        to="/seniors/$seniorId"
                        params={{ seniorId: o.senior_id }}
                        className="hover:text-primary hover:underline"
                      >
                        {o.seniors?.display_name ?? "Senior"}
                      </Link>
                      <span className="text-muted-foreground font-normal"> · {OBSERVATION_TYPES[o.type].label}</span>
                    </p>
                    <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-semibold text-foreground font-mono">
                      {formatObservationValue(o)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatInZone(o.observed_at, browserZone())}
                    {o.verification === "unverified" && " · Unverified"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function SetupPage() {
  return (
    <Page
      eyebrow="Overview"
      title="Calm signals, timely care."
      description="Sahaara will help coordinators notice changes in seniors' well-being early, review the evidence, and follow up with the right people."
      actions={
        <Button asChild variant="outline">
          <Link to="/design-system">
            View design system <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <Notice tone="info" title="Signed out">
        You are not signed in. Nothing on this page reflects real people or live activity.
      </Notice>

      <Section title="Your caseload">
        <EmptyState icon={Users} title="Sign in to see your caseload">
          Sign in to see the seniors in your organisation and anything that needs attention.
        </EmptyState>
      </Section>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Sahaara assists coordinators. It does not diagnose conditions, prescribe medication, or
        replace clinicians or emergency services.
      </p>
    </Page>
  );
}
