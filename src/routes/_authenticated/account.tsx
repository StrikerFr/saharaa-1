import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { Field } from "@/components/auth/field";
import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { displayNameSchema, friendlyAuthError } from "@/lib/auth";
import { useMyRoles } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Your account — Sahaara" },
      { name: "description", content: "Your Sahaara profile, access and sharing permissions." },
      { property: "og:title", content: "Your account — Sahaara" },
      {
        property: "og:description",
        content: "Your Sahaara profile, access and sharing permissions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Account,
});

const roleLabel = {
  admin: "Administrator",
  coordinator: "Care coordinator",
  senior: "Senior",
  family: "Family member",
} as const;

function Account() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const roles = useMyRoles(user.id);
  const profile = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, account_status, created_at")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const consents = useQuery({
    queryKey: ["my-consents", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consent_records")
        .select("id, recipient_category, purpose, scope, status, effective_from, withdrawn_at")
        .eq("subject_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [nameError, setNameError] = useState<string>();
  const saveName = useMutation({
    mutationFn: async (name: string) => {
      const { error, count } = await supabase
        .from("profiles")
        .update({ display_name: name }, { count: "exact" })
        .eq("id", user.id);
      if (error) throw error;
      if (count !== 1) throw new Error("forbidden");
    },
    onSuccess: () => {
      toast.success("Name saved");
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    },
    onError: (e: Error) => toast.error(friendlyAuthError(e.message)),
  });
  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("withdraw_consent", { _consent: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Consent withdrawn");
      qc.invalidateQueries({ queryKey: ["my-consents", user.id] });
    },
    onError: (e: Error) => toast.error(friendlyAuthError(e.message)),
  });

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = displayNameSchema.safeParse(new FormData(e.currentTarget).get("displayName"));
    if (!p.success) return setNameError(p.error.issues[0]?.message);
    setNameError(undefined);
    saveName.mutate(p.data);
  }

  return (
    <Page eyebrow="Account" title="Your account" description={user.email}>
      <Section title="Access">
        {roles.isPending ? (
          <p className="text-muted-foreground" role="status">
            Loading access…
          </p>
        ) : roles.isError ? (
          <Notice tone="critical" title="Couldn't load your access. Refresh to try again." />
        ) : roles.data.length === 0 ? (
          <Notice tone="info" title="Access pending">
            Your account works, but no role has been assigned yet. An administrator must grant
            access before you can see care information.
          </Notice>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.data.map((r) => (
              <StatusBadge key={r} tone="success">
                {roleLabel[r]}
              </StatusBadge>
            ))}
          </div>
        )}
      </Section>

      <Section title="Profile">
        {profile.isPending ? (
          <p className="text-muted-foreground" role="status">
            Loading profile…
          </p>
        ) : profile.isError ? (
          <Notice tone="critical" title="Couldn't load your profile." />
        ) : (
          <form noValidate onSubmit={onSave} className="surface flex max-w-md flex-col gap-4 p-6">
            <Field
              id="displayName"
              name="displayName"
              label="Display name"
              defaultValue={profile.data.display_name}
              error={nameError}
            />
            <Button type="submit" loading={saveName.isPending} className="self-start">
              Save
            </Button>
          </form>
        )}
      </Section>

      <Section
        title="Sharing permissions"
        description="Consents you've given for your information to be shared."
      >
        {consents.isPending ? (
          <p className="text-muted-foreground" role="status">
            Loading…
          </p>
        ) : consents.isError ? (
          <Notice tone="critical" title="Couldn't load sharing permissions." />
        ) : consents.data.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No sharing permissions">
            Nothing about you is shared by consent. Consent is never assumed.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {consents.data.map((c) => (
              <li
                key={c.id}
                className="surface flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-semibold">
                    {c.scope.replace("_", " ")} → {c.recipient_category.replace("_", " ")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Purpose: {c.purpose.replace("_", " ")} · since{" "}
                    {new Date(c.effective_from).toLocaleDateString()}
                  </p>
                </div>
                {c.status === "granted" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={withdraw.isPending && withdraw.variables === c.id}
                    onClick={() => withdraw.mutate(c.id)}
                  >
                    Withdraw
                  </Button>
                ) : (
                  <StatusBadge tone="neutral">Withdrawn</StatusBadge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
