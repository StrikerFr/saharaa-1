import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ChartCard, MeasureLine } from "@/components/charts/charts";
import { Section } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { MIN_TREND_POINTS, withGaps, type Point } from "@/lib/charts";
import { OBSERVATION_ICON } from "@/lib/observation-icons";
import { formatInZone, OBSERVATION_TYPES } from "@/lib/seniors";

const RANGES = [7, 30, 90] as const;
const MEASURES = ["heart_rate", "blood_pressure", "weight", "sleep_duration"] as const;
type Measure = (typeof MEASURES)[number];

type Row = {
  type: Measure;
  value_numeric: number | null;
  value_numeric_2: number | null;
  observed_at: string;
  verification: "verified" | "unverified";
};

/** Trend charts for the numeric observation types, from real readings only. */
export function ObservationTrends({ seniorId, timeZone }: { seniorId: string; timeZone: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery({
    queryKey: ["observation-trends", seniorId, days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("observations")
        .select("type, value_numeric, value_numeric_2, observed_at, verification")
        .eq("senior_id", seniorId)
        .in("type", [...MEASURES])
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  const end = Date.now();
  const domain: [number, number] = [end - days * 86_400_000, end];

  return (
    <Section
      title="Trends"
      description="Readings plotted at the time they were observed. Gaps longer than 3 days are left blank, never filled in."
      action={
        <ToggleGroup
          type="single"
          value={String(days)}
          onValueChange={(v) => v && setDays(Number(v) as (typeof RANGES)[number])}
          aria-label="Time range"
          variant="outline"
        >
          {RANGES.map((r) => (
            <ToggleGroupItem key={r} value={String(r)} className="min-h-10 px-3">
              {r} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {MEASURES.map((m) => (
            <Skeleton key={m} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <Notice tone="critical" title="Couldn't load trends." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {MEASURES.map((m) => (
            <MeasureCard
              key={m}
              measure={m}
              rows={q.data.filter((r) => r.type === m && r.value_numeric != null)}
              days={days}
              timeZone={timeZone}
              domain={domain}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function MeasureCard({
  measure,
  rows,
  days,
  timeZone,
  domain,
}: {
  measure: Measure;
  rows: Row[];
  days: number;
  timeZone: string;
  domain: [number, number];
}) {
  const def = OBSERVATION_TYPES[measure];
  const Icon = OBSERVATION_ICON[measure];
  const pair = measure === "blood_pressure";
  const fmt = (r: Row) =>
    pair ? `${r.value_numeric}/${r.value_numeric_2}` : String(r.value_numeric);
  const points: Point[] = rows.map((r) => ({
    t: new Date(r.observed_at).getTime(),
    v: r.value_numeric,
    v2: pair ? r.value_numeric_2 : undefined,
  }));
  const unverified = rows.filter((r) => r.verification === "unverified").length;
  const last = rows.at(-1);
  const title = (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-4 text-primary" aria-hidden="true" /> {def.label} ({def.unit})
    </span>
  );

  if (rows.length < MIN_TREND_POINTS) {
    return (
      <section className="surface flex min-w-0 flex-col gap-2 p-4 sm:p-5">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? `No readings in the last ${days} days. No data is not the same as normal.`
            : `Only ${rows.length} reading${rows.length === 1 ? "" : "s"} in the last ${days} days — not enough for a trend.`}
        </p>
        {rows.length > 0 && (
          <ul className="text-sm">
            {rows.map((r) => (
              <li
                key={r.observed_at}
                className="flex justify-between gap-3 border-t border-border py-1.5"
              >
                <span className="text-muted-foreground">
                  {formatInZone(r.observed_at, timeZone)}
                </span>
                <span className="text-data">
                  {fmt(r)} {def.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const values = rows.map((r) => r.value_numeric as number);
  return (
    <ChartCard
      title={def.label + ` (${def.unit})`}
      description={
        <>
          {rows.length} readings, last {days} days
          {pair && " · solid = systolic, dashed = diastolic"}
          {unverified > 0 && ` · ${unverified} unverified`}
        </>
      }
      summary={`${pair ? "Systolic" : def.label} ranged ${Math.min(...values)}–${Math.max(...values)} ${def.unit}. Latest: ${last ? `${fmt(last)} ${def.unit}, ${formatInZone(last.observed_at, timeZone)}` : "none"}.`}
      table={
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-semibold">Observed</th>
              <th className="py-1 text-right font-semibold">Value</th>
              <th className="py-1 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.observed_at} className="border-t border-border">
                <td className="py-1">{formatInZone(r.observed_at, timeZone)}</td>
                <td className="text-data py-1 text-right">
                  {fmt(r)} {def.unit}
                </td>
                <td className="py-1 text-right">
                  {r.verification === "unverified" ? "Unverified" : "Verified"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <MeasureLine
        data={withGaps(points)}
        unit={def.unit}
        timeZone={timeZone}
        domain={domain}
        second={pair ? ["Systolic", "Diastolic"] : undefined}
      />
    </ChartCard>
  );
}
