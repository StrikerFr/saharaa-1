import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/hooks/use-session";

/** UI hint only — the database enforces the same rule (role + organisation membership). */
export function useCareAccess(userId: string) {
  const roles = useMyRoles(userId);
  const org = useQuery({
    queryKey: ["my-org", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("org_id, organizations(name)")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.org_id, name: data.organizations?.name ?? "" } : null;
    },
  });
  const hasRole = !!roles.data?.some((r) => r === "coordinator" || r === "admin");
  return {
    isPending: roles.isPending || org.isPending,
    isError: roles.isError || org.isError,
    org: org.data ?? null,
    hasRole,
    canAccess: hasRole && !!org.data,
  };
}
