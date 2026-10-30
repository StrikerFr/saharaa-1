import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  User,
  Users,
  Watch,
} from "lucide-react";
import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page } from "@/components/shell/page";
import { EmptyState, Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WearableHealthDashboard } from "@/components/wearables/wearable-health-dashboard";
import { supabase } from "@/integrations/supabase/client";

const META = "Real-time biometrics, wearable telemetry and hourly analytics powered by Fire-Boltt Legacy.";

export const Route = createFileRoute("/_authenticated/monitoring")({
  head: () => ({
    meta: [
      { title: "Live Health Monitoring — Sahaara" },
      { name: "description", content: META },
      { property: "og:title", content: "Live Health Monitoring — Sahaara" },
      { property: "og:description", content: META },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MonitoringRouteComponent,
});

interface SeniorOption {
  id: string;
  display_name: string;
  date_of_birth?: string | null;
  care_status: string;
}

function MonitoringRouteComponent() {
  const { user } = Route.useRouteContext();

  return (
    <CareAccessGate userId={user.id}>
      {() => <MonitoringDashboardContent />}
    </CareAccessGate>
  );
}

function MonitoringDashboardContent() {
  const [selectedSeniorId, setSelectedSeniorId] = useState<string>("");

  // Fetch all accessible seniors in this coordinator's organization
  const { data: seniors, isLoading, error } = useQuery({
    queryKey: ["seniors-for-monitoring"],
    queryFn: async (): Promise<SeniorOption[]> => {
      const { data, error } = await supabase
        .from("seniors")
        .select("id, display_name, date_of_birth, care_status")
        .order("display_name", { ascending: true });

      if (error) throw error;
      return (data || []) as SeniorOption[];
    },
  });

  // Set default senior once loaded
  useEffect(() => {
    if (seniors && seniors.length > 0 && !selectedSeniorId) {
      // Prefer Kamala or Arjun if available, otherwise first senior
      const preferred = seniors.find((s) => s.display_name.toLowerCase().includes("kamala")) ||
                        seniors.find((s) => s.display_name.toLowerCase().includes("arjun")) ||
                        seniors[0];
      if (preferred) {
        setSelectedSeniorId(preferred.id);
      }
    }
  }, [seniors, selectedSeniorId]);

  if (isLoading) {
    return (
      <Page title="Live Health Monitoring">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-12 w-full max-w-sm rounded-xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </Page>
    );
  }

  if (error || !seniors || seniors.length === 0) {
    return (
      <Page title="Live Health Monitoring">
        <EmptyState icon={Users} title="No seniors found">
          You need access to at least one active senior profile to monitor wearable health telemetry.
        </EmptyState>
        <Button asChild variant="outline" className="mt-4 self-start">
          <Link to="/seniors">
            <ArrowRight className="mr-1.5 size-4" /> Go to Seniors directory
          </Link>
        </Button>
      </Page>
    );
  }

  const currentSenior =
    seniors.find((s) => s.id === selectedSeniorId) ?? seniors[0];

  if (!currentSenior) {
    return null;
  }

  return (
    <Page
      title="Live Health Monitoring"
      description="Continuous biometrics, activity, sleep architecture and physiological anomaly alerts."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {/* Senior Profile Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Select Senior:</span>
            <Select
              value={currentSenior.id}
              onValueChange={(val) => setSelectedSeniorId(val)}
            >
              <SelectTrigger className="h-9 w-60 rounded-xl bg-card text-xs font-semibold shadow-xs">
                <SelectValue placeholder="Select senior..." />
              </SelectTrigger>
              <SelectContent>
                {seniors.map((senior) => (
                  <SelectItem key={senior.id} value={senior.id} className="text-xs">
                    {senior.display_name}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      ({senior.care_status})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick link to senior profile */}
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-medium">
            <Link to="/seniors/$seniorId" params={{ seniorId: currentSenior.id }}>
              <User className="size-3.5" /> View Full Profile
            </Link>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Full Wearable Monitoring Experience */}
        <WearableHealthDashboard
          seniorId={currentSenior.id}
          seniorName={currentSenior.display_name}
        />
      </div>
    </Page>
  );
}
