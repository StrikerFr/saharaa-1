import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { Field } from "@/components/auth/field";
import { Section } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, uuidSchema } from "@/lib/auth";

const orgName = z.string().trim().min(2, "Enter at least 2 characters.").max(120);

export function OrganizationsAdmin({ people }: { people: { id: string; display_name: string }[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string>();
  const orgs = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: async () => {
      const [o, m] = await Promise.all([
        supabase.from("organizations").select("id, name").order("name"),
        supabase.from("organization_members").select("user_id, org_id"),
      ]);
      if (o.error) throw o.error;
      if (m.error) throw m.error;
      return { orgs: o.data, members: new Map(m.data.map((x) => [x.user_id, x.org_id])) };
    },
  });
  const create = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc("admin_create_org", { _name: name });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organisation created");
      qc.invalidateQueries({ queryKey: ["admin-orgs"] });
    },
    onError: (e: { code?: string; message: string }) =>
      toast.error(
        e.code === "23505"
          ? "An organisation with that name already exists."
          : friendlyAuthError(e.message),
      ),
  });
  const assign = useMutation({
    mutationFn: async (v: { user: string; org: string | null }) => {
      const { error } = await supabase.rpc("admin_set_membership", {
        _user: uuidSchema.parse(v.user),
        _org: (v.org ? uuidSchema.parse(v.org) : null) as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membership updated");
      qc.invalidateQueries({ queryKey: ["admin-orgs"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(friendlyAuthError(e.message)),
  });

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const p = orgName.safeParse(new FormData(form).get("orgName"));
    if (!p.success) return setErr(p.error.issues[0]?.message);
    setErr(undefined);
    create.mutate(p.data, { onSuccess: () => form.reset() });
  }

  return (
    <Section
      title="Organisations"
      description="Care data is only visible within a person's organisation. Each person works in one organisation at a time — pick it below. Admins can also switch their own organisation from the sidebar at any time."
    >
      <form noValidate onSubmit={onCreate} className="flex max-w-md flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field id="orgName" name="orgName" label="New organisation name" error={err} />
        </div>
        <Button type="submit" loading={create.isPending}>
          Create
        </Button>
      </form>
      {orgs.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading…
        </p>
      ) : orgs.isError ? (
        <Notice tone="critical" title="Couldn't load organisations." />
      ) : (
        <ul className="surface divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <label htmlFor={`org-${p.id}`} className="font-semibold">
                {p.display_name || "Unnamed"}
              </label>
              <select
                id={`org-${p.id}`}
                className="h-11 min-w-48 rounded-md border border-input bg-card px-3"
                value={orgs.data.members.get(p.id) ?? ""}
                disabled={assign.isPending}
                onChange={(e) => assign.mutate({ user: p.id, org: e.target.value || null })}
              >
                <option value="">No organisation</option>
                {orgs.data.orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
