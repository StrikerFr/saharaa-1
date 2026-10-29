import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, ChevronRight, Pill, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";

interface AlertCase {
  id: string;
  senior_id: string;
  status: string;
  priority_at_open: string;
  opened_at: string;
  seniors: { display_name: string; record_code: string } | null;
}

interface MissedRoutineLog {
  id: string;
  senior_id: string;
  status: string;
  note: string | null;
  created_at: string;
  seniors: { display_name: string } | null;
  care_routine_items: { title: string; category: string } | null;
}

const STORAGE_KEY = "sahaara_notified_alerts_v1";

function getNotifiedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveNotifiedSet(set: Set<string>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function AlertsPopupNotifier() {
  const { session, ready } = useSession();
  const navigate = useNavigate();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const notifiedRef = useRef<Set<string>>(getNotifiedSet());

  // 1. Fetch active review cases (alerts)
  const alertsQuery = useQuery({
    queryKey: ["active-review-cases-notifier"],
    enabled: !!(ready && session?.user),
    refetchInterval: 15000, // poll every 15s for real-time responsiveness
    queryFn: async (): Promise<AlertCase[]> => {
      const { data, error } = await supabase
        .from("review_cases")
        .select(`
          id,
          senior_id,
          status,
          priority_at_open,
          opened_at,
          seniors(display_name, record_code)
        `)
        .in("status", ["needs_review", "in_review", "follow_up_required"])
        .order("opened_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return (data ?? []) as unknown as AlertCase[];
    },
  });

  // 2. Fetch recent missed routine items
  const missedRoutineQuery = useQuery({
    queryKey: ["recent-missed-routine-logs"],
    enabled: !!(ready && session?.user),
    refetchInterval: 15000,
    queryFn: async (): Promise<MissedRoutineLog[]> => {
      const { data, error } = await (supabase as any)
        .from("care_routine_logs")
        .select(`
          id,
          senior_id,
          status,
          note,
          created_at,
          seniors(display_name),
          care_routine_items(title, category)
        `)
        .eq("status", "missed")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data ?? []) as unknown as MissedRoutineLog[];
    },
  });

  // 3. Trigger toasts when new alerts or missed medications are found
  useEffect(() => {
    if (!ready || !session?.user) return;

    let updated = false;

    // Toast for missed medication routines
    if (missedRoutineQuery.data && missedRoutineQuery.data.length > 0) {
      for (const log of missedRoutineQuery.data) {
        if (!notifiedRef.current.has(log.id)) {
          notifiedRef.current.add(log.id);
          updated = true;

          const seniorName = log.seniors?.display_name ?? "Senior";
          const title = log.care_routine_items?.title ?? "Medication";

          toast.error(`⚠️ Care Alert: Medicine Missed`, {
            description: `${seniorName} missed scheduled dose: "${title}". Coordinator attention suggested.`,
            action: {
              label: "View Senior",
              onClick: () =>
                navigate({
                  to: "/seniors/$seniorId",
                  params: { seniorId: log.senior_id },
                  search: { tab: "today" },
                }),
            },
            duration: 9000,
          });
        }
      }
    }

    // Toast for high-priority review cases
    if (alertsQuery.data && alertsQuery.data.length > 0) {
      for (const alertCase of alertsQuery.data) {
        if (!notifiedRef.current.has(alertCase.id)) {
          notifiedRef.current.add(alertCase.id);
          updated = true;

          const seniorName = alertCase.seniors?.display_name ?? "Senior";
          const priority = alertCase.priority_at_open.replace(/_/g, " ");

          toast.warning(`⚠️ Review Case Open: ${seniorName}`, {
            description: `Priority: ${priority}. An alert has been raised from clinical observations.`,
            action: {
              label: "Review Alert",
              onClick: () => navigate({ to: "/alerts" }),
            },
            duration: 9000,
          });
        }
      }
    }

    if (updated) {
      saveNotifiedSet(notifiedRef.current);
    }
  }, [alertsQuery.data, missedRoutineQuery.data, ready, session?.user, navigate]);

  const activeCount = alertsQuery.data?.length ?? 0;
  if (!ready || !session?.user || activeCount === 0 || bannerDismissed) {
    return null;
  }

  // Top Alert Banner on screen for immediate visibility
  return (
    <div
      role="region"
      aria-label="Active care alerts banner"
      className="sticky top-0 z-[var(--z-header)] flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-50/95 px-4 py-2.5 text-amber-950 backdrop-blur dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white dark:bg-amber-400 dark:text-black">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
        </span>
        <span className="truncate">
          <strong>{activeCount} active care alerts</strong> require review (missed medicines, vitals changes or mobility decline).
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" variant="default" className="h-7 bg-amber-700 text-white hover:bg-amber-800 dark:bg-amber-500 dark:text-black dark:hover:bg-amber-400">
          <Link to="/alerts">
            Open Alerts <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
        <button
          type="button"
          onClick={() => setBannerDismissed(true)}
          className="rounded p-1 text-amber-800 transition-colors hover:bg-amber-200/50 dark:text-amber-300 dark:hover:bg-amber-800/50"
          aria-label="Dismiss alert banner for this session"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Hook to get unread active alerts count for badge in sidebar */
export function useActiveAlertsCount() {
  const { session, ready } = useSession();
  const q = useQuery({
    queryKey: ["active-alerts-count"],
    enabled: !!(ready && session?.user),
    refetchInterval: 15000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("review_cases")
        .select("id", { count: "exact", head: true })
        .in("status", ["needs_review", "in_review", "follow_up_required"]);
      if (error) return 0;
      return count ?? 0;
    },
  });
  return q.data ?? 0;
}

