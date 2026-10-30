import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Filter,
  Heart,
  Info,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Wind,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AlertSeverity, AlertStatus, WearableAlert } from "@/lib/wearables";

interface AnomalyAlertsPanelProps {
  alerts: WearableAlert[];
  seniorName: string;
  onUpdateAlertStatus: (alertId: string, status: AlertStatus, notes?: string) => Promise<void>;
}

export function AnomalyAlertsPanel({
  alerts,
  seniorName,
  onUpdateAlertStatus,
}: AnomalyAlertsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedAlert, setSelectedAlert] = useState<WearableAlert | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const filteredAlerts = alerts.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    return true;
  });

  const handleStatusChange = async (newStatus: AlertStatus) => {
    if (!selectedAlert) return;
    setUpdating(true);
    try {
      await onUpdateAlertStatus(selectedAlert.id, newStatus, reviewNotes.trim() || undefined);
      setSelectedAlert(null);
      setReviewNotes("");
    } finally {
      setUpdating(false);
    }
  };

  const getSeverityBadge = (severity: AlertSeverity) => {
    switch (severity) {
      case "critical":
        return (
          <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400">
            <AlertCircle className="mr-1 size-3" /> Critical
          </Badge>
        );
      case "warning":
        return (
          <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mr-1 size-3" /> Warning
          </Badge>
        );
      case "attention":
        return (
          <Badge className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400">
            <Eye className="mr-1 size-3" /> Attention
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Info className="mr-1 size-3" /> Info
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: AlertStatus) => {
    switch (status) {
      case "new":
        return (
          <Badge variant="outline" className="border-rose-400/50 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            ● New
          </Badge>
        );
      case "acknowledged":
        return (
          <Badge variant="outline" className="border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Acknowledged
          </Badge>
        );
      case "under_review":
        return (
          <Badge variant="outline" className="border-blue-400/50 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            Under Review
          </Badge>
        );
      case "resolved":
        return (
          <Badge variant="outline" className="border-emerald-400/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            ✓ Resolved
          </Badge>
        );
    }
  };

  return (
    <div className="surface flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-xs sm:p-6">
      {/* Title & Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Anomaly Detection & Care Alerts
            </h2>
            <Badge variant="secondary" className="font-mono text-xs font-normal">
              {filteredAlerts.length}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Automated physiological guardrails monitoring biometrics from {seniorName}&apos;s smartwatch.
          </p>
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("all")}
            className="h-7 text-xs font-medium"
          >
            All
          </Button>
          <Button
            variant={statusFilter === "new" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("new")}
            className="h-7 text-xs font-medium"
          >
            New
          </Button>
          <Button
            variant={statusFilter === "acknowledged" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("acknowledged")}
            className="h-7 text-xs font-medium"
          >
            Acknowledged
          </Button>
          <Button
            variant={statusFilter === "resolved" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("resolved")}
            className="h-7 text-xs font-medium"
          >
            Resolved
          </Button>
        </div>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-8 text-center text-muted-foreground">
          <ShieldAlert className="size-8 text-emerald-500/60" />
          <p className="mt-2 text-sm font-semibold text-foreground">All Biometrics Within Normal Bounds</p>
          <p className="text-xs">No active anomalies detected across current telemetry window.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex flex-col justify-between gap-3 rounded-xl border p-4 transition-all sm:flex-row sm:items-center ${
                alert.status === "new"
                  ? "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50"
                  : alert.status === "resolved"
                  ? "border-border/60 bg-muted/20 opacity-80"
                  : "border-border/80 bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex flex-col gap-1.5 sm:max-w-xl">
                <div className="flex flex-wrap items-center gap-2">
                  {getSeverityBadge(alert.severity)}
                  {getStatusBadge(alert.status)}
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(alert.detectedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="font-semibold text-foreground">{alert.title}</span>
                </div>

                <p className="text-xs text-muted-foreground">{alert.reason}</p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-semibold text-foreground">
                    Reading: <span className="font-mono text-primary">{alert.currentValue}</span>
                  </span>
                  {alert.previousValue && (
                    <span className="text-muted-foreground">
                      Baseline: <span className="font-mono">{alert.previousValue}</span>
                    </span>
                  )}
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Action: {alert.recommendation}
                  </span>
                </div>

                {alert.notes && (
                  <p className="text-[11px] italic text-muted-foreground">
                    Note: &ldquo;{alert.notes}&rdquo;
                  </p>
                )}
              </div>

              {/* Triage Action Button */}
              <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedAlert(alert);
                    setReviewNotes(alert.notes || "");
                  }}
                  className="text-xs"
                >
                  Manage / Triage
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Triage & Management Dialog */}
      {selectedAlert && (
        <Dialog open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-primary" />
                <DialogTitle className="text-lg font-bold">
                  Care Coordinator Triage: {selectedAlert.title}
                </DialogTitle>
              </div>
              <DialogDescription>
                Record your clinical review, verify senior status, and transition alert lifecycle.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-3 text-sm">
              <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Observed Value:</span>
                    <p className="font-mono font-bold text-foreground">{selectedAlert.currentValue}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Severity:</span>
                    <p className="font-semibold capitalize text-foreground">{selectedAlert.severity}</p>
                  </div>
                </div>
                <div className="mt-2.5">
                  <span className="text-muted-foreground">Clinical Guidance:</span>
                  <p className="mt-0.5 text-foreground">{selectedAlert.recommendation}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  Coordinator Action Notes / Observations
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="e.g. Spoke to senior, resting comfortably, had glass of water. Vitals verified with cuff: 122/80."
                  className="h-20 w-full rounded-md border border-input bg-background p-2.5 text-xs shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                <strong>Attribution Notice:</strong> Actions are recorded in the audit log under your coordinator account. Smartwatch readings are never treated as formal diagnoses without human verification.
              </div>
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedAlert(null)}
              >
                Cancel
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                {selectedAlert.status !== "acknowledged" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updating}
                    onClick={() => handleStatusChange("acknowledged")}
                    className="text-xs"
                  >
                    Mark Acknowledged
                  </Button>
                )}
                {selectedAlert.status !== "under_review" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updating}
                    onClick={() => handleStatusChange("under_review")}
                    className="text-xs"
                  >
                    Start Review
                  </Button>
                )}
                {selectedAlert.status !== "resolved" && (
                  <Button
                    size="sm"
                    disabled={updating}
                    onClick={() => handleStatusChange("resolved")}
                    className="gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="size-3.5" /> Resolve Alert
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
