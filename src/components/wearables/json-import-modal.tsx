import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCheck,
  FileCode,
  FileUp,
  Info,
  UploadCloud,
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
import {
  wearableImportPayloadSchema,
  type WearableImportPayload,
  type WearableReading,
} from "@/lib/wearables";

interface JsonImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seniorId: string;
  seniorName: string;
  onImportSuccess: (readings: WearableReading[]) => void;
}

export function JsonImportModal({
  open,
  onOpenChange,
  seniorId,
  seniorName,
  onImportSuccess,
}: JsonImportModalProps) {
  const [jsonText, setJsonText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<WearableImportPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonText(content);
      validateJsonString(content);
    };
    reader.readAsText(file);
  };

  const validateJsonString = (content: string) => {
    setErrorMsg(null);
    setPreviewData(null);

    try {
      const parsed = JSON.parse(content);
      const validated = wearableImportPayloadSchema.safeParse(parsed);

      if (!validated.success) {
        const issues = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
        setErrorMsg(`Schema validation error: ${issues}`);
        return;
      }

      setPreviewData(validated.data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? `Invalid JSON syntax: ${err.message}` : "Invalid JSON format");
    }
  };

  const handleDownloadSample = () => {
    const now = new Date();
    const samplePayload: WearableImportPayload = {
      seniorId,
      deviceModel: "Fire-Boltt Legacy",
      exportedAt: now.toISOString(),
      readings: [
        {
          timestamp: new Date(now.getTime() - 3600000 * 2).toISOString(),
          heartRate: 74,
          spo2: 98,
          stressScore: 28,
          stressCategory: "low",
          bpSystolic: 122,
          bpDiastolic: 78,
          steps: 4200,
          calories: 1540,
          distanceKm: 2.85,
          source: "fire_boltt_legacy",
        },
        {
          timestamp: new Date(now.getTime() - 3600000).toISOString(),
          heartRate: 82,
          spo2: 97,
          stressScore: 35,
          stressCategory: "normal",
          bpSystolic: 126,
          bpDiastolic: 80,
          steps: 5120,
          calories: 1620,
          distanceKm: 3.48,
          source: "fire_boltt_legacy",
        },
        {
          timestamp: now.toISOString(),
          heartRate: 76,
          spo2: 99,
          stressScore: 24,
          stressCategory: "relaxed",
          bpSystolic: 120,
          bpDiastolic: 76,
          steps: 5890,
          calories: 1710,
          distanceKm: 4.02,
          source: "fire_boltt_legacy",
        },
      ],
    };

    const blob = new Blob([JSON.stringify(samplePayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fireboltt-health-sample-${seniorName.toLowerCase().replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyImport = () => {
    if (!previewData) return;
    setIsSubmitting(true);
    try {
      onImportSuccess(previewData.readings as WearableReading[]);
      onOpenChange(false);
      setJsonText("");
      setPreviewData(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileUp className="size-5 text-primary" />
            <DialogTitle className="text-xl font-bold">Import Health Data (JSON)</DialogTitle>
          </div>
          <DialogDescription>
            Import exported biometrics from Fire-Boltt app, Apple Health, or Google Fit for {seniorName}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 text-sm">
          {/* File Dropzone & Template Download */}
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/80 bg-muted/20 p-5 text-center transition-colors hover:border-primary/50">
            <UploadCloud className="size-8 text-primary/70" />
            <p className="mt-2 text-xs font-semibold text-foreground">
              Select or drop a health JSON file
            </p>
            <p className="text-[11px] text-muted-foreground">Accepts validated .json schema files</p>

            <div className="mt-3 flex items-center gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button variant="outline" size="sm" asChild className="text-xs">
                  <span>Browse File</span>
                </Button>
              </label>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownloadSample}
                className="gap-1 text-xs text-primary"
              >
                <Download className="size-3.5" /> Download Sample JSON
              </Button>
            </div>
          </div>

          {/* Or Paste JSON Text */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">
              Or paste JSON directly:
            </label>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                if (e.target.value.trim()) validateJsonString(e.target.value);
                else {
                  setPreviewData(null);
                  setErrorMsg(null);
                }
              }}
              placeholder='{"deviceModel": "Fire-Boltt Legacy", "readings": [ ... ]}'
              className="h-28 w-full font-mono text-[11px] leading-relaxed rounded-md border border-input bg-background p-2.5 shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Error Notice */}
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-400">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Validation Preview */}
          {previewData && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3.5 text-xs text-foreground">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> Schema Validated
                </span>
                <Badge variant="outline" className="border-emerald-500/30 font-mono text-[11px]">
                  {previewData.readings.length} readings ready
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-muted-foreground">
                <div>Device: <strong className="text-foreground">{previewData.deviceModel}</strong></div>
                <div>First packet: <strong className="text-foreground">{previewData.readings[0]?.heartRate} BPM</strong></div>
                <div>Latest packet: <strong className="text-foreground">{previewData.readings[previewData.readings.length - 1]?.heartRate} BPM</strong></div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApplyImport}
            disabled={!previewData || isSubmitting}
            className="gap-1.5 bg-primary"
          >
            <FileCheck className="size-4" />
            {isSubmitting ? "Importing..." : "Confirm & Import to Stream"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
