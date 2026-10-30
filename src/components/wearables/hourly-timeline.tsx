import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Flame,
  Footprints,
  Heart,
  Search,
  Sparkles,
  Stethoscope,
  Wind,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HourlyHealthReport } from "@/lib/wearables";

interface HourlyTimelineProps {
  reports: HourlyHealthReport[];
  seniorName: string;
}

type TimeframeFilter = "today" | "24h" | "7d" | "custom";

export function HourlyTimeline({ reports, seniorName }: HourlyTimelineProps) {
  const [filter, setFilter] = useState<TimeframeFilter>("today");
  const [expandedId, setExpandedId] = useState<string | null>(reports[0]?.id ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [customDate, setCustomDate] = useState<string>(
    new Date().toISOString().split("T")[0] ?? ""
  );

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${r.hourLabel} ${r.summary} ${r.unusualVariation || ""} ${r.stressCategory}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    if (filter === "today") {
      const today = new Date().toDateString();
      return new Date(r.timestamp).toDateString() === today;
    }
    if (filter === "custom") {
      return r.timestamp.startsWith(customDate);
    }
    // "24h" and "7d" include full available reports buffer
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="surface flex flex-col gap-5 rounded-2xl border border-border/80 bg-card p-5 shadow-xs sm:p-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Hourly Health Updates
            </h2>
            <Badge variant="secondary" className="font-mono text-xs font-normal">
              {filteredReports.length} reports
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chronological hourly biometrics and synthesized telemetry observations for {seniorName}.
          </p>
        </div>

        {/* Timeframe Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={filter === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("today")}
            className="h-8 text-xs font-medium"
          >
            Today
          </Button>
          <Button
            variant={filter === "24h" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("24h")}
            className="h-8 text-xs font-medium"
          >
            Last 24 Hours
          </Button>
          <Button
            variant={filter === "7d" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("7d")}
            className="h-8 text-xs font-medium"
          >
            Last 7 Days
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant={filter === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("custom")}
              className="h-8 text-xs font-medium"
            >
              <Calendar className="mr-1 size-3" />
              Custom
            </Button>
            {filter === "custom" && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
              />
            )}
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter hourly reports by keyword (e.g. 'walk', 'heart rate', 'elevated', 'rest')..."
          className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-4 text-xs shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Hourly Reports Chronological Feed */}
      {filteredReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Clock className="size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">No hourly reports found</p>
          <p className="text-xs">Try selecting a different timeframe filter or clearing the search.</p>
        </div>
      ) : (
        <div className="relative flex flex-col gap-3 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-0.5 before:bg-border/60">
          {filteredReports.map((report) => {
            const isExpanded = expandedId === report.id;
            const hasVariation = !!report.unusualVariation;

            return (
              <div
                key={report.id}
                className={`relative flex gap-3.5 rounded-xl border transition-all ${
                  hasVariation
                    ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                    : isExpanded
                    ? "border-primary/40 bg-muted/20"
                    : "border-border/60 bg-card hover:border-border"
                }`}
              >
                {/* Timeline node icon */}
                <div className="relative z-10 ml-3 mt-4 flex size-5 shrink-0 items-center justify-center rounded-full border border-background bg-card shadow-xs">
                  {hasVariation ? (
                    <AlertTriangle className="size-3 text-amber-500" />
                  ) : (
                    <span className="size-2 rounded-full bg-primary" />
                  )}
                </div>

                {/* Report Content Body */}
                <div className="flex flex-1 flex-col p-3.5 pl-0">
                  {/* Summary Bar */}
                  <div
                    onClick={() => toggleExpand(report.id)}
                    className="flex cursor-pointer flex-wrap items-center justify-between gap-2"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && toggleExpand(report.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold tracking-tight text-foreground">
                        {report.hourLabel}
                      </span>

                      {/* Vitals Pills */}
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                        <Heart className="size-3 text-rose-500" />
                        {report.heartRate} BPM
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                        <Wind className="size-3 text-cyan-500" />
                        {report.spo2}% SpO2
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                        <Stethoscope className="size-3 text-blue-500" />
                        {report.bpSystolic}/{report.bpDiastolic} mmHg
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                        <Footprints className="size-3 text-emerald-500" />
                        {report.steps} steps
                      </span>

                      {hasVariation && (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
                        >
                          {report.unusualVariation}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {isExpanded ? "Hide details" : "Expand"}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Primary Narrative Summary */}
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {report.summary}
                  </p>

                  {/* Expanded Breakdown */}
                  {isExpanded && (
                    <div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-xs sm:grid-cols-4">
                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Brain className="size-3 text-amber-500" />
                          Stress Level
                        </span>
                        <p className="mt-1 font-semibold text-foreground">
                          {report.stressScore}/100 ({report.stressCategory})
                        </p>
                      </div>

                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Activity className="size-3 text-emerald-500" />
                          Activity Intensity
                        </span>
                        <p className="mt-1 font-semibold capitalize text-foreground">
                          {report.activityLevel} session
                        </p>
                      </div>

                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Flame className="size-3 text-orange-500" />
                          Calorie Burn
                        </span>
                        <p className="mt-1 font-semibold text-foreground">
                          {report.calories} kcal
                        </p>
                      </div>

                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="size-3 text-blue-500" />
                          Timestamp
                        </span>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {new Date(report.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
