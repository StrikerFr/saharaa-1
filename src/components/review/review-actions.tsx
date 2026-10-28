import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { openReviewCase, transitionReviewCase } from "@/lib/review.functions";
import {
  canTransitionCase,
  caseTransitionNeedsReason,
  type ReviewCaseStatus,
} from "@/lib/review-workflow";

const ACTION_TEXT: Partial<
  Record<ReviewCaseStatus, { title: string; cta: string; reasonLabel: string }>
> = {
  in_review: { title: "Start reviewing this case?", cta: "Start review", reasonLabel: "" },
  follow_up_required: {
    title: "Mark follow-up required?",
    cta: "Require follow-up",
    reasonLabel: "Note (optional)",
  },
  resolved: {
    title: "Resolve this case?",
    cta: "Resolve case",
    reasonLabel: "Outcome (required)",
  },
  dismissed: {
    title: "Dismiss this case?",
    cta: "Dismiss case",
    reasonLabel: "Reason (required)",
  },
};

/**
 * Buttons for every valid next status of a case, each confirmed in a dialog.
 * Dismissal and resolution require a written reason; the server re-validates.
 */
export function ReviewActions({ caseId, status }: { caseId: string; status: ReviewCaseStatus }) {
  const qc = useQueryClient();
  const transition = useServerFn(transitionReviewCase);
  const [pending, setPending] = useState<ReviewCaseStatus | null>(null);
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: (to: ReviewCaseStatus) =>
      transition({ data: { caseId, to, reason: reason.trim() || null } }),
    onSuccess: async () => {
      setPending(null);
      setReason("");
      await qc.invalidateQueries({ queryKey: ["review-case", caseId] });
      await qc.invalidateQueries({ queryKey: ["review-queue"] });
      await qc.invalidateQueries({ queryKey: ["ops-summary"] });
    },
  });

  const next = (["in_review", "follow_up_required", "resolved", "dismissed"] as const).filter(
    (to) => canTransitionCase(status, to),
  );
  if (next.length === 0) return null;

  const action = pending ? ACTION_TEXT[pending] : null;
  const needsReason = pending ? caseTransitionNeedsReason(pending) : false;

  return (
    <div className="flex flex-wrap gap-2">
      {next.map((to) => (
        <Button
          key={to}
          variant={to === "dismissed" ? "outline" : "default"}
          onClick={() => {
            setReason("");
            setPending(to);
          }}
        >
          {ACTION_TEXT[to]?.cta ?? to}
        </Button>
      ))}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            <DialogDescription>
              This change is recorded with your name and the time, and is visible in the case
              history.
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="transition-reason">{action?.reasonLabel || "Note (optional)"}</Label>
              <Textarea
                id="transition-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                aria-required={needsReason}
              />
              {mut.isError && (
                <Notice tone="critical" title="Couldn't save the change.">
                  {mut.error instanceof Error ? mut.error.message : "Please try again."}
                </Notice>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Back
            </Button>
            <Button
              loading={mut.isPending}
              disabled={needsReason && reason.trim().length < 2}
              onClick={() => pending && mut.mutate(pending)}
            >
              {action?.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Open a review case from an assessment (idempotent server-side). */
export function OpenCaseButton({
  seniorId,
  assessmentId,
  onOpened,
}: {
  seniorId: string;
  assessmentId: string;
  onOpened?: (caseId: string) => void;
}) {
  const open = useServerFn(openReviewCase);
  const mut = useMutation({
    mutationFn: () => open({ data: { seniorId, assessmentId } }),
    onSuccess: (r) => onOpened?.(r.caseId),
  });
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={() => mut.mutate()} loading={mut.isPending}>
        Open a review case from this assessment
      </Button>
      {mut.isError && (
        <Notice tone="critical" title="Couldn't open a review case.">
          {mut.error instanceof Error ? mut.error.message : "Please try again."}
        </Notice>
      )}
    </div>
  );
}
