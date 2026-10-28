import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, Users } from "lucide-react";

import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ageFrom, CARE_STATUS, DIRECTORY_PAGE_SIZE, sanitizeSearch } from "@/lib/seniors";

export const Route = createFileRoute("/_authenticated/seniors/")({
  head: () => ({
    meta: [
      { title: "Seniors — Sahaara" },
      { name: "description", content: "Directory of seniors your care team supports." },
      { property: "og:title", content: "Seniors — Sahaara" },
      { property: "og:description", content: "Directory of seniors your care team supports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SeniorsPage,
});

function SeniorsPage() {
  const { user } = Route.useRouteContext();
  return (
    <Page
      eyebrow="Care"
      title="Seniors"
      description="People your organisation supports. Only records you're authorised to see are listed."
      actions={
        <Button asChild>
          <Link to="/seniors/new">
            <Plus aria-hidden="true" /> Add senior
          </Link>
        </Button>
      }
    >
      <CareAccessGate userId={user.id}>{() => <Directory />}</CareAccessGate>
    </Page>
  );
}

function Directory() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(sanitizeSearch(input));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const list = useQuery({
    queryKey: ["seniors", q, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let req = supabase
        .from("seniors")
        .select("id, record_code, display_name, care_status, is_synthetic, date_of_birth", {
          count: "exact",
        })
        .order("display_name")
        .order("id")
        .range(page * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE + DIRECTORY_PAGE_SIZE - 1);
      if (q) req = req.or(`display_name.ilike.%${q}%,record_code.ilike.%${q}%`);
      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-md">
        <Label htmlFor="senior-search" className="sr-only">
          Search seniors
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="senior-search"
            type="search"
            placeholder="Search by name or record ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-11 pl-9"
            autoComplete="off"
          />
        </div>
      </div>

      {list.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading seniors…
        </p>
      ) : list.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="critical" title="Couldn't load the directory." />
          <Button variant="outline" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={Users} title={q ? "No matches" : "No seniors yet"}>
          {q ? `No records match "${q}".` : "Add the first senior your team supports."}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {total} {total === 1 ? "record" : "records"}
            {q ? ` matching "${q}"` : ""}
          </p>
          <ul className="surface divide-y divide-border" aria-busy={list.isFetching}>
            {list.data.rows.map((s) => {
              const age = ageFrom(s.date_of_birth);
              return (
                <li key={s.id}>
                  <Link
                    to="/seniors/$seniorId"
                    params={{ seniorId: s.id }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 transition-standard hover:bg-secondary/60 focus-visible:bg-secondary/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{s.display_name}</span>
                      <span className="text-sm text-muted-foreground">
                        {s.record_code}
                        {age != null ? ` · ${age} yrs` : ""}
                      </span>
                    </span>
                    {s.is_synthetic && <StatusBadge tone="neutral">Synthetic</StatusBadge>}
                    <StatusBadge tone={s.care_status === "active" ? "success" : "neutral"}>
                      {CARE_STATUS[s.care_status]}
                    </StatusBadge>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav aria-label="Directory pages" className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || list.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden="true" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {pages}
              </span>
              <Button
                variant="outline"
                disabled={page + 1 >= pages || list.isFetching}
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
