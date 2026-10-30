import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Apple,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Footprints,
  HeartPulse,
  HelpCircle,
  Info,
  Moon,
  Pill,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  UserCheck,
  UserX,
  X,
} from "lucide-react";

import { CaseDetail } from "@/components/review/case-detail";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { AssessmentPanel } from "@/components/seniors/assessment-panel";
import { Page } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALERT_STATUS_LABEL, explainAlert, nextAlertStep, type AlertSort } from "@/lib/alerts";
import { ALERT_PAGE_SIZE, listAlerts, reopenAlert, type AlertRow } from "@/lib/alerts.functions";
import { CASE_STATUS_LABEL } from "@/lib/review-labels";
import { assignReviewCase } from "@/lib/review.functions";
import { isCaseClosed, type ReviewCaseStatus } from "@/lib/review-workflow";
import { sanitizeSearch } from "@/lib/seniors";
import { cn } from "@/lib/utils";
import { DOMAIN_LABEL, PRIORITY_LABEL } from "@/risk/labels";
import type { ReviewPriority } from "@/risk/engine";

const META = "Clinical care alerts raised from risk assessments, with telemetry signals, status history, and action steps.";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Care Alerts — Sahaara" },
      { name: "description", content: META },
      { property: "og:title", content: "Care Alerts — Sahaara" },
      { property: "og:description", content: META },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AlertsPage,
});

type Scope = "active" | "closed" | "all";
type Assignee = "me" | "unassigned" | null;

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

const domainLabel = (d: string) => (DOMAIN_LABEL as Record<string, string>)[d] ?? d;

interface DomainMeta {
  label: string;
  icon: typeof Activity;
  badgeClass: string;
  iconClass: string;
}

const DOMAIN_CONFIG: Record<string, DomainMeta> = {
  blood_pressure: {
    label: "Blood Pressure Variance",
    icon: Activity,
    badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
    iconClass: "text-rose-600 dark:text-rose-400",
  },
  heart_rate: {
    label: "Heart Rate Anomaly",
    icon: HeartPulse,
    badgeClass: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
    iconClass: "text-red-600 dark:text-red-400",
  },
  medication: {
    label: "Medication Adherence",
    icon: Pill,
    badgeClass: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  sleep: {
    label: "Sleep Disruption",
    icon: Moon,
    badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25",
    iconClass: "text-indigo-600 dark:text-indigo-400",
  },
  intake: {
    label: "Food & Fluid Intake",
    icon: Apple,
    badgeClass: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  mobility: {
    label: "Reduced Mobility",
    icon: Footprints,
    badgeClass: "bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/25",
    iconClass: "text-orange-600 dark:text-orange-400",
  },
  weight: {
    label: "Weight Fluctuation",
    icon: Scale,
    badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25",
    iconClass: "text-purple-600 dark:text-purple-400",
  },
  reporting: {
    label: "Telemetry Gap",
    icon: CalendarClock,
    badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/25",
    iconClass: "text-slate-600 dark:text-slate-400",
  },
};

function DomainSignalPill({ domain }: { domain: string }) {
  const conf = DOMAIN_CONFIG[domain] || {
    label: domainLabel(domain),
    icon: Activity,
    badgeClass: "bg-muted text-foreground border-border/80",
    iconClass: "text-muted-foreground",
  };
  const Icon = conf.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-2xs transition-all",
        conf.badgeClass,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", conf.iconClass)} aria-hidden="true" />
      <span>{conf.label}</span>
    </span>
  );
}

function AlertsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      eyebrow="Clinical Triage"
      title="Care Alerts"
      description="Active alerts surfaced by the deterministic risk engine and physiological telemetry for coordinator triage. An alert is an attributable prompt to look — never an unreviewed diagnosis."
    >
      <CareAccessGate userId={user.id}>{() => <Alerts userId={user.id} />}</CareAccessGate>
    </Page>
  );
}

function Pick<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1 min-w-36">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Select
        value={value ?? "__all"}
        onValueChange={(v) => onChange(v === "__all" ? null : (v as T))}
      >
        <SelectTrigger className="h-10 text-xs font-medium" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Alerts({ userId }: { userId: string }) {
  const run = useServerFn(listAlerts);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("active");
  const [status, setStatus] = useState<ReviewCaseStatus | null>(null);
  const [priority, setPriority] = useState<ReviewPriority | null>(null);
  const [assignee, setAssignee] = useState<Assignee>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<AlertSort>("priority");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(sanitizeSearch(input));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  // Main filtered query
  const query = useQuery({
    queryKey: ["alerts", search, scope, status, priority, assignee, from, to, sort, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      run({
        data: {
          page,
          search,
          scope,
          status,
          priority,
          assignee,
          from: from || null,
          to: to || null,
          sort,
        },
      }),
  });

  // Overview query to compute overall active KPI counts independently of local filters
  const overviewQuery = useQuery({
    queryKey: ["alerts-overview-stats"],
    queryFn: () =>
      run({
        data: {
          page: 0,
          search: "",
          scope: "active",
          status: null,
          priority: null,
          assignee: null,
          from: null,
          to: null,
          sort: "priority",
        },
      }),
    staleTime: 10_000,
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ALERT_PAGE_SIZE));

  const stats = useMemo(() => {
    const rows = overviewQuery.data?.rows ?? query.data?.rows ?? [];
    const activeTotal = overviewQuery.data?.total ?? (scope === "active" ? total : 0);
    const critical = rows.filter(
      (r) => r.priority === "prompt_review_recommended" || r.priority === "review_recommended",
    ).length;
    const unassigned = rows.filter((r) => !r.assignedTo).length;
    const inTriage = rows.filter(
      (r) => r.status === "in_review" || r.status === "follow_up_required",
    ).length;

    return {
      activeTotal: activeTotal || rows.length,
      critical,
      unassigned,
      inTriage,
    };
  }, [overviewQuery.data, query.data, scope, total]);

  const hasActiveFilters = Boolean(
    input || search || status || priority || assignee || from || to || scope !== "active",
  );

  const clearAllFilters = () => {
    setInput("");
    setSearch("");
    setScope("active");
    setStatus(null);
    setPriority(null);
    setAssignee(null);
    setFrom("");
    setTo("");
    setSort("priority");
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Triage KPI Overview Ribbon */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Metric 1: Total Active Alerts */}
        <button
          type="button"
          onClick={() => {
            setScope("active");
            setStatus(null);
            setPriority(null);
            setAssignee(null);
            setPage(0);
          }}
          className={cn(
            "group flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all duration-200 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            scope === "active" && !status && !priority && !assignee
              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30 shadow-2xs"
              : "border-border/70 bg-card hover:border-primary/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active Alerts
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BellRing className="size-4" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground tabular-nums">
              {stats.activeTotal}
            </span>
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">Under active monitoring</span>
        </button>

        {/* Metric 2: High Urgency (Prompt Review) */}
        <button
          type="button"
          onClick={() => {
            setScope("active");
            setPriority("prompt_review_recommended");
            setStatus(null);
            setAssignee(null);
            setPage(0);
          }}
          className={cn(
            "group flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all duration-200 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
            priority === "prompt_review_recommended"
              ? "border-red-500/60 bg-red-500/10 ring-1 ring-red-500/40 shadow-2xs"
              : "border-border/70 bg-card hover:border-red-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Prompt Review
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="size-4" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-red-600 dark:text-red-400 tabular-nums">
              {stats.critical}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">Multiple variance areas</span>
        </button>

        {/* Metric 3: Unassigned Alerts */}
        <button
          type="button"
          onClick={() => {
            setScope("active");
            setAssignee("unassigned");
            setStatus(null);
            setPriority(null);
            setPage(0);
          }}
          className={cn(
            "group flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all duration-200 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
            assignee === "unassigned"
              ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/40 shadow-2xs"
              : "border-border/70 bg-card hover:border-amber-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Unassigned
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <UserX className="size-4" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
              {stats.unassigned}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">Awaiting coordinator pickup</span>
        </button>

        {/* Metric 4: In Review / Triage */}
        <button
          type="button"
          onClick={() => {
            setScope("active");
            setStatus("in_review");
            setPriority(null);
            setAssignee(null);
            setPage(0);
          }}
          className={cn(
            "group flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all duration-200 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            status === "in_review"
              ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40 shadow-2xs"
              : "border-border/70 bg-card hover:border-primary/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              In Triage
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Stethoscope className="size-4" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground tabular-nums">
              {stats.inTriage}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">Investigation in progress</span>
        </button>
      </div>

      {/* 2. Search & Filter Command Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        {/* Scope Selector Tabs + Clear Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div className="inline-flex rounded-xl bg-muted/70 p-1 border border-border/50">
            <button
              type="button"
              onClick={() => reset(setScope)("active")}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                scope === "active"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Active Alerts {scope === "active" && `(${total})`}
            </button>
            <button
              type="button"
              onClick={() => reset(setScope)("closed")}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                scope === "closed"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Closed / Resolved {scope === "closed" && `(${total})`}
            </button>
            <button
              type="button"
              onClick={() => reset(setScope)("all")}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                scope === "all"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All Records {scope === "all" && `(${total})`}
            </button>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
              Reset all filters
            </Button>
          )}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Label htmlFor="alert-search" className="sr-only">
            Search alerts
          </Label>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="alert-search"
            type="search"
            placeholder="Search by senior name, record ID, or condition..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-10 pl-10 text-xs sm:text-sm bg-background"
            autoComplete="off"
          />
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <Pick
            label="Status"
            value={status}
            onChange={reset(setStatus)}
            options={(Object.keys(ALERT_STATUS_LABEL) as ReviewCaseStatus[]).map((s) => ({
              value: s,
              label: ALERT_STATUS_LABEL[s],
            }))}
          />
          <Pick
            label="Priority"
            value={priority}
            onChange={reset(setPriority)}
            options={(Object.keys(PRIORITY_LABEL) as ReviewPriority[]).map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p].label,
            }))}
          />
          <Pick
            label="Assigned"
            value={assignee}
            onChange={reset(setAssignee)}
            options={[
              { value: "me", label: "Assigned to me" },
              { value: "unassigned", label: "Unassigned" },
            ]}
          />
          <div className="flex flex-col gap-1 min-w-32">
            <Label htmlFor="alert-from" className="text-xs font-medium text-muted-foreground">
              Raised from
            </Label>
            <Input
              id="alert-from"
              type="date"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
              className="h-10 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-32">
            <Label htmlFor="alert-to" className="text-xs font-medium text-muted-foreground">
              Raised to
            </Label>
            <Input
              id="alert-to"
              type="date"
              value={to}
              onChange={(e) => reset(setTo)(e.target.value)}
              className="h-10 text-xs"
            />
          </div>
          <Pick
            label="Sort by"
            value={sort}
            onChange={(v) => reset(setSort)(v ?? "priority")}
            options={[
              { value: "priority", label: "Priority (Highest first)" },
              { value: "newest", label: "Newest raised" },
              { value: "updated", label: "Recently updated" },
            ]}
          />
        </div>
      </div>

      {/* 3. Alert Cards Feed */}
      {query.isPending ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Loading clinical care alerts…</p>
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <Notice tone="critical" title="Couldn't load alerts.">
            {query.error instanceof Error ? query.error.message : "Please try again."}
          </Notice>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={
            search || status || priority || assignee || from || to
              ? "No alerts match these filters"
              : scope === "active"
                ? "No active care alerts"
                : "No alerts recorded yet"
          }
        >
          Alerts appear here when the deterministic risk engine detects physiological variances,
          medication deviations, or missing data thresholds.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" aria-busy={query.isFetching}>
          {query.data.rows.map((r) => (
            <AlertItem
              key={r.caseId}
              r={r}
              userId={userId}
              expanded={open === r.caseId}
              onToggle={() => setOpen(open === r.caseId ? null : r.caseId)}
            />
          ))}
        </ul>
      )}

      {/* 4. Pagination */}
      {total > ALERT_PAGE_SIZE && (
        <nav className="flex items-center justify-between pt-2" aria-label="Alert pages">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="size-4 mr-1" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-xs sm:text-sm font-medium text-muted-foreground">
            Page {page + 1} of {pages} · <strong className="text-foreground">{total}</strong> total alerts
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
            <ChevronRight className="size-4 ml-1" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}

function AlertItem({
  r,
  userId,
  expanded,
  onToggle,
}: {
  r: AlertRow;
  userId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const assign = useServerFn(assignReviewCase);
  const reopen = useServerFn(reopenAlert);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["alerts"] }),
      qc.invalidateQueries({ queryKey: ["alerts-overview-stats"] }),
      qc.invalidateQueries({ queryKey: ["review-case", r.caseId] }),
    ]);

  const assignMut = useMutation({
    mutationFn: (a: string | null) => assign({ data: { caseId: r.caseId, assignee: a } }),
    onSuccess: refresh,
  });

  const reopenMut = useMutation({
    mutationFn: () => reopen({ data: { seniorId: r.seniorId } }),
    onSuccess: refresh,
  });

  const closed = isCaseClosed(r.status);
  const err = assignMut.error ?? reopenMut.error;

  const initials =
    r.seniorName
      .replace(/^Synthetic\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "S";

  // Visual priority style mapping
  const isPrompt = r.priority === "prompt_review_recommended";
  const isRecommended = r.priority === "review_recommended";
  const isDataGap = r.priority === "unable_to_assess";

  return (
    <li
      className={cn(
        "group relative flex flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-xs transition-all duration-200 hover:shadow-md",
        // Crisp left accent edge to make it look like an authentic urgent alert
        isPrompt
          ? "border-l-[5px] border-l-red-500 border-border/80 bg-red-500/[0.015]"
          : isRecommended
            ? "border-l-[5px] border-l-amber-500 border-border/80 bg-amber-500/[0.015]"
            : isDataGap
              ? "border-l-[5px] border-l-sky-500 border-border/80 bg-sky-500/[0.015]"
              : "border-l-[5px] border-l-primary/60 border-border/80",
      )}
    >
      {/* 1. Alert Top Ribbon: Urgency Badges & Meta Case ID */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority Pill */}
          {isPrompt ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30 px-2.5 py-1 text-xs font-bold shadow-2xs">
              <AlertTriangle className="size-3.5 text-red-600 dark:text-red-400" />
              High Urgency · Prompt Review
            </span>
          ) : isRecommended ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 px-2.5 py-1 text-xs font-bold shadow-2xs">
              <AlertCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
              Review Recommended
            </span>
          ) : isDataGap ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 text-sky-800 dark:text-sky-300 border border-sky-500/30 px-2.5 py-1 text-xs font-semibold shadow-2xs">
              <HelpCircle className="size-3.5 text-sky-600 dark:text-sky-400" />
              Data Gap · Unable to Assess
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 text-xs font-medium shadow-2xs">
              <Info className="size-3.5" />
              Review Suggested
            </span>
          )}

          {/* Workflow Status Badge with Live Beacon */}
          {r.status === "needs_review" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/25 px-2.5 py-0.5 text-xs font-semibold">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-600" />
              </span>
              Open · Needs Action
            </span>
          ) : r.status === "in_review" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/25 px-2.5 py-0.5 text-xs font-medium">
              <span className="size-2 rounded-full bg-amber-500" />
              Acknowledged · In Review
            </span>
          ) : r.status === "follow_up_required" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 text-purple-800 dark:text-purple-300 border border-purple-500/25 px-2.5 py-0.5 text-xs font-medium">
              <ArrowUpRight className="size-3 text-purple-600" />
              Escalated to Follow-up
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-medium">
              <CheckCircle2 className="size-3 text-emerald-600" />
              Resolved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span>Case #{r.caseId.slice(0, 8)}</span>
          <span>•</span>
          <span>{whenRelative(r.openedAt)}</span>
        </div>
      </div>

      {/* 2. Senior Identity & Fast Triage Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          {/* Avatar with colored glow ring */}
          <span
            className={cn(
              "flex size-11 sm:size-12 shrink-0 items-center justify-center rounded-2xl font-bold text-sm sm:text-base border shadow-2xs",
              isPrompt
                ? "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30"
                : isRecommended
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                  : "bg-primary/10 text-primary border-primary/20",
            )}
          >
            {initials}
          </span>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/seniors/$seniorId"
                params={{ seniorId: r.seniorId }}
                className="text-base sm:text-lg font-bold text-foreground hover:text-primary transition-colors hover:underline tracking-tight"
              >
                {r.seniorName}
              </Link>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground border border-border/50">
                {r.recordCode}
              </span>
              {r.isSynthetic && (
                <span className="rounded-full bg-secondary/80 border border-border/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Synthetic Record
                </span>
              )}
            </div>
            <Link
              to="/seniors/$seniorId"
              params={{ seniorId: r.seniorId }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 font-medium"
            >
              <span>Open senior health profile</span>
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </div>

        {/* Triage Action Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:self-center shrink-0">
          {!closed && r.assignedTo !== userId && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs font-medium border-border/80"
              disabled={assignMut.isPending}
              onClick={() => assignMut.mutate(userId)}
            >
              <UserCheck className="size-3.5 text-primary" />
              Assign to me
            </Button>
          )}
          {!closed && r.assignedTo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              disabled={assignMut.isPending}
              onClick={() => assignMut.mutate(null)}
            >
              <UserX className="size-3.5" />
              Unassign
            </Button>
          )}
          {closed && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              disabled={reopenMut.isPending}
              onClick={() => reopenMut.mutate()}
            >
              Reopen Alert
            </Button>
          )}
          <Button
            size="sm"
            className={cn(
              "h-9 gap-1.5 text-xs font-semibold shadow-xs transition-all",
              expanded
                ? "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`alert-${r.caseId}`}
          >
            <Eye className="size-3.5" />
            <span>{expanded ? "Collapse details" : "Review Case"}</span>
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-180")}
            />
          </Button>
        </div>
      </div>

      {/* 3. Visual Telemetry Signal Pills (Replaces boring plain text sentence!) */}
      <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3 border border-border/50">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Activity className="size-3.5 text-primary" />
          Detected Health & Care Variances
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {r.changedDomains.length > 0 ? (
            r.changedDomains.map((d) => <DomainSignalPill key={d} domain={d} />)
          ) : isDataGap ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/40 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:text-sky-300">
              <HelpCircle className="size-3.5 text-sky-600 dark:text-sky-400" />
              Insufficient telemetry data — recent vitals missing
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Evaluated clinical metrics within baseline parameters
            </span>
          )}

          {r.dataQuality === "limited" && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground font-normal">
              Data limitations apply
            </Badge>
          )}
        </div>
      </div>

      {/* 4. Recommended Action Banner (Fixed Contrast & Crisp Clinical Framing) */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-900/60 p-3 text-xs sm:text-sm flex items-start gap-2.5 shadow-2xs">
        <div className="p-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5">
          <ShieldAlert className="size-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-amber-950 dark:text-amber-200 mr-1.5">
            Recommended Coordinator Action:
          </span>
          <span className="text-amber-900 dark:text-amber-100 font-medium">
            {nextAlertStep(r.status, !!r.assignedTo)}
          </span>
        </div>
      </div>

      {/* 5. Timestamps & Ownership Metadata */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground border-t border-border/40 pt-2.5">
        <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
          <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Raised {when(r.openedAt)}
        </span>
        <span className="text-muted-foreground/40">•</span>
        <span>Assessment {when(r.assessedAt)}</span>
        <span className="text-muted-foreground/40">•</span>
        {r.assignedTo ? (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <UserCheck className="size-3.5 text-primary" aria-hidden="true" />
            Assigned to {r.assigneeName ?? "a coordinator"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
            <UserX className="size-3.5" aria-hidden="true" />
            Unassigned · Needs owner
          </span>
        )}
      </div>

      {/* Error notification if mutation fails */}
      {err && (
        <div className="mt-1">
          <Notice
            tone="critical"
            title={err instanceof Error ? err.message : "Action could not be completed."}
          />
        </div>
      )}

      {/* 6. Smooth In-Place Review Tray (Case Detail + Evidence Panel) */}
      {expanded && (
        <div
          id={`alert-${r.caseId}`}
          className="mt-3 flex flex-col gap-6 rounded-2xl border border-primary/20 bg-muted/20 p-5 pt-4 transition-all animate-in fade-in-50 duration-200"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">
                Clinical Evidence & Workflow Review
              </h4>
            </div>
            <Button variant="ghost" size="sm" onClick={onToggle} className="h-7 text-xs">
              Close
            </Button>
          </div>
          <CaseDetail caseId={r.caseId} timeZone={r.timeZone} />
          <AssessmentPanel seniorId={r.seniorId} timeZone={r.timeZone} />
        </div>
      )}
    </li>
  );
}
