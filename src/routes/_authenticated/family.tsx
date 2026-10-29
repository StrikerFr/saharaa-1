import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Check,
  Clock,
  Heart,
  HelpCircle,
  MessageSquare,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Volume2,
} from "lucide-react";
import { z } from "zod";

import { FamilyReportModal } from "@/components/family/family-report-modal";
import { FamilyRoutineSummary } from "@/components/family/family-routine-summary";
import { FamilyWellbeingCard } from "@/components/family/family-wellbeing-card";
import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { MetricCard } from "@/components/shell/metric";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getFamilyDashboard,
  listFamilySeniors,
  respondFamilyTask,
} from "@/lib/family.functions";
import { speakConfirmedSummary } from "@/lib/reports.functions";
import { OBSERVATION_ICON } from "@/lib/observation-icons";

export const Route = createFileRoute("/_authenticated/family")({
  validateSearch: z.object({
    seniorId: z.string().uuid().optional().catch(undefined),
  }),
  head: () => ({
    meta: [
      { title: "Family Portal — Sahaara" },
      { name: "description", content: "Stay updated on your senior's daily wellbeing, observations, and care notes." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FamilyPortalPage,
});

function FamilyPortalPage() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  const fetchSeniors = useServerFn(listFamilySeniors);
  const seniorsQuery = useQuery({
    queryKey: ["family-seniors", user.id],
    queryFn: () => fetchSeniors(),
  });

  const seniors = seniorsQuery.data ?? [];
  const activeSeniorId = search.seniorId || (seniors.length > 0 ? seniors[0]!.id : null);

  const fetchDashboard = useServerFn(getFamilyDashboard);
  const dashboardQuery = useQuery({
    queryKey: ["family-dashboard", activeSeniorId],
    enabled: !!activeSeniorId,
    queryFn: () => fetchDashboard({ data: { seniorId: activeSeniorId! } }),
  });

  if (seniorsQuery.isPending) {
    return (
      <Page title="Family Portal" description="Loading your authorized care records...">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      </Page>
    );
  }

  if (seniors.length === 0) {
    return (
      <Page
        title="Family Portal"
        description="Connect with your loved one's care team on Sahaara."
      >
        <EmptyState
          icon={Users}
          title="No Seniors Linked Yet"
        >
          You don&apos;t have an active family link to any seniors. Ask your senior&apos;s care coordinator to send you an invitation link to connect your account.
        </EmptyState>
        <div className="flex justify-center pt-4">
          <Button asChild variant="outline">
            <Link to="/account">View Your Account Settings</Link>
          </Button>
        </div>
      </Page>
    );
  }

  const data = dashboardQuery.data;
  const senior = data?.senior;

  return (
    <Page
      eyebrow="Family & Caregiver Portal"
      title={senior?.displayName ? `${senior.displayName}'s Care Updates` : "Care Updates"}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <span>Connected as <strong>{senior?.relationshipLabel ?? "Family Member"}</strong></span>
          <span>·</span>
          <span>Time zone: {senior?.timeZone ?? "Asia/Kolkata"}</span>
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {seniors.length > 1 && (
            <select
              value={activeSeniorId ?? ""}
              onChange={(e) => navigate({ search: { seniorId: e.target.value } })}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
            >
              {seniors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.relationshipLabel})
                </option>
              ))}
            </select>
          )}

          {senior && (
            <FamilyReportModal
              seniorId={senior.id}
              seniorName={senior.displayName}
              onSuccess={() => qc.invalidateQueries({ queryKey: ["family-dashboard", senior.id] })}
            />
          )}
        </div>
      }
    >
      {dashboardQuery.isPending ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : dashboardQuery.isError || !data ? (
        <Notice tone="critical" title="Could not load care updates for this senior." />
      ) : (
        <FamilyDashboardContent data={data} seniorId={activeSeniorId!} />
      )}
    </Page>
  );
}

function FamilyDashboardContent({ data, seniorId }: { data: any; seniorId: string }) {
  const { senior, recentObservations, familyReports, followUps } = data;
  const [taskResponses, setTaskResponses] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const respondFn = useServerFn(respondFamilyTask);

  const respondMutation = useMutation({
    mutationFn: async ({ taskId, text }: { taskId: string; text: string }) => {
      return respondFn({ data: { taskId, response: text } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family-dashboard", seniorId] });
    },
  });

  const latestObs = recentObservations[0];
  const pendingReportsCount = familyReports.filter((r: any) => r.status === "pending_review" || r.status === "pending_extraction").length;
  const pendingTasksCount = followUps.filter((t: any) => !t.familyResponse && t.status !== "completed").length;

  return (
    <div className="flex flex-col gap-8">
      {/* Summary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Latest Observation"
          value={latestObs ? latestObs.formattedValue : "No entries"}
          hint={latestObs ? `${latestObs.label} (${latestObs.observedAtFormatted})` : "Awaiting updates"}
          icon={Activity}
        />
        <MetricCard
          label="Submitted Updates"
          value={familyReports.length}
          hint={pendingReportsCount > 0 ? `${pendingReportsCount} awaiting team review` : "All reviewed"}
          icon={MessageSquare}
        />
        <MetricCard
          label="Care Team Requests"
          value={pendingTasksCount}
          hint={pendingTasksCount > 0 ? "Requires your response" : "Up to date"}
          icon={CalendarCheck}
        />
      </div>

      {/* Main Tabbed Interface */}
      <Tabs defaultValue="routine" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="routine">Today & Routine</TabsTrigger>
          <TabsTrigger value="summary">Wellbeing & Updates</TabsTrigger>
          <TabsTrigger value="observations">Observations</TabsTrigger>
          <TabsTrigger value="reports">Voice Notes & Reports ({familyReports.length})</TabsTrigger>
        </TabsList>

        {/* Tab 1: Today & Routine (Weekly Summary + Today's Schedule + Routine Score) */}
        <TabsContent value="routine" className="flex flex-col gap-6 pt-4">
          <FamilyRoutineSummary
            seniorId={seniorId}
            seniorName={senior.displayName}
            timeZone={senior.timeZone}
          />
        </TabsContent>

        {/* Tab 2: Care Updates & 14-Day AI Wellbeing Summary */}
        <TabsContent value="summary" className="flex flex-col gap-6 pt-4">
          {/* AI Wellbeing Summary & Read-Aloud */}
          <FamilyWellbeingCard
            seniorId={seniorId}
            seniorName={senior.displayName}
            timeZone={senior.timeZone}
          />

          {/* Actionable Follow-ups from Care Team */}
          {followUps.length > 0 && (
            <Section
              title="Requests from the Care Team"
              description="Information or follow-up requested by your care coordinator."
            >
              <div className="flex flex-col gap-3">
                {followUps.map((t: any) => (
                  <div key={t.id} className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-foreground">{t.title}</h4>
                        {t.notes && <p className="mt-1 text-sm text-muted-foreground">{t.notes}</p>}
                        {t.dueAt && (
                          <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" /> Due by {new Date(t.dueAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <StatusBadge tone={t.familyResponse ? "success" : "warning"}>
                        {t.familyResponse ? "Responded" : "Response Needed"}
                      </StatusBadge>
                    </div>

                    {t.familyResponse ? (
                      <div className="rounded-lg bg-background p-3 text-xs">
                        <span className="font-semibold text-foreground">Your response: </span>
                        <span className="text-muted-foreground">{t.familyResponse}</span>
                        {t.familyRespondedAt && (
                          <span className="ml-2 text-muted-foreground">({new Date(t.familyRespondedAt).toLocaleDateString()})</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 pt-2">
                        <Textarea
                          placeholder="Type your response to the care team..."
                          value={taskResponses[t.id] ?? ""}
                          onChange={(e) => setTaskResponses({ ...taskResponses, [t.id]: e.target.value })}
                          rows={2}
                          className="bg-background"
                        />
                        <Button
                          size="sm"
                          disabled={!taskResponses[t.id]?.trim()}
                          loading={respondMutation.isPending}
                          onClick={() => {
                            respondMutation.mutate({ taskId: t.id, text: taskResponses[t.id]! });
                            setTaskResponses({ ...taskResponses, [t.id]: "" });
                          }}
                          className="self-end gap-1.5"
                        >
                          <Send className="size-3.5" /> Submit Response
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </TabsContent>

        {/* Tab 3: Detailed Observations & Checked Vitals */}
        <TabsContent value="observations" className="flex flex-col gap-6 pt-4">
          <Section
            title="Recent Checked Vitals & Observations"
            description="Verified observations recorded by caregivers and coordinators."
          >
            {recentObservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No observations recorded recently.</p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {recentObservations.map((o: any) => {
                  const Icon = (OBSERVATION_ICON as Record<string, any>)[o.type] ?? Activity;
                  return (
                    <div key={o.id} className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <p className="font-medium text-foreground">{o.label}</p>
                          <p className="text-xs text-muted-foreground">{o.observedAtFormatted} · {o.source.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-foreground">{o.formattedValue}</span>
                        {o.note && <p className="max-w-xs truncate text-xs text-muted-foreground">{o.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Observation History Table" description="All measurements and daily vital signs approved for family view.">
            {recentObservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries available.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Observation</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">Observed At</th>
                      <th className="px-4 py-3">Reported By</th>
                      <th className="px-4 py-3">Care Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentObservations.map((o: any) => (
                      <tr key={o.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">{o.label}</td>
                        <td className="px-4 py-3 font-semibold">{o.formattedValue}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{o.observedAtFormatted}</td>
                        <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{o.source.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{o.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        {/* Tab 3: Reports & Voice Notes */}
        <TabsContent value="reports" className="flex flex-col gap-4 pt-4">
          <Section
            title="Your Reports & Voice Notes"
            description="Updates submitted by you or other authorized family members, and their coordinator review status."
          >
            {familyReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                <MessageSquare className="size-8 opacity-40" />
                <p>No reports or voice notes submitted yet.</p>
                <p className="text-xs">Click &quot;Share an Update&quot; above to leave a note or record a voice update.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {familyReports.map((r: any) => (
                  <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {r.sourceType === "transcribed_audio" ? (
                          <span className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            <Mic className="size-3" /> Voice Note
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            <MessageSquare className="size-3" /> Written Note
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{r.submittedAtFormatted}</span>
                      </div>
                      <StatusBadge
                        tone={r.status === "reviewed" ? "success" : r.status === "failed" ? "critical" : "warning"}
                      >
                        {r.statusLabel}
                      </StatusBadge>
                    </div>
                    <p className="text-sm text-foreground">{r.text}</p>
                    {r.status === "pending_review" && (
                      <p className="text-xs text-muted-foreground">
                        Our care team has received your update and will verify any symptoms or observations shortly.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>

      {/* Safety Notice */}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        Sahaara is an early-warning and coordination aid for families and care teams. It does not provide medical diagnoses or replace emergency services. In an emergency, always call local emergency response.
      </p>
    </div>
  );
}
