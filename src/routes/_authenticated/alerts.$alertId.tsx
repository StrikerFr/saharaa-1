import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Route handler for /alerts/$alertId.
 * If alertId is a case ID or senior ID, redirects cleanly to the senior's review case tab.
 * Never throws 404 Page Not Found.
 */
export const Route = createFileRoute("/_authenticated/alerts/$alertId")({
  beforeLoad: async ({ params }) => {
    const { alertId } = params;

    // 1. Check if alertId is a review case ID
    const { data: caseRow } = await supabase
      .from("review_cases")
      .select("senior_id")
      .eq("id", alertId)
      .maybeSingle();

    if (caseRow?.senior_id) {
      throw redirect({
        to: "/seniors/$seniorId",
        params: { seniorId: caseRow.senior_id },
        search: { tab: "alerts" },
      });
    }

    // 2. Check if alertId is already a senior ID
    const { data: seniorRow } = await supabase
      .from("seniors")
      .select("id")
      .eq("id", alertId)
      .maybeSingle();

    if (seniorRow?.id) {
      throw redirect({
        to: "/seniors/$seniorId",
        params: { seniorId: seniorRow.id },
        search: { tab: "alerts" },
      });
    }

    // 3. Graceful fallback to the alerts overview
    throw redirect({ to: "/alerts" });
  },
  component: () => null,
});
