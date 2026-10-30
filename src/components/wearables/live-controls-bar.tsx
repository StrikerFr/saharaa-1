import { useEffect, useState } from "react";
import {
  Clock,
  Download,
  FileUp,
  Pause,
  Play,
  Radio,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LiveControlsBarProps {
  isLive: boolean;
  onToggleLive: () => void;
  intervalMs: number;
  onChangeInterval: (intervalMs: number) => void;
  lastUpdated: Date;
  onRefreshNow: () => void;
  onOpenImport: () => void;
}

export function LiveControlsBar({
  isLive,
  onToggleLive,
  intervalMs,
  onChangeInterval,
  lastUpdated,
  onRefreshNow,
  onOpenImport,
}: LiveControlsBarProps) {
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Live ticking counter for "X seconds ago"
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      setSecondsAgo(diff);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  return (
    <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs sm:p-4">
      {/* Left: Live status & Last Update ticker */}
      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-all ${
            isLive
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
        >
          <span
            className={`size-2 rounded-full ${
              isLive ? "animate-ping bg-emerald-500" : "bg-amber-500"
            }`}
          />
          {isLive ? "Live Telemetry Active" : "Stream Paused"}
        </Badge>

        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Clock className="size-3.5 text-muted-foreground" />
          <span>
            Last packet:{" "}
            <strong className="font-mono text-foreground">
              {secondsAgo === 0 ? "Just now" : `${secondsAgo}s ago`}
            </strong>
          </span>
        </div>
      </div>

      {/* Right: Controls & Import button */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Interval Dropdown */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SlidersHorizontal className="size-3 text-muted-foreground" />
          <span className="hidden sm:inline">Interval:</span>
          <select
            value={intervalMs}
            onChange={(e) => onChangeInterval(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Select live stream refresh interval"
          >
            <option value={3000}>3 sec (High)</option>
            <option value={5000}>5 sec (Standard)</option>
            <option value={10000}>10 sec (Relaxed)</option>
            <option value={30000}>30 sec (Battery mode)</option>
          </select>
        </div>

        {/* Pause / Resume Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleLive}
          className="gap-1.5 text-xs font-medium"
        >
          {isLive ? (
            <>
              <Pause className="size-3.5 text-amber-500" />
              Pause
            </>
          ) : (
            <>
              <Play className="size-3.5 text-emerald-500" />
              Resume
            </>
          )}
        </Button>

        {/* Refresh Now Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshNow}
          className="gap-1.5 text-xs font-medium"
          title="Force telemetry poll"
        >
          <RefreshCw className="size-3.5 text-primary" />
          Refresh
        </Button>

        {/* Import JSON Health Data */}
        <Button
          size="sm"
          onClick={onOpenImport}
          className="gap-1.5 bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20"
        >
          <FileUp className="size-3.5" />
          Import Health Data
        </Button>
      </div>
    </div>
  );
}

