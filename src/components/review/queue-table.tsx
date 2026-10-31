import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Droplets,
  Footprints,
  HeartPulse,
  Info,
  Moon,
  Pill,
  Search,
  Sparkles,
  UserCheck,
} from "lucide-react";

import { EmptyState, Notice } from "@/components/shell/states";
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
import { CASE_STATUS_LABEL } from "@/lib/review-labels";
import { listReviewQueue, QUEUE_PAGE_SIZE } from "@/lib/review.functions";
import { sanitizeSearch } from "@/lib/seniors";
import { PRIORITY_LABEL, QUALITY_LABEL, DOMAIN_LABEL } from "@/risk/labels";
import type { ReviewPriority, QualityStatus } from "@/risk/engine";
import type { ReviewCaseStatus } from "@/lib/review-workflow";
import { cn } from "@/lib/utils";

const PRIORITY_OPTIONS: { value: ReviewPriority; label: string }[] = [
  { value: "prompt_review_recommended", label: "High Priority" },
  { value: "review_recommended", label: "Review Recommended" },
  { value: "review_suggested", label: "Review Suggested" },
  { value: "unable_to_assess", label: "Low / Stale Data" },
  { value: "no_signal_detected", label: "Routine Stable" },
];

const STATUS_OPTIONS: { value: ReviewCaseStatus; label: string }[] = [
  { value: "needs_review", label: "Needs Coordinator" },
  { value: "in_review", label: "In Review" },
  { value: "follow_up_required", label: "Follow-up Required" },
];

const QUALITY_OPTIONS: { value: QualityStatus; label: string }[] = [
  { value: "adequate", label: "Adequate data" },
  { value: "limited", label: "Limited data" },
  { value: "insufficient", label: "Insufficient data" },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function getSeniorInitials(name: string): string {
  const parts = name.replace(/^Synthetic\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "S";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function getDomainMeta(domain: string) {
  switch (domain) {
    case "blood_pressure":
      return { label: "Blood Pressure", icon: HeartPulse, color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40" };
    case "medication":
      return { label: "Medication Event", icon: Pill, color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/40" };
    case "mobility":
      return { label: "Mobility Concern", icon: Footprints, color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40" };
    case "heart_rate":
      return { label: "Heart Rate", icon: Activity, color: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-900/40" };
    case "intake":
      return { label: "Food & Fluids", icon: Droplets, color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900/40" };
    case "sleep":
      return { label: "Sleep Disruption", icon: Moon, color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/40" };
    default:
      return { label: DOMAIN_LABEL[domain] ?? domain, icon: Sparkles, color: "bg-secondary text-secondary-foreground border-border" };
  }
}

function getPriorityBadge(p: ReviewPriority) {
  switch (p) {
    case "prompt_review_recommended":
      return { label: "High Priority", icon: AlertCircle, style: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" };
    case "review_recommended":
      return { label: "Review Recommended", icon: AlertTriangle, style: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30" };
    case "review_suggested":
      return { label: "Review Suggested", icon: Info, style: "bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30" };
    case "unable_to_assess":
      return { label: "Low Data Quality", icon: AlertTriangle, style: "bg-secondary text-secondary-foreground border-border" };
    default:
      return { label: "Stable Signal", icon: CheckCircle2, style: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30" };
  }
}

function getStatusBadge(s: ReviewCaseStatus) {
  switch (s) {
    case "needs_review":
      return { label: "Needs Coordinator", style: "bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300" };
    case "in_review":
      return { label: "Under Review", style: "bg-sky-50 text-sky-800 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300" };
    case "follow_up_required":
      return { label: "Follow-up Pending", style: "bg-purple-50 text-purple-800 border-purple-200/80 dark:bg-purple-950/40 dark:text-purple-300" };
    case "resolved":
      return { label: "Resolved", style: "bg-emerald-50 text-emerald-800 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300" };
    default:
      return { label: "Dismissed", style: "bg-muted text-muted-foreground border-transparent" };
  }
}

/** The coordinator review queue: org-scoped, filtered and sorted server-side. */
export function QueueTable() {
  const run = useServerFn(listReviewQueue);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReviewCaseStatus | null>(null);
  const [priority, setPriority] = useState<ReviewPriority | null>(null);
  const [quality, setQuality] = useState<QualityStatus | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(sanitizeSearch(input));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useQuery({
    queryKey: ["review-queue", search, status, priority, quality, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      run({
        data: { page, search, status, priority, dataQuality: quality, assignee: null },
      }),
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="queue-search"
            type="search"
            placeholder="Search by senior name or record ID..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-10 pl-9 rounded-xl border-border/60 bg-background/50 focus-visible:bg-background"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <FilterSelect
            label="Review status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            label="Priority"
            value={priority}
            onChange={(v) => {
              setPriority(v);
              setPage(0);
            }}
            options={PRIORITY_OPTIONS}
          />
          <FilterSelect
            label="Data quality"
            value={quality}
            onChange={(v) => {
              setQuality(v);
              setPage(0);
            }}
            options={QUALITY_OPTIONS}
          />
        </div>
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-3 py-6" role="status">
          <div className="h-28 rounded-2xl bg-card border border-border/60 animate-pulse" />
          <div className="h-28 rounded-2xl bg-card border border-border/60 animate-pulse" />
          <div className="h-28 rounded-2xl bg-card border border-border/60 animate-pulse" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3 p-4">
          <Notice tone="critical" title="Couldn't load the review queue." />
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={search || status || priority || quality ? "No matching cases" : "All cases up to date"}
        >
          {search || status || priority || quality
            ? "No review cases match your active filters. Try resetting search criteria."
            : "No active care alerts currently require coordinator review."}
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" role="status" aria-live="polite">
              {total} active {total === 1 ? "case" : "cases"} requiring attention
              {search ? ` matching "${search}"` : ""}
            </p>
          </div>

          <ul className="flex flex-col gap-3.5" aria-busy={query.isFetching}>
            {query.data.rows.map((r) => {
              const pBadge = getPriorityBadge(r.priority);
              const sBadge = getStatusBadge(r.status);
              const PIcon = pBadge.icon;
              const initials = getSeniorInitials(r.seniorName);

              return (
                <li key={r.caseId}>
                  <Link
                    to="/seniors/$seniorId"
                    params={{ seniorId: r.seniorId }}
                    search={{ tab: "alerts" }}
                    className="group relative flex flex-col gap-3.5 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all duration-200 hover:border-primary/50 hover:bg-card/90 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {/* Header: Senior Identity + Badges + Action */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Senior Avatar */}
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 font-bold text-sm">
                          {initials}
                        </span>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                              {r.seniorName}
                            </span>
                            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                              {r.recordCode}
                            </span>
                            {r.isSynthetic && (
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                Synthetic Record
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Badges & Action Arrow */}
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {/* Urgency Pill */}
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border",
                            pBadge.style,
                          )}
                        >
                          <PIcon className="size-3.5" aria-hidden="true" />
                          {pBadge.label}
                        </span>

                        {/* Status Pill */}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border",
                            sBadge.style,
                          )}
                        >
                          {sBadge.label}
                        </span>

                        {/* Action link */}
                        <span className="hidden items-center gap-1 text-xs font-semibold text-primary transition-transform group-hover:translate-x-1 sm:inline-flex ml-1">
                          Review <ArrowRight className="size-3.5" aria-hidden="true" />
                        </span>
                      </div>
                    </div>

                    {/* Middle: Clinical Concern Chips */}
                    {r.changedDomains.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-xs font-medium text-muted-foreground mr-1">
                          Key signals:
                        </span>
                        {r.changedDomains.map((d) => {
                          const meta = getDomainMeta(d);
                          const DIcon = meta.icon;
                          return (
                            <span
                              key={d}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-xs font-medium",
                                meta.color,
                              )}
                            >
                              <DIcon className="size-3" aria-hidden="true" />
                              {meta.label}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Footer: Human-readable operational metadata */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden="true" />
                        Assessed {formatWhen(r.assessedAt)}
                      </span>

                      {r.assigneeName ? (
                        <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                          <UserCheck className="size-3.5 text-primary" aria-hidden="true" />
                          Assigned to {r.assigneeName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <UserCheck className="size-3.5" aria-hidden="true" />
                          Unassigned
                        </span>
                      )}

                      {r.openTaskCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2 py-0.5 font-medium text-foreground">
                          <ClipboardList className="size-3.5" aria-hidden="true" />
                          {r.openTaskCount} {r.openTaskCount === 1 ? "task" : "tasks"}
                        </span>
                      )}

                      {r.nextTaskDueAt && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3.5" aria-hidden="true" />
                          Next due: {formatWhen(r.nextTaskDueAt)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {pages > 1 && (
            <nav aria-label="Queue pages" className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" /> Previous
              </Button>
              <span className="text-xs font-medium text-muted-foreground">
                Page {page + 1} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
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
    <div className="flex items-center gap-1.5">
      <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? null : (v as T))}>
        <SelectTrigger className="h-10 min-w-36 rounded-xl border-border/60 bg-background/50 text-xs font-medium focus-visible:bg-background" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All {label}</SelectItem>
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
