import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";

import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice } from "@/components/shell/states";
import { Checkbox } from "@/components/ui/checkbox";
import { OrganizationsAdmin } from "@/components/admin/organizations";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, roleSchema, uuidSchema, type AppRole } from "@/lib/auth";
import { useMyRoles } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administration — Sahaara" },
      { name: "description", content: "Manage Sahaara roles and review the audit trail." },
      { property: "og:title", content: "Administration — Sahaara" },
      { property: "og:description", content: "Manage Sahaara roles and review the audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

const ROLES: { role: AppRole; label: string }[] = [
  { role: "admin", label: "Admin" },
  { role: "coordinator", label: "Coordinator" },
  { role: "senior", label: "Senior" },
  { role: "family", label: "Family" },
];

function Admin() {
  const { user } = Route.useRouteContext();
  const mine = useMyRoles(user.id);
  const isAdmin = mine.data?.includes("admin") ?? false;
  const qc = useQueryClient();

  const people = useQuery({
    queryKey: ["admin-people"],
    enabled: isAdmin,
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, account_status, created_at")
          .order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      return p.data.map((x) => ({
        ...x,
        roles: r.data.filter((y) => y.user_id === x.id).map((y) => y.role),
      }));
    },
  });
  const audit = useQuery({
    queryKey: ["admin-audit"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("id, occurred_at, actor_id, action, resource_type, resource_id, outcome")
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const setRole = useMutation({
    mutationFn: async (v: { target: string; role: AppRole; grant: boolean }) => {
      const target = uuidSchema.parse(v.target);
      const role = roleSchema.parse(v.role);
      const { error } = await supabase.rpc("admin_set_role", {
        _target: target,
        _role: role,
        _grant: v.grant,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.grant ? "Role granted" : "Role removed");
      qc.invalidateQueries({ queryKey: ["admin-people"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(friendlyAuthError(e.message)),
  });

  if (mine.isPending)
    return (
      <Page title="Administration">
        <p role="status" className="text-muted-foreground">
          Checking access…
        </p>
      </Page>
    );
  if (!isAdmin)
    return (
      <Page title="Administration">
        <EmptyState icon={Lock} title="Administrators only">
          Your account doesn't have the administrator role. The data on this page is protected by
          the database, not just hidden.
        </EmptyState>
      </Page>
    );

  const nameOf = (id: string | null) =>
    people.data?.find((p) => p.id === id)?.display_name || (id ? id.slice(0, 8) : "system");

  return (
    <Page
      eyebrow="Administration"
      title="People and access"
      description="Grant or remove roles. Every change is recorded in the audit trail."
    >
      <Section title="People">
        {people.isPending ? (
          <p role="status" className="text-muted-foreground">
            Loading…
          </p>
        ) : people.isError ? (
          <Notice tone="critical" title="Couldn't load people." />
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">Accounts and their roles</caption>
              <thead className="border-b border-border text-sm text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Name
                  </th>
                  {ROLES.map((r) => (
                    <th key={r.role} scope="col" className="px-4 py-3 font-semibold">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.data.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-semibold">
                      {p.display_name || "Unnamed"}{" "}
                      {p.id === user.id && (
                        <span className="text-sm font-normal text-muted-foreground">(you)</span>
                      )}
                    </th>
                    {ROLES.map((r) => {
                      const has = p.roles.includes(r.role);
                      const self = p.id === user.id && r.role === "admin";
                      return (
                        <td key={r.role} className="px-4 py-3">
                          <Checkbox
                            checked={has}
                            disabled={setRole.isPending || self}
                            aria-label={`${r.label} role for ${p.display_name || "unnamed user"}`}
                            onCheckedChange={(c) =>
                              setRole.mutate({ target: p.id, role: r.role, grant: c === true })
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Audit trail"
        description="Most recent 50 security events. Entries cannot be edited or deleted."
      >
        {audit.isPending ? (
          <p role="status" className="text-muted-foreground">
            Loading…
          </p>
        ) : audit.isError ? (
          <Notice tone="critical" title="Couldn't load the audit trail." />
        ) : (
          <ul className="surface divide-y divide-border">
            {audit.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
              >
                <time className="text-data text-muted-foreground" dateTime={a.occurred_at}>
                  {new Date(a.occurred_at).toLocaleString()}
                </time>
                <span className="font-semibold">{a.action}</span>
                <span className="text-muted-foreground">by {nameOf(a.actor_id)}</span>
                <span className={a.outcome === "success" ? "text-success" : "text-critical"}>
                  {a.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
