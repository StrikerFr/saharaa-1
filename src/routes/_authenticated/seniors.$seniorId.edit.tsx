import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { CareAccessGate } from "@/components/seniors/access-gate";
import {
  SeniorForm,
  type SeniorFormValues,
  type SeniorParsed,
} from "@/components/seniors/senior-form";
import { Page } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { supabase } from "@/integrations/supabase/client";
import { uuidSchema } from "@/lib/auth";
import { friendlyDbError, TIME_ZONES } from "@/lib/seniors";

export const Route = createFileRoute("/_authenticated/seniors/$seniorId/edit")({
  head: () => ({
    meta: [
      { title: "Edit senior — Sahaara" },
      { name: "description", content: "Update a senior profile." },
      { property: "og:title", content: "Edit senior — Sahaara" },
      { property: "og:description", content: "Update a senior profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EditSenior,
});

function EditSenior() {
  const { user } = Route.useRouteContext();
  const { seniorId } = Route.useParams();
  return (
    <Page eyebrow="Seniors" title="Edit profile">
      <CareAccessGate userId={user.id}>{() => <EditBody seniorId={seniorId} />}</CareAccessGate>
    </Page>
  );
}

function EditBody({ seniorId }: { seniorId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const valid = uuidSchema.safeParse(seniorId).success;

  const senior = useQuery({
    queryKey: ["senior", seniorId],
    enabled: valid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seniors")
        .select("*")
        .eq("id", seniorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (v: SeniorParsed) => {
      if (!senior.data) throw new Error("missing");
      // Optimistic concurrency: only update if nobody else saved since we loaded (version match).
      const { data, error } = await supabase
        .from("seniors")
        .update({
          display_name: v.displayName,
          date_of_birth: v.dateOfBirth,
          preferred_language: v.preferredLanguage,
          time_zone: v.timeZone,
          care_status: v.careStatus,
          communication_notes: v.communicationNotes,
          care_context: v.careContext,
          is_synthetic: v.isSynthetic,
        })
        .eq("id", seniorId)
        .eq("version", senior.data.version)
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw { code: "conflict" };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["senior", seniorId] });
      qc.invalidateQueries({ queryKey: ["seniors"] });
      toast.success("Profile saved");
      navigate({ to: "/seniors/$seniorId", params: { seniorId } });
    },
    onError: (e: { code?: string }) =>
      setServerError(
        e.code === "conflict"
          ? "Someone else changed this profile since you opened it. Your edits are still here — reload the page to see their changes before saving."
          : friendlyDbError(e),
      ),
  });

  if (!valid || (senior.isSuccess && !senior.data))
    return (
      <Notice tone="warning" title="Profile not found">
        It may not exist, or you may not have access.{" "}
        <Link to="/seniors" className="font-semibold underline">
          Back to seniors
        </Link>
      </Notice>
    );
  if (senior.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Loading…
      </p>
    );
  if (senior.isError) return <Notice tone="critical" title="Couldn't load this profile." />;

  const s = senior.data!;
  const initial: SeniorFormValues = {
    recordCode: s.record_code,
    displayName: s.display_name,
    dateOfBirth: s.date_of_birth ?? "",
    preferredLanguage: s.preferred_language,
    timeZone: (TIME_ZONES as readonly string[]).includes(s.time_zone)
      ? (s.time_zone as SeniorFormValues["timeZone"])
      : "Asia/Kolkata",
    careStatus: s.care_status,
    communicationNotes: s.communication_notes ?? "",
    careContext: s.care_context ?? "",
    isSynthetic: s.is_synthetic,
  };

  return (
    <SeniorForm
      mode="edit"
      initial={initial}
      submitting={save.isPending}
      serverError={serverError}
      onSubmit={(v) => {
        setServerError(null);
        save.mutate(v);
      }}
      onCancel={() => navigate({ to: "/seniors/$seniorId", params: { seniorId } })}
    />
  );
}
