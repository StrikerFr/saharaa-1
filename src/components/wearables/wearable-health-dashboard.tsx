import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  applyLiveMetricDrift,
  detectReadingAnomalies,
  generate24HourMockTelemetry,
  type AlertStatus,
  type HourlyHealthReport,
  type WearableAlert,
  type WearableDevice,
  type WearableReading,
} from "@/lib/wearables";
import { AnomalyAlertsPanel } from "./anomaly-alerts-panel";
import { HealthAnalyticsCharts } from "./health-analytics-charts";
import { HealthMetricsGrid } from "./health-metrics-grid";
import { HourlyTimeline } from "./hourly-timeline";
import { JsonImportModal } from "./json-import-modal";
import { LiveControlsBar } from "./live-controls-bar";
import { WearableDeviceCard } from "./wearable-device-card";

interface WearableHealthDashboardProps {
  seniorId: string;
  seniorName?: string;
  timeZone?: string;
}

export function WearableHealthDashboard({
  seniorId,
  seniorName = "Senior",
  timeZone = "Asia/Kolkata",
}: WearableHealthDashboardProps) {
  // Generate initial 24h baseline
  const initialDataRef = useRef(generate24HourMockTelemetry(seniorName));
  const initial = initialDataRef.current;

  const [device, setDevice] = useState<WearableDevice>({
    ...initial.device,
    seniorId,
    deviceName: `${seniorName}'s Smart Watch Legacy`,
  });

  const [readings, setReadings] = useState<WearableReading[]>(initial.readings);
  const [currentReading, setCurrentReading] = useState<WearableReading>(
    initial.readings[initial.readings.length - 1] ?? initial.readings[0]!
  );
  const [previousReading, setPreviousReading] = useState<WearableReading | null>(
    initial.readings[initial.readings.length - 2] ?? null
  );
  const [hourlyReports, setHourlyReports] = useState<HourlyHealthReport[]>(initial.hourlyReports);
  const [alerts, setAlerts] = useState<WearableAlert[]>(initial.initialAlerts);

  // Live stream state
  const [isLive, setIsLive] = useState(true);
  const [intervalMs, setIntervalMs] = useState(5000); // 5 sec default
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Live updating timer
  useEffect(() => {
    if (!isLive) return;

    const timer = setInterval(() => {
      setReadings((prevReadings) => {
        const latest = prevReadings[prevReadings.length - 1] ?? currentReading;
        const drifted = applyLiveMetricDrift(latest);

        // Check for anomalies on new packet
        const newAnomalies = detectReadingAnomalies(drifted, latest);
        if (newAnomalies.length > 0 && newAnomalies[0]) {
          const first = newAnomalies[0];
          const generatedAlert: WearableAlert = {
            id: `alert-live-${Date.now()}`,
            seniorId,
            ...first,
          };

          setAlerts((prevAlerts) => [generatedAlert, ...prevAlerts]);
        }

        setPreviousReading(latest);
        setCurrentReading(drifted);
        setLastUpdated(new Date());

        // Keep buffer of last 30 readings
        const updated = [...prevReadings.slice(-29), drifted];
        return updated;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isLive, intervalMs, seniorId, currentReading]);

  // Sync now action
  const handleSyncNow = () => {
    setIsSyncing(true);
    setTimeout(() => {
      const drifted = applyLiveMetricDrift(currentReading);
      setCurrentReading(drifted);
      setLastUpdated(new Date());
      setDevice((prev) => ({
        ...prev,
        lastSyncAt: new Date().toISOString(),
      }));
      setIsSyncing(false);
      toast.success("Fire-Boltt Legacy synchronized. Biometrics updated.");
    }, 1200);
  };

  // Triage alert update
  const handleUpdateAlertStatus = async (
    alertId: string,
    status: AlertStatus,
    notes?: string
  ) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId
          ? {
              ...a,
              status,
              notes: notes !== undefined ? notes : a.notes,
              resolvedAt: status === "resolved" ? new Date().toISOString() : a.resolvedAt,
            }
          : a
      )
    );
    toast.success(`Care alert updated to "${status}".`);
  };

  // Import JSON success
  const handleImportSuccess = (importedReadings: WearableReading[]) => {
    if (!importedReadings.length) return;

    // Check anomalies across imported records
    const newAlerts: WearableAlert[] = [];
    importedReadings.forEach((r, idx) => {
      const prev = idx > 0 ? importedReadings[idx - 1] : null;
      const found = detectReadingAnomalies(r, prev);
      found.forEach((f, fi) => {
        newAlerts.push({
          id: `alert-import-${Date.now()}-${fi}`,
          seniorId,
          ...f,
        });
      });
    });

    setReadings((prev) => [...prev, ...importedReadings].slice(-50));
    const latest = importedReadings[importedReadings.length - 1];
    if (latest) {
      setPreviousReading(currentReading);
      setCurrentReading(latest);
    }
    if (newAlerts.length > 0) {
      setAlerts((prev) => [...newAlerts, ...prev]);
    }
    setLastUpdated(new Date());
    toast.success(`Imported ${importedReadings.length} biometrics packets from JSON file.`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Live Controls Toolbar */}
      <LiveControlsBar
        isLive={isLive}
        onToggleLive={() => setIsLive(!isLive)}
        intervalMs={intervalMs}
        onChangeInterval={setIntervalMs}
        lastUpdated={lastUpdated}
        onRefreshNow={handleSyncNow}
        onOpenImport={() => setShowImportModal(true)}
      />

      {/* 2. Fire-Boltt Legacy Wearable Hardware Showcase */}
      <WearableDeviceCard
        device={device}
        seniorName={seniorName}
        isSyncing={isSyncing}
        onSync={handleSyncNow}
      />

      {/* 3. 8 Health Metrics Dashboard */}
      <HealthMetricsGrid
        currentReading={currentReading}
        previousReading={previousReading}
        readingsHistory={readings}
        seniorName={seniorName}
      />

      {/* 4. Anomaly Detection & Care Alerts */}
      <AnomalyAlertsPanel
        alerts={alerts}
        seniorName={seniorName}
        onUpdateAlertStatus={handleUpdateAlertStatus}
      />

      {/* 5. Hourly Health Updates Timeline */}
      <HourlyTimeline reports={hourlyReports} seniorName={seniorName} />

      {/* 6. Health Trends & Analytics Interactive Charts */}
      <HealthAnalyticsCharts readings={readings} seniorName={seniorName} />

      {/* JSON Health Data Import Dialog */}
      <JsonImportModal
        open={showImportModal}
        onOpenChange={setShowImportModal}
        seniorId={seniorId}
        seniorName={seniorName}
        onImportSuccess={handleImportSuccess}
      />
    </div>
  );
}
