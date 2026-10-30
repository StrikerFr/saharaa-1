import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Brain,
  Calendar,
  Flame,
  Footprints,
  Heart,
  LineChart as ChartIcon,
  Moon,
  Stethoscope,
  Wind,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WearableReading } from "@/lib/wearables";

interface HealthAnalyticsChartsProps {
  readings: WearableReading[];
  seniorName: string;
}

type MetricTab =
  | "heart_rate"
  | "spo2"
  | "blood_pressure"
  | "stress"
  | "sleep"
  | "steps"
  | "calories";

export function HealthAnalyticsCharts({
  readings,
  seniorName,
}: HealthAnalyticsChartsProps) {
  const [activeTab, setActiveTab] = useState<MetricTab>("heart_rate");
  const [showValuesTable, setShowValuesTable] = useState(false);

  // Format data for Recharts
  const chartData = readings.map((r) => {
    const d = new Date(r.timestamp);
    const timeLabel = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return {
      time: timeLabel,
      iso: r.timestamp,
      heartRate: r.heartRate,
      spo2: r.spo2,
      stress: r.stressScore,
      bpSys: r.bpSystolic,
      bpDia: r.bpDiastolic,
      steps: r.steps,
      calories: r.calories,
      distance: r.distanceKm,
      sleepDeep: r.sleepDeepMinutes || 0,
      sleepLight: r.sleepLightMinutes || 0,
      sleepRem: r.sleepRemMinutes || 0,
    };
  });

  const axisStyle = { fontSize: 11, fill: "var(--color-muted-foreground)" };
  const tooltipStyle = {
    backgroundColor: "var(--color-card)",
    borderColor: "var(--color-border)",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    fontSize: "12px",
    color: "var(--color-foreground)",
  };

  return (
    <div className="surface flex flex-col gap-5 rounded-2xl border border-border/80 bg-card p-5 shadow-xs sm:p-6">
      {/* Header & Tabs */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Health Trends & Analytics
            </h2>
            <Badge variant="outline" className="text-xs font-normal">
              24-Hour Continuous Telemetry
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Multi-metric physiological wave data and diurnal patterns for {seniorName}.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="overflow-x-auto">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as MetricTab)}
            className="w-full sm:w-auto"
          >
            <TabsList className="h-9 gap-1 bg-muted/60 p-1">
              <TabsTrigger value="heart_rate" className="h-7 px-2.5 text-xs">
                <Heart className="mr-1 size-3 text-rose-500" /> Heart Rate
              </TabsTrigger>
              <TabsTrigger value="spo2" className="h-7 px-2.5 text-xs">
                <Wind className="mr-1 size-3 text-cyan-500" /> SpO2
              </TabsTrigger>
              <TabsTrigger value="blood_pressure" className="h-7 px-2.5 text-xs">
                <Stethoscope className="mr-1 size-3 text-blue-500" /> Blood Pressure
              </TabsTrigger>
              <TabsTrigger value="stress" className="h-7 px-2.5 text-xs">
                <Brain className="mr-1 size-3 text-amber-500" /> Stress
              </TabsTrigger>
              <TabsTrigger value="steps" className="h-7 px-2.5 text-xs">
                <Footprints className="mr-1 size-3 text-emerald-500" /> Steps
              </TabsTrigger>
              <TabsTrigger value="sleep" className="h-7 px-2.5 text-xs">
                <Moon className="mr-1 size-3 text-indigo-500" /> Sleep
              </TabsTrigger>
              <TabsTrigger value="calories" className="h-7 px-2.5 text-xs">
                <Flame className="mr-1 size-3 text-orange-500" /> Calories
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main Interactive Chart Display */}
      <div className="min-h-[300px] w-full">
        {activeTab === "heart_rate" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Target Normal Zone: 60 - 100 BPM</span>
              <span className="font-mono">Current: {chartData[chartData.length - 1]?.heartRate} BPM</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis domain={[50, 120]} tick={axisStyle} stroke="var(--color-border)" unit=" bpm" />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: number) => [`${val} BPM`, "Heart Rate"]}
                    labelFormatter={(label) => `Time: ${label}`}
                  />
                  <ReferenceLine y={100} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Elevated (100)", fill: "#f59e0b", fontSize: 10 }} />
                  <ReferenceLine y={60} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "Resting (60)", fill: "#3b82f6", fontSize: 10 }} />
                  <Area type="monotone" dataKey="heartRate" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#hrGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Optical photoplethysmography (PPG) pulse curve across 24 hours. Shaded reference bounds demarcate standard resting baseline.
            </p>
          </div>
        )}

        {activeTab === "spo2" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Optimal Blood Oxygen: &ge; 95%</span>
              <span className="font-mono">Current: {chartData[chartData.length - 1]?.spo2}%</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis domain={[90, 100]} tick={axisStyle} stroke="var(--color-border)" unit="%" />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: number) => [`${val}%`, "SpO2 Saturation"]}
                  />
                  <ReferenceLine y={95} stroke="#10b981" strokeDasharray="4 4" label={{ value: "Target (95%)", fill: "#10b981", fontSize: 10 }} />
                  <ReferenceLine y={92} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Hypoxia Alert (92%)", fill: "#ef4444", fontSize: 10 }} />
                  <Line type="monotone" dataKey="spo2" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 2.5, fill: "#06b6d4" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Continuous peripheral capillary oxygen saturation. Stable 97-99% curve indicates healthy pulmonary ventilation.
            </p>
          </div>
        )}

        {activeTab === "blood_pressure" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Systolic (Red) / Diastolic (Blue)</span>
              <span className="font-mono">
                Current: {chartData[chartData.length - 1]?.bpSys}/{chartData[chartData.length - 1]?.bpDia} mmHg
              </span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis domain={[60, 160]} tick={axisStyle} stroke="var(--color-border)" unit=" mmHg" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                  <ReferenceLine y={130} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Stage 1 (130)", fill: "#f59e0b", fontSize: 10 }} />
                  <ReferenceLine y={85} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "Diastolic Target (85)", fill: "#3b82f6", fontSize: 10 }} />
                  <Line type="monotone" name="Systolic (mmHg)" dataKey="bpSys" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" name="Diastolic (mmHg)" dataKey="bpDia" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated blood pressure trends. Dual curve displays morning wake-up surge and evening relaxation.
            </p>
          </div>
        )}

        {activeTab === "stress" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>HRV Autonomic Nervous Stress (0 - 100)</span>
              <span className="font-mono">Score: {chartData[chartData.length - 1]?.stress}</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis domain={[0, 100]} tick={axisStyle} stroke="var(--color-border)" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val}/100`, "Stress Index"]} />
                  <ReferenceLine y={50} stroke="#10b981" strokeDasharray="3 3" label={{ value: "Normal (50)", fill: "#10b981", fontSize: 10 }} />
                  <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Elevated (75)", fill: "#ef4444", fontSize: 10 }} />
                  <Area type="monotone" dataKey="stress" stroke="#f59e0b" strokeWidth={2} fill="url(#stressGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Sympathetic vs parasympathetic balance calculated from beat-to-beat variability (RMSSD).
            </p>
          </div>
        )}

        {activeTab === "steps" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Cumulative Step Progression</span>
              <span className="font-mono">Total: {chartData[chartData.length - 1]?.steps.toLocaleString()} steps</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis tick={axisStyle} stroke="var(--color-border)" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val.toLocaleString()} steps`, "Steps Count"]} />
                  <Bar dataKey="steps" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Progression toward daily 6,000 steps mobility goal with ambulatory peaks during morning and afternoon strolls.
            </p>
          </div>
        )}

        {activeTab === "sleep" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Overnight Sleep Architecture (Minutes per phase)</span>
              <span className="font-mono">Total: 7h 24m restorative</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.slice(0, 12)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis tick={axisStyle} stroke="var(--color-border)" unit="m" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                  <Bar dataKey="sleepDeep" name="Deep Sleep (min)" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="sleepLight" name="Light Sleep (min)" stackId="a" fill="#6366f1" />
                  <Bar dataKey="sleepRem" name="REM Dream (min)" stackId="a" fill="#a855f7" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Sleep stages segmented across the nocturnal window. Robust deep sleep phase correlates with cognitive rejuvenation.
            </p>
          </div>
        )}

        {activeTab === "calories" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active & Basal Caloric Expenditure</span>
              <span className="font-mono">Current: {chartData[chartData.length - 1]?.calories} kcal</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.6} />
                  <XAxis dataKey="time" tick={axisStyle} stroke="var(--color-border)" />
                  <YAxis tick={axisStyle} stroke="var(--color-border)" unit=" kcal" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val} kcal`, "Burned"]} />
                  <Area type="monotone" dataKey="calories" stroke="#f97316" strokeWidth={2} fill="url(#calGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Cumulative energy expenditure integrating resting basal metabolic rate with physical exertion.
            </p>
          </div>
        )}
      </div>

      {/* Values Table Collapsible Accordion */}
      <div className="border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => setShowValuesTable(!showValuesTable)}
          className="text-xs font-semibold text-primary hover:underline focus:outline-none"
        >
          {showValuesTable ? "▲ Hide underlying data values" : "▼ Show underlying time-series table"}
        </button>

        {showValuesTable && (
          <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur-xs">
                <tr>
                  <th className="p-2.5 font-medium">Time</th>
                  <th className="p-2.5 font-medium">Heart Rate</th>
                  <th className="p-2.5 font-medium">SpO2</th>
                  <th className="p-2.5 font-medium">BP</th>
                  <th className="p-2.5 font-medium">Stress</th>
                  <th className="p-2.5 font-medium">Steps</th>
                  <th className="p-2.5 font-medium">Calories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chartData.map((d, i) => (
                  <tr key={i} className="hover:bg-muted/40">
                    <td className="p-2 font-mono text-muted-foreground">{d.time}</td>
                    <td className="p-2 font-semibold text-foreground">{d.heartRate} BPM</td>
                    <td className="p-2 text-foreground">{d.spo2}%</td>
                    <td className="p-2 text-foreground">{d.bpSys}/{d.bpDia}</td>
                    <td className="p-2 text-foreground">{d.stress}/100</td>
                    <td className="p-2 text-foreground">{d.steps.toLocaleString()}</td>
                    <td className="p-2 text-foreground">{d.calories} kcal</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
