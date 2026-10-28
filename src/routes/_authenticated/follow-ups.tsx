import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page } from "@/components/shell/page";
import { EmptyState, Notice } from "@/components/shell/states";
import { TaskList } from "@/components/tasks/task-list";
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
import { listFollowUpTasks, TASK_PAGE_SIZE } from "@/lib/review.functions";
import { sanitizeSearch } from "@/lib/seniors";
import type { FollowUpTaskStatus } from "@/lib/review-workflow";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({
    meta: [
      { title: "Follow-ups — Sahaara" },
      {
        name: "description",
        content: "Follow-up tasks your care team has recorded, with due dates and outcomes.",
      },
      { property: "og:title", content: "Follow-ups — Sahaara" },
      {
        property: "og:description",
        content: "Follow-up tasks your care team has recorded, with due dates and outcomes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FollowUpsPage,
});

type Bucket = "all" | "overdue" | "due_soon" | "closed";

const BUCKET_OPTIONS: { value: Bucket; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due in 48 hours" },
  { value: "closed", label: "Completed or cancelled" },
];

const STATUS_OPTIONS: { value: FollowUpTaskStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function FollowUpsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      eyebrow="Care"
      title="Follow-ups"
      description="The next human actions your team has recorded. Overdue is always worked out from the due date — never set by hand."
    >
      <CareAccessGate userId={user.id}>{() => <Tasks />}</CareAccessGate>
    </Page>
  );
}

function Tasks() {
  const run = useServerFn(listFollowUpTasks);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [status, setStatus] = useState<FollowUpTaskStatus | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(sanitizeSearch(input));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useQuery({
    queryKey: ["follow-up-tasks", search, bucket, status, page],
    placeholderData: keepPreviousData,
    queryFn: () => run({ data: { page, search, bucket, status } }),
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="task-search" className="sr-only">
            Search follow-up tasks
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="task-search"
              type="search"
              placeholder="Search by task, name or record ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-11 pl-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-sm text-muted-foreground">Due</Label>
            <Select
              value={bucket}
              onValueChange={(v) => {
                setBucket(v as Bucket);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Due filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-sm text-muted-foreground">Status</Label>
            <Select
              value={status ?? "all"}
              onValueChange={(v) => {
                setStatus(v === "all" ? null : (v as FollowUpTaskStatus));
                setPage(0);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {query.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading follow-up tasks…
        </p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="critical" title="Couldn't load follow-up tasks." />
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={search || status || bucket !== "all" ? "No matches" : "No follow-up tasks yet"}
        >
          {search || status || bucket !== "all"
            ? "No tasks match the current search and filters."
            : "Tasks are created from a senior's profile or review case."}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {total} {total === 1 ? "task" : "tasks"}
            {search ? ` matching "${search}"` : ""}
          </p>
          <div aria-busy={query.isFetching}>
            <TaskList tasks={query.data.rows} showSenior />
          </div>
          {pages > 1 && (
            <nav aria-label="Task pages" className="flex items-center justify-between gap-3">
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
