import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

/** Client-side session for UI affordances only. Authorization is enforced by the database. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, ready };
}

export function useMyRoles(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-roles", userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase.rpc("my_roles");
      if (error) throw error;
      return (data ?? []) as AppRole[];
    },
  });
}
