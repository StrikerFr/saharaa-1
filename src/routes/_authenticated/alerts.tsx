import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { CaseDetail } from "@/components/review/case-detail";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { AssessmentPanel } from "@/components/seniors/assessment-panel";
import { Page } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
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
import { DOMAIN_LABEL, PRIORITY_LABEL } from "@/risk/labels";
import type { ReviewPriority } from "@/risk/engine";

const META = "Alerts raised from risk assessments, with evidence, status history and next steps.";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Sahaara" },
      { name: "description", content: META },
      { property: "og:title", content: "Alerts — Sahaara" },
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
const domainLabel = (d: string) => (DOMAIN_LABEL as Record<string, string>)[d] ?? d;

function AlertsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      eyebrow="Care"
      title="Alerts"
      description="Concerns surfaced by the risk assessment for human review. An alert is a suggestion to look — never a diagnosis, and missing data is never treated as reassurance."
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
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value ?? "__all"}
        onValueChange={(v) => onChange(v === "__all" ? null : (v as T))}
      >
        <SelectTrigger className="h-11 min-w-40" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
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
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ALERT_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Label htmlFor="alert-search" className="sr-only">
            Search alerts
          </Label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="alert-search"
            type="search"
            placeholder="Search by name or record ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-11 pl-9"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Pick
            label="Show"
            value={scope}
            onChange={(v) => reset(setScope)(v ?? "all")}
            options={[
              { value: "active", label: "Active" },
              { value: "closed", label: "Closed" },
            ]}
          />
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
          <div className="flex flex-col gap-1">
            <Label htmlFor="alert-from" className="text-xs text-muted-foreground">
              Raised from
            </Label>
            <Input
              id="alert-from"
              type="date"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="alert-to" className="text-xs text-muted-foreground">
              Raised to
            </Label>
            <Input
              id="alert-to"
              type="date"
              value={to}
              onChange={(e) => reset(setTo)(e.target.value)}
              className="h-11"
            />
          </div>
          <Pick
            label="Sort"
            value={sort}
            onChange={(v) => reset(setSort)(v ?? "priority")}
            options={[
              { value: "priority", label: "Priority" },
              { value: "newest", label: "Newest raised" },
              { value: "updated", label: "Recently updated" },
            ]}
          />
        </div>
      </div>

      {query.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading alerts…
        </p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="critical" title="Couldn't load alerts.">
            {query.error instanceof Error ? query.error.message : "Please try again."}
          </Notice>
          <Button variant="outline" onClick={() => query.refetch()}>
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
                ? "No active alerts"
                : "No alerts yet"
          }
        >
          Alerts appear here when a saved risk assessment suggests a review or could not assess
          reliably. No alert does not mean a person is safe.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-busy={query.isFetching}>
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

      {total > ALERT_PAGE_SIZE && (
        <nav className="flex items-center justify-between" aria-label="Alert pages">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {pages} · {total} alerts
          </span>
          <Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
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
  const p = PRIORITY_LABEL[r.priority];
  const closed = isCaseClosed(r.status);
  const err = assignMut.error ?? reopenMut.error;

  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/seniors/$seniorId"
              params={{ seniorId: r.seniorId }}
              className="text-card-title underline-offset-2 hover:underline focus-visible:underline"
            >
              {r.seniorName}
            </Link>
            <span className="text-sm text-muted-foreground">{r.recordCode}</span>
            {r.isSynthetic && <StatusBadge tone="neutral">Synthetic test record</StatusBadge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
            <StatusBadge tone={CASE_STATUS_LABEL[r.status].tone}>
              {ALERT_STATUS_LABEL[r.status]}
            </StatusBadge>
          </div>
          <p className="text-sm">
            {explainAlert({
              priority: r.priority,
              dataQuality: r.dataQuality,
              changedDomains: r.changedDomains,
              domainLabel,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            Raised {when(r.openedAt)} · Updated {when(r.updatedAt)} · Assessment{" "}
            {when(r.assessedAt)} ·{" "}
            {r.assignedTo ? `Assigned to ${r.assigneeName ?? "a coordinator"}` : "Unassigned"}
          </p>
          <p className="text-sm font-medium">
            Next step: {nextAlertStep(r.status, !!r.assignedTo)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {!closed && r.assignedTo !== userId && (
            <Button
              variant="outline"
              size="sm"
              disabled={assignMut.isPending}
              onClick={() => assignMut.mutate(userId)}
            >
              Assign to me
            </Button>
          )}
          {!closed && r.assignedTo && (
            <Button
              variant="ghost"
              size="sm"
              disabled={assignMut.isPending}
              onClick={() => assignMut.mutate(null)}
            >
              Unassign
            </Button>
          )}
          {closed && (
            <Button
              variant="outline"
              size="sm"
              disabled={reopenMut.isPending}
              onClick={() => reopenMut.mutate()}
            >
              Reopen
            </Button>
          )}
          <Button
            size="sm"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`alert-${r.caseId}`}
          >
            {expanded ? "Hide details" : "Review"}
          </Button>
        </div>
      </div>
      {err && (
        <div className="mt-3">
          <Notice
            tone="critical"
            title={err instanceof Error ? err.message : "That didn't work."}
          />
        </div>
      )}
      {expanded && (
        <div
          id={`alert-${r.caseId}`}
          className="mt-5 flex flex-col gap-6 border-t border-border pt-5"
        >
          <CaseDetail caseId={r.caseId} timeZone={r.timeZone} />
          <AssessmentPanel seniorId={r.seniorId} timeZone={r.timeZone} />
        </div>
      )}
    </li>
  );
}
