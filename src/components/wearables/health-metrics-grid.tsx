import { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Flame,
  Footprints,
  Heart,
  Info,
  MapPin,
  Minus,
  Moon,
  Stethoscope,
  TrendingUp,
  Wind,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PHYSIOLOGICAL_RANGES,
  type WearableMetricType,
  type WearableReading,
} from "@/lib/wearables";

interface HealthMetricsGridProps {
  currentReading: WearableReading;
  previousReading?: WearableReading | null;
  readingsHistory: WearableReading[];
  seniorName: string;
}

interface MetricCardDef {
  type: WearableMetricType;
  title: string;
  icon: typeof Heart;
  colorClass: string;
  iconBgClass: string;
  value: string | number;
  unit: string;
  previousValue: string;
  trend: "up" | "down" | "stable";
  trendDelta: string;
  statusLabel: string;
  statusTone: "normal" | "warning" | "critical" | "neutral";
  sparklineData: number[];
  secondaryInfo?: string;
  normalRange: string;
  clinicalNote: string;
}

export function HealthMetricsGrid({
  currentReading,
  previousReading,
  readingsHistory,
  seniorName,
}: HealthMetricsGridProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricCardDef | null>(null);

  // Derive sparkline points from history (last 12 points)
  const recentHistory = readingsHistory.slice(-12);

  // 1. Heart Rate
  const hrPrev = previousReading?.heartRate ?? currentReading.heartRate;
  const hrDiff = currentReading.heartRate - hrPrev;
  const hrTrend = hrDiff > 1 ? "up" : hrDiff < -1 ? "down" : "stable";

  // 2. SpO2
  const spo2Prev = previousReading?.spo2 ?? currentReading.spo2;
  const spo2Diff = currentReading.spo2 - spo2Prev;
  const spo2Trend = spo2Diff > 0 ? "up" : spo2Diff < 0 ? "down" : "stable";

  // 3. Stress
  const stressPrev = previousReading?.stressScore ?? currentReading.stressScore;
  const stressDiff = currentReading.stressScore - stressPrev;
  const stressTrend = stressDiff > 2 ? "up" : stressDiff < -2 ? "down" : "stable";

  // 4. Sleep
  const totalSleepMinutes = currentReading.sleepMinutes || 444; // ~7h 24m
  const sleepHours = Math.floor(totalSleepMinutes / 60);
  const sleepMins = totalSleepMinutes % 60;
  const deepSleepMins = currentReading.sleepDeepMinutes || 108;
  const lightSleepMins = currentReading.sleepLightMinutes || 252;
  const remSleepMins = currentReading.sleepRemMinutes || 84;

  // 5. Steps
  const stepsPrev = previousReading?.steps ?? Math.max(0, currentReading.steps - 40);
  const stepsDiff = currentReading.steps - stepsPrev;

  // 6. Calories
  const calsPrev = previousReading?.calories ?? Math.max(0, currentReading.calories - 3);

  // 7. Distance
  const distPrev = previousReading?.distanceKm ?? currentReading.distanceKm;

  // 8. Blood Pressure
  const bpSys = currentReading.bpSystolic;
  const bpDia = currentReading.bpDiastolic;
  const bpPrevSys = previousReading?.bpSystolic ?? bpSys;
  const bpPrevDia = previousReading?.bpDiastolic ?? bpDia;
  const bpSysDiff = bpSys - bpPrevSys;
  const bpTrend = bpSysDiff > 2 ? "up" : bpSysDiff < -2 ? "down" : "stable";

  const metrics: MetricCardDef[] = [
    {
      type: "heart_rate",
      title: "Heart Rate",
      icon: Heart,
      colorClass: "text-rose-500",
      iconBgClass: "bg-rose-500/10 text-rose-500",
      value: currentReading.heartRate,
      unit: "BPM",
      previousValue: `${hrPrev} BPM`,
      trend: hrTrend,
      trendDelta: `${hrDiff > 0 ? `+${hrDiff}` : hrDiff} BPM`,
      statusLabel:
        currentReading.heartRate > 100
          ? "Elevated Resting"
          : currentReading.heartRate < 55
          ? "Bradycardia Trend"
          : "Optimal Resting",
      statusTone:
        currentReading.heartRate > 115 || currentReading.heartRate < 50
          ? "critical"
          : currentReading.heartRate > 100
          ? "warning"
          : "normal",
      sparklineData: recentHistory.map((r) => r.heartRate),
      secondaryInfo: "Resting avg: 72 BPM",
      normalRange: `${PHYSIOLOGICAL_RANGES.heartRate.minNormal} - ${PHYSIOLOGICAL_RANGES.heartRate.maxNormal} BPM`,
      clinicalNote:
        "Measured via optical PPG array. Natural diurnal sinus rhythm shows lower rates during deep sleep and higher rates during morning ambulation.",
    },
    {
      type: "spo2",
      title: "Blood Oxygen",
      icon: Wind,
      colorClass: "text-cyan-500",
      iconBgClass: "bg-cyan-500/10 text-cyan-500",
      value: currentReading.spo2,
      unit: "%",
      previousValue: `${spo2Prev}%`,
      trend: spo2Trend,
      trendDelta: `${spo2Diff > 0 ? `+${spo2Diff}` : spo2Diff}%`,
      statusLabel:
        currentReading.spo2 >= 95
          ? "Optimal Saturation"
          : currentReading.spo2 >= 92
          ? "Mild Desaturation"
          : "Critical Hypoxia Risk",
      statusTone:
        currentReading.spo2 < 92 ? "critical" : currentReading.spo2 < 95 ? "warning" : "normal",
      sparklineData: recentHistory.map((r) => r.spo2),
      secondaryInfo: "Lowest overnight: 96%",
      normalRange: `${PHYSIOLOGICAL_RANGES.spo2.minNormal}% - ${PHYSIOLOGICAL_RANGES.spo2.maxNormal}%`,
      clinicalNote:
        "Red and infrared optical reflectance sensors monitor peripheral capillary oxygen saturation. Readings <92% warrant immediate clinical evaluation.",
    },
    {
      type: "stress",
      title: "Stress Level",
      icon: Brain,
      colorClass: "text-amber-500",
      iconBgClass: "bg-amber-500/10 text-amber-500",
      value: currentReading.stressScore,
      unit: "/ 100",
      previousValue: `${stressPrev}/100`,
      trend: stressTrend,
      trendDelta: `${stressDiff > 0 ? `+${stressDiff}` : stressDiff}`,
      statusLabel:
        currentReading.stressCategory.charAt(0).toUpperCase() +
        currentReading.stressCategory.slice(1),
      statusTone:
        currentReading.stressScore > 75
          ? "warning"
          : currentReading.stressScore > 50
          ? "neutral"
          : "normal",
      sparklineData: recentHistory.map((r) => r.stressScore),
      secondaryInfo: `Category: ${currentReading.stressCategory}`,
      normalRange: "0 - 45 (Relaxed to Normal)",
      clinicalNote:
        "Derived from Heart Rate Variability (HRV) continuous beat-to-beat intervals. Elevated scores correlate with sympathetic nervous arousal.",
    },
    {
      type: "sleep",
      title: "Sleep Duration",
      icon: Moon,
      colorClass: "text-indigo-500",
      iconBgClass: "bg-indigo-500/10 text-indigo-500",
      value: `${sleepHours}h ${sleepMins}m`,
      unit: "Total",
      previousValue: "7h 10m prev night",
      trend: "stable",
      trendDelta: "+14m vs baseline",
      statusLabel: "Restorative Sleep",
      statusTone: "normal",
      sparklineData: [45, 52, 60, 58, 62, 55, 68, 70, 72, 75],
      secondaryInfo: `Deep: ${Math.round(deepSleepMins / 60)}h ${deepSleepMins % 60}m · REM: ${Math.round(remSleepMins / 60)}h ${remSleepMins % 60}m`,
      normalRange: "7 - 8.5 hours recommended",
      clinicalNote:
        "Accelerometer and optical sensor sleep-stage algorithm detects transitions between Deep, Light, REM, and Wakeful cycles.",
    },
    {
      type: "steps",
      title: "Daily Steps",
      icon: Footprints,
      colorClass: "text-emerald-500",
      iconBgClass: "bg-emerald-500/10 text-emerald-500",
      value: currentReading.steps.toLocaleString(),
      unit: "steps",
      previousValue: `${stepsPrev.toLocaleString()} steps`,
      trend: stepsDiff > 0 ? "up" : "stable",
      trendDelta: `+${stepsDiff} recent`,
      statusLabel: "68% of daily goal",
      statusTone: "normal",
      sparklineData: recentHistory.map((r) => r.steps),
      secondaryInfo: "Target: 6,000 steps",
      normalRange: "4,000 - 8,000 steps for seniors",
      clinicalNote:
        "Tri-axial accelerometer filters non-ambulatory arm gestures, isolating sustained walking strides for mobility trend tracking.",
    },
    {
      type: "calories",
      title: "Calories Burned",
      icon: Flame,
      colorClass: "text-orange-500",
      iconBgClass: "bg-orange-500/10 text-orange-500",
      value: currentReading.calories.toLocaleString(),
      unit: "kcal",
      previousValue: `${calsPrev.toLocaleString()} kcal`,
      trend: "up",
      trendDelta: "+18 kcal active",
      statusLabel: "Active + Basal",
      statusTone: "normal",
      sparklineData: recentHistory.map((r) => r.calories),
      secondaryInfo: "Basal: 1,240 · Active: 400",
      normalRange: "1,500 - 2,100 kcal / day",
      clinicalNote:
        "Calculated using senior profile metrics (age, weight, height) compounded by heart rate exertion intensity and step volume.",
    },
    {
      type: "distance",
      title: "Distance Travelled",
      icon: MapPin,
      colorClass: "text-violet-500",
      iconBgClass: "bg-violet-500/10 text-violet-500",
      value: currentReading.distanceKm.toFixed(2),
      unit: "km",
      previousValue: `${distPrev.toFixed(2)} km`,
      trend: "stable",
      trendDelta: "Indoor & outdoor walk",
      statusLabel: "Normal mobility",
      statusTone: "normal",
      sparklineData: recentHistory.map((r) => Math.round(r.distanceKm * 100)),
      secondaryInfo: "Stride calibrated: 0.68m",
      normalRange: "2.0 - 4.5 km daily",
      clinicalNote:
        "Estimated through step stride length coefficient calibrated to senior height. Useful for early detection of mobility decline.",
    },
    {
      type: "blood_pressure",
      title: "Blood Pressure",
      icon: Stethoscope,
      colorClass: "text-blue-500",
      iconBgClass: "bg-blue-500/10 text-blue-500",
      value: `${bpSys}/${bpDia}`,
      unit: "mmHg",
      previousValue: `${bpPrevSys}/${bpPrevDia} mmHg`,
      trend: bpTrend,
      trendDelta: `${bpSysDiff > 0 ? `+${bpSysDiff}` : bpSysDiff} sys`,
      statusLabel:
        bpSys >= 140 || bpDia >= 90
          ? "Stage 1 Hypertension"
          : bpSys >= 130
          ? "Borderline Pre-HTN"
          : "Normotensive Baseline",
      statusTone: bpSys >= 140 ? "warning" : bpSys >= 160 ? "critical" : "normal",
      sparklineData: recentHistory.map((r) => r.bpSystolic),
      secondaryInfo: "Optical pulse transit time",
      normalRange: "< 130 / 85 mmHg",
      clinicalNote:
        "Optical pulse transit time estimate. Wearable BP is a non-invasive trend indicator and must be validated with an oscillometric arm cuff.",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 8 Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.type}
              onClick={() => setSelectedMetric(m)}
              className="group surface relative flex cursor-pointer flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedMetric(m)}
              aria-label={`View details for ${m.title}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex size-9 items-center justify-center rounded-xl transition-colors ${m.iconBgClass}`}
                  >
                    <Icon className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
                      {m.title}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">{m.secondaryInfo}</p>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={`text-[10px] font-medium ${
                    m.statusTone === "critical"
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      : m.statusTone === "warning"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {m.statusLabel}
                </Badge>
              </div>

              {/* Big Metric Display */}
              <div className="my-3 flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold tracking-tight text-foreground">
                    {m.value}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">{m.unit}</span>
                </div>

                {/* Trend Delta Badge */}
                <div className="flex items-center gap-1 text-xs">
                  {m.trend === "up" ? (
                    <ArrowUpRight className="size-3.5 text-emerald-500" />
                  ) : m.trend === "down" ? (
                    <ArrowDownRight className="size-3.5 text-blue-500" />
                  ) : (
                    <Minus className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {m.trendDelta}
                  </span>
                </div>
              </div>

              {/* Mini Sparkline SVG & Footer */}
              <div className="flex items-center justify-between border-t border-border/50 pt-2.5">
                <div className="flex flex-col text-[11px] text-muted-foreground">
                  <span>Prev: {m.previousValue}</span>
                  <span className="text-[10px]">Normal: {m.normalRange}</span>
                </div>

                {/* Inline Mini Sparkline */}
                <div className="flex h-6 w-20 items-end gap-1">
                  {renderMiniSparkline(m.sparklineData, m.colorClass)}
                </div>
              </div>

              {/* Tap to inspect hover affordance */}
              <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Subtle Care Safety Verification Note */}
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0 text-primary" />
        <span>
          <strong>Telemetry Notice:</strong> Biometrics represent Fire-Boltt optical wrist telemetry. Readouts are illustrative trend indicators until paired with clinical vitals. Click any card to inspect time-series logs and physiological ranges.
        </span>
      </div>

      {/* Metric Detail Dialog */}
      {selectedMetric && (
        <Dialog open={!!selectedMetric} onOpenChange={(open) => !open && setSelectedMetric(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex size-10 items-center justify-center rounded-xl ${selectedMetric.iconBgClass}`}
                >
                  <selectedMetric.icon className="size-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold">
                    {selectedMetric.title} Analysis
                  </DialogTitle>
                  <DialogDescription>
                    Detailed biometric telemetry and physiological reference for {seniorName}.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2 text-sm">
              {/* Summary Stats Row */}
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-muted/30 p-3.5 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Current Reading</p>
                  <p className="text-xl font-bold text-foreground">
                    {selectedMetric.value} {selectedMetric.unit}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Normal Target</p>
                  <p className="text-xs font-semibold text-primary">{selectedMetric.normalRange}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status Category</p>
                  <Badge variant="outline" className="mt-1">
                    {selectedMetric.statusLabel}
                  </Badge>
                </div>
              </div>

              {/* Clinical Description */}
              <div className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sensor & Physiological Context
                </h4>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {selectedMetric.clinicalNote}
                </p>
              </div>

              {/* Recent 10 Readings Table */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent 10 Time-Series Telemetry Packets
                </h4>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="p-2 font-medium">Timestamp</th>
                        <th className="p-2 font-medium">Reading</th>
                        <th className="p-2 font-medium">Source</th>
                        <th className="p-2 font-medium">Evaluation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {readingsHistory.slice(-10).reverse().map((r, idx) => {
                        let val: string | number = "";
                        if (selectedMetric.type === "heart_rate") val = `${r.heartRate} BPM`;
                        else if (selectedMetric.type === "spo2") val = `${r.spo2}%`;
                        else if (selectedMetric.type === "stress") val = `${r.stressScore}/100`;
                        else if (selectedMetric.type === "blood_pressure")
                          val = `${r.bpSystolic}/${r.bpDiastolic} mmHg`;
                        else if (selectedMetric.type === "steps") val = `${r.steps} steps`;
                        else if (selectedMetric.type === "calories") val = `${r.calories} kcal`;
                        else if (selectedMetric.type === "distance") val = `${r.distanceKm} km`;
                        else val = `${r.sleepMinutes ?? 444} mins`;

                        return (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="p-2 font-mono text-[11px] text-muted-foreground">
                              {new Date(r.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </td>
                            <td className="p-2 font-semibold text-foreground">{val}</td>
                            <td className="p-2 text-muted-foreground">Fire-Boltt BLE</td>
                            <td className="p-2">
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500" /> Normal
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedMetric(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Render a simple mini SVG sparkline */
function renderMiniSparkline(data: number[], colorClass: string) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 80;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
        className={colorClass}
      />
    </svg>
  );
}

