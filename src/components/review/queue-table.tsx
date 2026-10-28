import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ClipboardList, Search } from "lucide-react";

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
import { CASE_STATUS_LABEL } from "@/lib/review-labels";
import { listReviewQueue, QUEUE_PAGE_SIZE } from "@/lib/review.functions";
import { sanitizeSearch } from "@/lib/seniors";
import { PRIORITY_LABEL, QUALITY_LABEL, DOMAIN_LABEL } from "@/risk/labels";
import type { ReviewPriority, QualityStatus } from "@/risk/engine";
import type { ReviewCaseStatus } from "@/lib/review-workflow";

const PRIORITY_OPTIONS: { value: ReviewPriority; label: string }[] = [
  { value: "prompt_review_recommended", label: PRIORITY_LABEL.prompt_review_recommended.label },
  { value: "review_recommended", label: PRIORITY_LABEL.review_recommended.label },
  { value: "review_suggested", label: PRIORITY_LABEL.review_suggested.label },
  { value: "unable_to_assess", label: PRIORITY_LABEL.unable_to_assess.label },
  { value: "no_signal_detected", label: PRIORITY_LABEL.no_signal_detected.label },
];

const STATUS_OPTIONS: { value: ReviewCaseStatus; label: string }[] = [
  { value: "needs_review", label: CASE_STATUS_LABEL.needs_review.label },
  { value: "in_review", label: CASE_STATUS_LABEL.in_review.label },
  { value: "follow_up_required", label: CASE_STATUS_LABEL.follow_up_required.label },
];

const QUALITY_OPTIONS: { value: QualityStatus; label: string }[] = [
  { value: "adequate", label: "Adequate data" },
  { value: "limited", label: "Limited data" },
  { value: "insufficient", label: "Insufficient data" },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="queue-search" className="sr-only">
            Search the queue
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="queue-search"
              type="search"
              placeholder="Search by name or record ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-11 pl-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
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
        <p role="status" className="text-muted-foreground">
          Loading the review queue…
        </p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="critical" title="Couldn't load the review queue." />
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={search || status || priority || quality ? "No matches" : "No cases need review"}
        >
          {search || status || priority || quality
            ? "No cases match the current search and filters."
            : "When an assessment is opened for review, it will appear here."}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {total} {total === 1 ? "case" : "cases"}
            {search ? ` matching "${search}"` : ""}
          </p>
          <ul className="surface divide-y divide-border" aria-busy={query.isFetching}>
            {query.data.rows.map((r) => {
              const p = PRIORITY_LABEL[r.priority];
              const cs = CASE_STATUS_LABEL[r.status];
              return (
                <li key={r.caseId}>
                  <Link
                    to="/seniors/$seniorId"
                    params={{ seniorId: r.seniorId }}
                    className="flex flex-col gap-2 px-4 py-4 transition-standard hover:bg-secondary/60 focus-visible:bg-secondary/60"
                  >
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{r.seniorName}</span>
                      <span className="text-sm text-muted-foreground">{r.recordCode}</span>
                      {r.isSynthetic && <StatusBadge tone="neutral">Synthetic</StatusBadge>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
                      <StatusBadge tone={r.dataQuality === "adequate" ? "neutral" : "warning"}>
                        {QUALITY_LABEL[r.dataQuality]}
                      </StatusBadge>
                      <StatusBadge tone={cs.tone}>{cs.label}</StatusBadge>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {r.changedDomains.length > 0
                        ? `Areas: ${r.changedDomains.map((d) => DOMAIN_LABEL[d] ?? d).join(", ")} · `
                        : ""}
                      Assessed {formatWhen(r.assessedAt)}
                      {r.assigneeName ? ` · Assigned to ${r.assigneeName}` : ""}
                      {r.nextTaskDueAt
                        ? ` · Next follow-up due ${formatWhen(r.nextTaskDueAt)}`
                        : ""}
                      {r.openTaskCount > 0
                        ? ` · ${r.openTaskCount} open ${r.openTaskCount === 1 ? "task" : "tasks"}`
                        : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav aria-label="Queue pages" className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden="true" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {pages}
              </span>
              <Button
                variant="outline"
                disabled={page + 1 >= pages || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight aria-hidden="true" />
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
    <div className="flex flex-col gap-1">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? null : (v as T))}>
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
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
