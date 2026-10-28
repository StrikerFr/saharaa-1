import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Point } from "@/lib/charts";

/** Card frame for a chart: title, description, the chart, and a text alternative. */
export function ChartCard({
  title,
  description,
  summary,
  children,
  table,
}: {
  title: string;
  description?: ReactNode;
  /** One-sentence plain-language summary, read by screen readers and shown below. */
  summary: string;
  children: ReactNode;
  /** Underlying values, revealed on demand. */
  table?: ReactNode;
}) {
  return (
    <figure className="surface flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <figcaption>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </figcaption>
      <div aria-hidden="true">{children}</div>
      <p className="text-sm text-muted-foreground">{summary}</p>
      {table && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring">
            Show values
          </summary>
          <div className="mt-2 max-h-64 overflow-auto">{table}</div>
        </details>
      )}
    </figure>
  );
}

const axis = { fontSize: 12, fill: "var(--color-muted-foreground)" };
const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 13,
};

/** Daily counts as bars. `label` formats the x value. */
export function CountBars({
  data,
  label,
  unit,
  height = 180,
}: {
  data: { x: string; count: number }[];
  label: (x: string) => string;
  unit: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="x"
          tickFormatter={label}
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          cursor={{ fill: "var(--color-secondary)" }}
          contentStyle={tooltipStyle}
          labelFormatter={(x) => label(String(x))}
          formatter={(v) => [`${v} ${unit}`, ""]}
          separator=""
        />
        <Bar
          dataKey="count"
          fill="var(--color-chart-1)"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Measurements over real time; null points render as gaps. */
export function MeasureLine({
  data,
  unit,
  timeZone,
  domain,
  second,
  height = 180,
}: {
  data: Point[];
  unit: string;
  timeZone: string;
  domain: [number, number];
  /** Label pair when `v2` is plotted (e.g. systolic/diastolic). */
  second?: [string, string] | undefined;
  height?: number;
}) {
  const fmt = (t: number) =>
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone }).format(t);
  const fmtFull = (t: number) =>
    new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
      t,
    );
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={domain}
          tickFormatter={fmt}
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis domain={["auto", "auto"]} tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(t) => fmtFull(Number(t))}
          formatter={(v, name) => [
            `${v} ${unit}`,
            second ? (name === "v" ? second[0] : second[1]) : "",
          ]}
          separator={second ? ": " : ""}
        />
        <Line
          dataKey="v"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        {second && (
          <Line
            dataKey="v2"
            stroke="var(--color-chart-3)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal labelled bars for a categorical breakdown (status counts). */
export function StatusBars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-chart-1"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </span>
          <span className="text-data w-8 text-right tabular-nums">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}
