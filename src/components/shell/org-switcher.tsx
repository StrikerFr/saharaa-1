import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, uuidSchema } from "@/lib/auth";

/**
 * Admin-only organisation switcher. Switching moves the admin's own single
 * membership through the audited SECURITY DEFINER `admin_set_membership`;
 * the database still decides what is visible. Non-admins see their org name.
 */
export function OrgSwitcher({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-switcher", userId],
    queryFn: async () => {
      const [o, m] = await Promise.all([
        supabase.from("organizations").select("id, name").order("name"),
        supabase.from("organization_members").select("org_id").eq("user_id", userId).maybeSingle(),
      ]);
      if (o.error) throw o.error;
      if (m.error) throw m.error;
      return { orgs: o.data, current: m.data?.org_id ?? null };
    },
  });
  const sw = useMutation({
    mutationFn: async (org: string) => {
      const { error } = await supabase.rpc("admin_set_membership", {
        _user: userId,
        _org: uuidSchema.parse(org),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.cancelQueries();
      qc.clear(); // drop the previous organisation's cached care data
      toast.success("Switched organisation");
    },
    onError: (e: Error) => toast.error(friendlyAuthError(e.message)),
  });

  if (q.isPending || q.isError) return null;
  const currentName = q.data.orgs.find((o) => o.id === q.data.current)?.name ?? "No organisation";

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <label
        htmlFor="org-switcher"
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <Building2 className="size-3.5" aria-hidden="true" /> Organisation
      </label>
      {isAdmin ? (
        <select
          id="org-switcher"
          className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={q.data.current ?? ""}
          disabled={sw.isPending}
          onChange={(e) => e.target.value && sw.mutate(e.target.value)}
        >
          {!q.data.current && <option value="">No organisation</option>}
          {q.data.orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <p id="org-switcher" className="text-sm font-semibold">
          {currentName}
        </p>
      )}
    </div>
  );
}
