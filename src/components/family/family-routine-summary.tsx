import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlarmClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Heart,
  ListChecks,
  Pill,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { MetricCard } from "@/components/shell/metric";
import { Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDays,
  adherenceSeries,
  buildDay,
  formatTime,
  localDateIn,
  localMinutesIn,
  ROUTINE_CATEGORIES,
  SOURCE_LABEL,
  summarizeDay,
  type DayEntry,
  type RoutineItem,
  type RoutineLog,
  type RoutineStatus,
} from "@/lib/routine";
import { getRoutine, logRoutine } from "@/lib/routine.functions";
import { cn } from "@/lib/utils";

interface FamilyRoutineSummaryProps {
  seniorId: string;
  seniorName: string;
  timeZone: string;
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function FamilyRoutineSummary({
  seniorId,
  seniorName,
  timeZone,
}: FamilyRoutineSummaryProps) {
  const qc = useQueryClient();
  const today = localDateIn(timeZone);
  const from = addDays(today, -6); // 7 days inclusive

  const fetchRoutineFn = useServerFn(getRoutine);
  const routineQuery = useQuery({
    queryKey: ["family-routine", seniorId, from, today],
    queryFn: () => fetchRoutineFn({ data: { seniorId, from, to: today } }),
  });

  const logFn = useServerFn(logRoutine);
  const markDoneMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const clientRequestId = crypto.randomUUID();
      const res = await logFn({
        data: {
          entries: [
            {
              itemId,
              date: today,
              status: "done",
              doneAt: new Date().toISOString(),
              note: "Completed with family assistance",
              source: "family",
              clientRequestId,
            },
          ],
        },
      });
      if (!res.ok) throw new Error(res.message);
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family-routine", seniorId] });
      qc.invalidateQueries({ queryKey: ["family-dashboard", seniorId] });
      toast.success("Routine item marked as done!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Could not log routine item.");
    },
  });

  if (routineQuery.isPending) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (routineQuery.isError || !routineQuery.data?.ok) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        <p>Daily routine tracking is currently not set up or unavailable for {seniorName}.</p>
      </div>
    );
  }

  const { items, logs } = routineQuery.data;
  const nowMin = localMinutesIn(timeZone);
  const todayEntries = buildDay(items, logs, today, nowMin);
  const todaySum = summarizeDay(todayEntries);
  const series = adherenceSeries(items, logs, today, 7);

  // Weekly aggregates
  const weeklyTotal = series.reduce((acc, d) => acc + d.total, 0);
  const weeklyDone = series.reduce((acc, d) => acc + d.done, 0);
  const weeklyMissed = series.reduce((acc, d) => acc + d.missed, 0);
  const weeklyScore = weeklyTotal > 0 ? Math.round((weeklyDone / weeklyTotal) * 100) : 100;

  const todayScore = todaySum.total > 0 ? Math.round((todaySum.done / todaySum.total) * 100) : 100;

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Summary Score Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Today's Routine Adherence"
          value={`${todaySum.done}/${todaySum.total}`}
          hint={`${todayScore}% completed today`}
          icon={ListChecks}
          emphasis={todaySum.overdue > 0}
        />
        <MetricCard
          label="Today's Medications"
          value={todaySum.medsTotal > 0 ? `${todaySum.medsDone}/${todaySum.medsTotal}` : "None"}
          hint={
            todaySum.medsTotal > 0
              ? todaySum.medsDone === todaySum.medsTotal
                ? "All doses taken on schedule"
                : `${todaySum.medsTotal - todaySum.medsDone} dose(s) remaining`
              : "No medications scheduled"
          }
          icon={Pill}
        />
        <MetricCard
          label="7-Day Routine Score"
          value={`${weeklyScore}%`}
          hint={weeklyScore >= 80 ? "Consistent daily routine" : "Assistance may be needed"}
          icon={TrendingUp}
        />
        <MetricCard
          label="Past Week Completed"
          value={`${weeklyDone}/${weeklyTotal}`}
          hint={weeklyMissed > 0 ? `${weeklyMissed} missed or skipped` : "Zero missed activities"}
          icon={CalendarDays}
        />
      </div>

      {/* 2. Past 7-Day Routine Progress Breakdown */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground">Past 7-Day Routine Score & Progress</h3>
            <p className="text-xs text-muted-foreground">
              Day-by-day care adherence over the past week for {seniorName}.
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Weekly Average: {weeklyScore}%
          </span>
        </div>

        {/* Daily progress visual cards */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-7">
          {series.map((day, idx) => {
            const isToday = day.date === today;
            const rate = day.total > 0 ? Math.round((day.done / day.total) * 100) : 100;
            const d = new Date(`${day.date}T00:00:00Z`);
            const dayName = WEEKDAY_NAMES[d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1];
            const dateNum = d.getUTCDate();

            return (
              <div
                key={day.date}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-3 text-center transition-all",
                  isToday
                    ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                    : "border-border bg-background"
                )}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {isToday ? "Today" : dayName}
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {dateNum}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-destructive"
                      )}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {day.done}/{day.total}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Today's Full Routine Schedule & Checklist */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Today&apos;s Care Schedule & Checklist</h3>
            <p className="text-xs text-muted-foreground">
              Scheduled medicines, meals, hydration and vitals checks for today ({timeZone}).
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-500" /> Done
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-amber-500" /> Overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-muted-foreground/40" /> Upcoming
            </span>
          </div>
        </div>

        {todayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 text-muted-foreground/40" />
            <p>No routine items scheduled for today.</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-background">
            {todayEntries.map((entry) => {
              const { item, log, status, overdue } = entry;
              const cat = ROUTINE_CATEGORIES[item.category];
              const isDone = status === "done";
              const isPending = status === "pending";

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                    isDone && "bg-muted/15"
                  )}
                >
                  <div className="flex items-start gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-base">
                      {cat.emoji}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{item.title}</span>
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          <Clock className="size-3" /> {formatTime(item.scheduled_time)}
                        </span>
                      </div>
                      {item.details && (
                        <p className="text-xs text-muted-foreground">{item.details}</p>
                      )}
                      {log?.note && (
                        <p className="mt-1 text-xs italic text-foreground/80">
                          &quot;{log.note}&quot;
                        </p>
                      )}
                      {log?.done_at && (
                        <span className="text-[11px] text-muted-foreground">
                          Confirmed at {new Date(log.done_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {log.source ? ` · Logged by ${SOURCE_LABEL[log.source] ?? log.source}` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 self-end sm:self-center">
                    {isDone ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3.5" /> Done
                      </span>
                    ) : overdue ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                        <AlarmClock className="size-3.5" /> Overdue
                      </span>
                    ) : status === "missed" || status === "skipped" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                        <XCircle className="size-3.5" /> {status === "missed" ? "Missed" : "Skipped"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                        <Clock className="size-3.5" /> Upcoming
                      </span>
                    )}

                    {isPending && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={markDoneMutation.isPending}
                        onClick={() => markDoneMutation.mutate(item.id)}
                        className="h-8 gap-1 text-xs"
                      >
                        <Check className="size-3.5 text-emerald-500" /> Mark Done
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
