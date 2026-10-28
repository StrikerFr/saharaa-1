// Daily routine: pure helpers shared by UI, server functions and tests.
// Mirrors the CHECKs in supabase/phase8_routine.sql.

export const ROUTINE_CATEGORIES = {
  medication: { label: "Medicine", emoji: "💊" },
  meal: { label: "Meal", emoji: "🍽️" },
  sleep: { label: "Sleep", emoji: "🛏️" },
  exercise: { label: "Exercise / walk", emoji: "🚶" },
  hydration: { label: "Water", emoji: "💧" },
  vitals: { label: "Vitals check", emoji: "🩺" },
  hygiene: { label: "Hygiene", emoji: "🧼" },
  other: { label: "Other", emoji: "📌" },
} as const;
export type RoutineCategory = keyof typeof ROUTINE_CATEGORIES;

export const ROUTINE_STATUSES = ["done", "missed", "skipped", "pending"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export const ROUTINE_SOURCES = [
  "coordinator",
  "ai_assist",
  "senior",
  "family",
  "care_worker",
  "whatsapp",
  "call",
] as const;
export type RoutineSource = (typeof ROUTINE_SOURCES)[number];
export const SOURCE_LABEL: Record<RoutineSource, string> = {
  coordinator: "Coordinator",
  ai_assist: "Coordinator (AI-assisted)",
  senior: "Senior",
  family: "Family",
  care_worker: "Care worker",
  whatsapp: "WhatsApp",
  call: "Phone call",
};

export type RoutineItem = {
  id: string;
  senior_id: string;
  category: RoutineCategory;
  title: string;
  details: string | null;
  scheduled_time: string; // "HH:MM[:SS]"
  days_of_week: number[]; // 1=Mon..7=Sun
  active: boolean;
};

export type RoutineLog = {
  id: string;
  item_id: string;
  local_date: string; // YYYY-MM-DD
  status: RoutineStatus;
  done_at: string | null;
  note: string | null;
  source: RoutineSource;
  created_at: string;
};

/** YYYY-MM-DD for an instant in a time zone. */
export function localDateIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Minutes since local midnight for an instant in a time zone. */
export function localMinutesIn(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** ISO weekday (1=Mon..7=Sun) of a YYYY-MM-DD calendar date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatTime(t: string): string {
  return t.slice(0, 5);
}

export function isDueOn(item: Pick<RoutineItem, "active" | "days_of_week">, date: string): boolean {
  return item.active && item.days_of_week.includes(isoWeekday(date));
}

/** Newest log per item for one day. Logs are append-only; newest wins. */
export function latestByItem(logs: RoutineLog[], date: string): Map<string, RoutineLog> {
  const out = new Map<string, RoutineLog>();
  for (const l of logs) {
    if (l.local_date !== date) continue;
    const cur = out.get(l.item_id);
    if (!cur || l.created_at > cur.created_at) out.set(l.item_id, l);
  }
  return out;
}

export type DayEntry = {
  item: RoutineItem;
  log: RoutineLog | null;
  status: RoutineStatus;
  /** Scheduled time has passed (by `graceMin`) and nothing has been recorded. */
  overdue: boolean;
};

export const OVERDUE_GRACE_MIN = 60;

/**
 * The checklist for one day. `nowMinutes` is the local time when `date` is
 * today, `null` for past days (everything unrecorded is overdue) and
 * `-1` for future days (nothing is overdue).
 */
export function buildDay(
  items: RoutineItem[],
  logs: RoutineLog[],
  date: string,
  nowMinutes: number | null,
): DayEntry[] {
  const latest = latestByItem(logs, date);
  return items
    .filter((i) => isDueOn(i, date))
    .sort((a, b) => timeToMinutes(a.scheduled_time) - timeToMinutes(b.scheduled_time))
    .map((item) => {
      const log = latest.get(item.id) ?? null;
      const status: RoutineStatus = log?.status ?? "pending";
      const overdue =
        status === "pending" &&
        (nowMinutes === null ||
          (nowMinutes >= 0 && nowMinutes > timeToMinutes(item.scheduled_time) + OVERDUE_GRACE_MIN));
      return { item, log, status, overdue };
    });
}

export type DaySummary = {
  total: number;
  done: number;
  missed: number;
  skipped: number;
  pending: number;
  overdue: number;
  medsTotal: number;
  medsDone: number;
};

export function summarizeDay(entries: DayEntry[]): DaySummary {
  const s: DaySummary = {
    total: entries.length,
    done: 0,
    missed: 0,
    skipped: 0,
    pending: 0,
    overdue: 0,
    medsTotal: 0,
    medsDone: 0,
  };
  for (const e of entries) {
    s[e.status]++;
    if (e.overdue) s.overdue++;
    if (e.item.category === "medication") {
      s.medsTotal++;
      if (e.status === "done") s.medsDone++;
    }
  }
  return s;
}

/** Per-day counts for a chart. Unrecorded past items count as "not recorded", never as missed. */
export function adherenceSeries(
  items: RoutineItem[],
  logs: RoutineLog[],
  endDate: string,
  days: number,
): { date: string; done: number; missed: number; notRecorded: number; total: number }[] {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const s = summarizeDay(buildDay(items, logs, date, -1));
    out.push({
      date,
      done: s.done,
      missed: s.missed + s.skipped,
      notRecorded: s.pending,
      total: s.total,
    });
  }
  return out;
}

/** UTC ISO instant for a local date + "HH:MM" in a time zone. */
export function zonedTimeToIso(date: string, hhmm: string, timeZone: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const asLocal = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(guess)
      .replace(", ", "T") + "Z",
  );
  return new Date(guess.getTime() - (asLocal.getTime() - guess.getTime())).toISOString();
}
