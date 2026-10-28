import { ChartCard, CountBars } from "@/components/charts/charts";
import { countByDay } from "@/lib/charts";

const shortDay = (d: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  );

/** Bar chart of records per calendar day with a value table and text summary. */
export function DailyVolumeCard({
  title,
  timestamps,
  days,
  timeZone,
  unit,
  truncated,
}: {
  title: string;
  timestamps: string[];
  days: number;
  timeZone: string;
  unit: string;
  /** True when the query hit its row cap, so counts are a lower bound. */
  truncated?: boolean;
}) {
  const series = countByDay(timestamps, days, timeZone);
  const total = series.reduce((n, d) => n + d.count, 0);
  const empty = series.filter((d) => d.count === 0).length;
  return (
    <ChartCard
      title={title}
      description={`Last ${days} days · grouped by observed day in ${timeZone}`}
      summary={
        total === 0
          ? `No ${unit} in the last ${days} days.`
          : `${total}${truncated ? "+" : ""} ${unit} in ${days} days; ${empty} of those days had none.`
      }
      table={
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-semibold">Day</th>
              <th className="py-1 text-right font-semibold">Count</th>
            </tr>
          </thead>
          <tbody>
            {series.map((d) => (
              <tr key={d.day} className="border-t border-border">
                <td className="py-1">{shortDay(d.day)}</td>
                <td className="text-data py-1 text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <CountBars
        data={series.map((d) => ({ x: d.day, count: d.count }))}
        label={shortDay}
        unit={unit}
      />
    </ChartCard>
  );
}
