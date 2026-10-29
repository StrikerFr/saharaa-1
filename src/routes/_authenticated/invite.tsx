import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, HeartHandshake, ShieldCheck } from "lucide-react";
import { z } from "zod";

import { Page } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { acceptFamilyInvitation } from "@/lib/family.functions";

export const Route = createFileRoute("/_authenticated/invite")({
  validateSearch: z.object({
    token: z.string().optional().catch(undefined),
  }),
  head: () => ({
    meta: [
      { title: "Accept Family Invitation — Sahaara" },
      { name: "description", content: "Accept an authorized family caregiver invitation to view updates." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const acceptFn = useServerFn(acceptFamilyInvitation);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("No invitation token was provided in the link.");
      return acceptFn({ data: { token } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries();
      void navigate({ to: "/family", search: { seniorId: res.seniorId } });
    },
    onError: (err: any) => setError(err.message || "Failed to accept invitation."),
  });

  return (
    <Page
      title="Family Caregiver Invitation"
      description="Connect to your senior's care record to stay updated on their daily wellbeing and share updates."
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <HeartHandshake className="size-7" />
        </span>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            You&apos;ve Been Invited as a Caregiver
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A care coordinator has invited you to access your loved one&apos;s daily routine, observations, and care updates on Sahaara.
          </p>
        </div>

        {error && <Notice tone="critical" title={error} />}

        {!token ? (
          <Notice tone="warning" title="Missing Invitation Link">
            This invitation link is missing a verification token. Please click the full link sent by your care coordinator.
          </Notice>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <Button
              size="lg"
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="w-full gap-2 text-base font-semibold"
            >
              <CheckCircle2 className="size-5" /> Accept & Open Family Portal
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              Access is private and encrypted for your family.
            </p>
          </div>
        )}
      </div>
    </Page>
  );
}

