import { useState } from "react";
import {
  Activity,
  Battery,
  BatteryCharging,
  Bluetooth,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Watch,
  Wifi,
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
import { Progress } from "@/components/ui/progress";
import { FIRE_BOLTT_LEGACY_INFO, type WearableDevice } from "@/lib/wearables";

interface WearableDeviceCardProps {
  device: WearableDevice;
  seniorName: string;
  isSyncing: boolean;
  onSync: () => void;
}

export function WearableDeviceCard({
  device,
  seniorName,
  isSyncing,
  onSync,
}: WearableDeviceCardProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [deviceConnected, setDeviceConnected] = useState(device.connectionStatus === "connected");

  const images = FIRE_BOLTT_LEGACY_INFO.images;
  const currentImage = images[activeImageIndex] || images[0];

  return (
    <>
      <div className="surface overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: Product Image & Gallery */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start lg:items-center">
            <div className="group relative flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted/40 p-2 shadow-inner sm:size-36">
              <img
                src={currentImage}
                alt="Fire-Boltt Legacy Smartwatch"
                className="h-full w-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute bottom-1 right-1 flex gap-1">
                {images.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    className={`size-2 rounded-full transition-all ${
                      idx === activeImageIndex ? "w-4 bg-primary" : "bg-muted-foreground/40 hover:bg-muted-foreground"
                    }`}
                    aria-label={`View watch image ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Device Identity & Specs */}
            <div className="flex flex-col text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                  Wearable Telemetry
                </span>
                <Badge
                  variant="outline"
                  className={
                    deviceConnected
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  }
                >
                  <span
                    className={`mr-1.5 size-2 rounded-full ${
                      deviceConnected ? "animate-pulse bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {deviceConnected ? "Connected (BLE 5.2)" : "Standby"}
                </Badge>
                <Badge variant="secondary" className="text-xs font-normal">
                  Fire-Boltt Official
                </Badge>
              </div>

              <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Fire-Boltt Legacy
              </h2>
              <p className="text-sm font-medium text-muted-foreground">
                Paired with: <span className="font-semibold text-foreground">{seniorName}&apos;s Smart Watch Legacy</span>
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:justify-start">
                <span className="inline-flex items-center gap-1">
                  <Bluetooth className="size-3.5 text-blue-500" />
                  MAC: {device.macAddress}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Activity className="size-3.5 text-emerald-500" />
                  PPG & SpO2 Active
                </span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-primary" />
                  Firmware: {device.firmwareVersion}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Battery, Last Sync & Action Controls */}
          <div className="flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
            {/* Battery & Sync Stats */}
            <div className="flex items-center gap-6 text-sm">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Battery className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{device.batteryLevel}% Battery</span>
                </div>
                <div className="mt-1 w-24">
                  <Progress value={device.batteryLevel} className="h-1.5 bg-muted" />
                </div>
                <span className="mt-1 text-[11px] text-muted-foreground">~4 days standby</span>
              </div>

              <div className="flex flex-col border-l border-border/60 pl-6">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span>Last Sync</span>
                </div>
                <span className="mt-0.5 text-xs font-semibold text-primary">Just now</span>
                <span className="text-[11px] text-muted-foreground">Continuous BLE 10s</span>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfigModal(true)}
                className="gap-1.5 text-xs font-medium"
              >
                <Settings2 className="size-3.5" />
                Connect Device
              </Button>

              <Button
                size="sm"
                onClick={onSync}
                disabled={isSyncing}
                className="gap-1.5 bg-primary text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </div>
        </div>

        {/* Informative Sub-bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Info className="size-3.5 shrink-0 text-primary" />
            <span>
              Showcased wearable: <strong>Fire-Boltt Legacy</strong> (1.43&quot; AMOLED, Stainless Steel dial, continuous biometrics).
            </span>
          </div>
          <a
            href="https://www.fireboltt.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Fire-Boltt Official <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      {/* Device Configuration / Reconnect Modal */}
      <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Watch className="size-5 text-primary" />
              Wearable Device Settings
            </DialogTitle>
            <DialogDescription>
              Manage Bluetooth LE pairing, protocol credentials and sync intervals for {seniorName}&apos;s smartwatch.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-foreground">Fire-Boltt Legacy (068 Luxe)</p>
                <p className="text-xs text-muted-foreground">MAC: {device.macAddress}</p>
              </div>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                Paired & Ready
              </Badge>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Sync Frequency</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="10">High Frequency (Every 10 seconds)</option>
                <option value="30">Standard Frequency (Every 30 seconds)</option>
                <option value="60">Battery Saver (Every 1 minute)</option>
                <option value="300">Background Hourly Summary (Every 5 minutes)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Heart Rate & SpO2 Polling</label>
              <p className="text-xs text-muted-foreground">
                Continuous PPG sensor active with optical pulse oximetry enabled. Battery impact: ~15% per day.
              </p>
            </div>

            <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <strong>Clinical Guardrail:</strong> Smartwatch biometrics provide trend indications. Any acute clinical decisions must be confirmed with calibrated cuff and pulse oximeter.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowConfigModal(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setDeviceConnected(true);
                setShowConfigModal(false);
              }}
              className="gap-1.5"
            >
              <CheckCircle2 className="size-4" /> Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
