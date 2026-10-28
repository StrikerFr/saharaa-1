import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { CareAccessGate } from "@/components/seniors/access-gate";
import { emptySenior, SeniorForm, type SeniorParsed } from "@/components/seniors/senior-form";
import { Page } from "@/components/shell/page";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { friendlyDbError } from "@/lib/seniors";

export const Route = createFileRoute("/_authenticated/seniors/new")({
  head: () => ({
    meta: [
      { title: "Add senior — Sahaara" },
      { name: "description", content: "Create a senior profile." },
      { property: "og:title", content: "Add senior — Sahaara" },
      { property: "og:description", content: "Create a senior profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewSenior,
});

function NewSenior() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (v: SeniorParsed) => {
      // org_id, created_by, timestamps and version are set by the database from the caller's identity.
      const { data, error } = await supabase
        .from("seniors")
        .insert({
          record_code: v.recordCode,
          display_name: v.displayName,
          date_of_birth: v.dateOfBirth,
          preferred_language: v.preferredLanguage,
          time_zone: v.timeZone,
          care_status: v.careStatus,
          communication_notes: v.communicationNotes,
          care_context: v.careContext,
          is_synthetic: v.isSynthetic,
          // org_id is assigned by a database trigger from the caller's membership; the column is not client-writable.
        } as unknown as TablesInsert<"seniors">)
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["seniors"] });
      toast.success("Profile created");
      navigate({ to: "/seniors/$seniorId", params: { seniorId: id } });
    },
    onError: (e: { code?: string }) => setServerError(friendlyDbError(e)),
  });

  return (
    <Page
      eyebrow="Seniors"
      title="Add senior"
      description="Collect only what the care team needs. Optional fields can stay empty."
    >
      <CareAccessGate userId={user.id}>
        {() => (
          <SeniorForm
            mode="create"
            initial={emptySenior}
            submitting={create.isPending}
            serverError={serverError}
            onSubmit={(v) => {
              setServerError(null);
              create.mutate(v);
            }}
            onCancel={() => navigate({ to: "/seniors" })}
          />
        )}
      </CareAccessGate>
    </Page>
  );
}
