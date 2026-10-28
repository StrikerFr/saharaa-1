// Pure helpers that turn persisted records into chart series. They never
// invent values: empty days are 0 counts (a count of nothing), while missing
// measurements are gaps (null), never zero.

const DAY = 86_400_000;

/** Calendar-day key (YYYY-MM-DD) in a time zone. */
export function dayKey(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** Counts per day for the last `days` days (oldest first), including today. */
export function countByDay(
  timestamps: string[],
  days: number,
  timeZone: string,
  now = new Date(),
): { day: string; count: number }[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--)
    keys.push(dayKey(new Date(now.getTime() - i * DAY), timeZone));
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const t of timestamps) {
    const k = dayKey(t, timeZone);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return keys.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

/** Tally of a categorical field, in the order of `keys`. */
export function tally<K extends string>(
  values: K[],
  keys: readonly K[],
): { key: K; count: number }[] {
  return keys.map((key) => ({ key, count: values.filter((v) => v === key).length }));
}

export type Point = { t: number; v: number | null; v2?: number | null | undefined };

/**
 * Sorts readings by time and inserts a null break between readings more than
 * `gapDays` apart so a line chart shows a gap instead of implying continuity.
 */
export function withGaps(points: Point[], gapDays = 3): Point[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Point[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev && p.t - prev.t > gapDays * DAY)
      out.push({ t: prev.t + (p.t - prev.t) / 2, v: null, v2: null });
    out.push(p);
  }
  return out;
}

/** Minimum number of readings before a trend line is drawn. */
export const MIN_TREND_POINTS = 3;
