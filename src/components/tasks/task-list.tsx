import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { Notice, StatusBadge } from "@/components/shell/states";
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
import { TASK_STATUS_LABEL } from "@/lib/review-labels";
import { transitionFollowUpTask } from "@/lib/review.functions";
import { canTransitionTask, isTaskOverdue, type FollowUpTaskStatus } from "@/lib/review-workflow";
import type { FollowUpTaskRow } from "@/lib/review";

export type TaskListRow = FollowUpTaskRow & {
  seniorName?: string;
  recordCode?: string;
  assigneeName?: string | null;
  overdue?: boolean;
  dueSoon?: boolean;
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A list of follow-up tasks with working status actions. */
export function TaskList({
  tasks,
  showSenior,
}: {
  tasks: TaskListRow[];
  showSenior?: boolean | undefined;
}) {
  return (
    <ul className="flex flex-col gap-3.5">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showSenior={showSenior} />
      ))}
    </ul>
  );
}

function TaskRow({ task, showSenior }: { task: TaskListRow; showSenior?: boolean | undefined }) {
  const qc = useQueryClient();
  const transition = useServerFn(transitionFollowUpTask);
  const [confirm, setConfirm] = useState<FollowUpTaskStatus | null>(null);
  const [note, setNote] = useState("");

  const overdue = task.overdue ?? isTaskOverdue(task.due_at, task.status);
  const s = TASK_STATUS_LABEL[task.status];

  const mut = useMutation({
    mutationFn: (to: FollowUpTaskStatus) =>
      transition({ data: { taskId: task.id, to, note: note.trim() || null } }),
    onSuccess: async () => {
      setConfirm(null);
      setNote("");
      await qc.invalidateQueries({ queryKey: ["follow-up-tasks"] });
      await qc.invalidateQueries({ queryKey: ["review-case"] });
      await qc.invalidateQueries({ queryKey: ["ops-summary"] });
      await qc.invalidateQueries({ queryKey: ["review-queue"] });
    },
  });

  const next = (["in_progress", "open", "completed", "cancelled"] as const).filter(
    (to) => to !== task.status && canTransitionTask(task.status, to),
  );

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all duration-200 hover:border-primary/40 hover:shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary mt-0.5">
            <CalendarClock className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-foreground">
                {task.title}
              </span>
              <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
              {overdue && <StatusBadge tone="critical">Overdue</StatusBadge>}
              {!overdue && task.dueSoon && <StatusBadge tone="warning">Due soon</StatusBadge>}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {showSenior && task.seniorName && (
                <Link
                  to="/seniors/$seniorId"
                  params={{ seniorId: task.senior_id }}
                  className="font-semibold text-primary hover:underline"
                >
                  {task.seniorName}
                </Link>
              )}
              {task.due_at && (
                <span className={overdue ? "font-semibold text-rose-600 dark:text-rose-400" : ""}>
                  Due: {formatWhen(task.due_at)}
                </span>
              )}
              {task.assigneeName && (
                <span>Assigned to {task.assigneeName}</span>
              )}
              {task.completed_at && (
                <span>Completed: {formatWhen(task.completed_at)}</span>
              )}
            </div>
          </div>
        </div>

        {next.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 pt-1 sm:pt-0">
            {next.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === "completed" ? "default" : to === "cancelled" ? "ghost" : "outline"}
                className={to === "completed" ? "h-8 bg-emerald-700 text-white hover:bg-emerald-800" : "h-8"}
                onClick={() => {
                  setNote("");
                  setConfirm(to);
                }}
              >
                {to === "in_progress"
                  ? "Start"
                  : to === "open"
                    ? "Reopen"
                    : to === "completed"
                      ? "Mark Completed"
                      : "Cancel"}
              </Button>
            ))}
          </div>
        )}
      </div>

      {task.notes && (
        <div className="rounded-xl bg-muted/50 px-3.5 py-2.5 text-xs text-foreground/90 border border-border/40">
          <span className="font-semibold text-muted-foreground">Clinical notes: </span>
          {task.notes}
        </div>
      )}

      {task.outcome_note && (
        <div className="rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 border border-emerald-500/20">
          <span className="font-semibold">Recorded Outcome: </span>
          {task.outcome_note}
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "completed"
                ? "Complete this task?"
                : confirm === "cancelled"
                  ? "Cancel this task?"
                  : confirm === "open"
                    ? "Reopen this task?"
                    : "Start this task?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "completed"
                ? "Record what happened. Completing a task does not resolve the review case — that is a separate decision."
                : "This change is recorded with your name and the time."}
            </DialogDescription>
          </DialogHeader>
          {confirm && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`task-note-${task.id}`}>
                {confirm === "completed" ? "Outcome (required)" : "Note (optional)"}
              </Label>
              <Textarea
                id={`task-note-${task.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={3}
                aria-required={confirm === "completed"}
              />
              {mut.isError && (
                <Notice tone="critical" title="Couldn't save the change.">
                  {mut.error instanceof Error ? mut.error.message : "Please try again."}
                </Notice>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Back
            </Button>
            <Button
              loading={mut.isPending}
              disabled={confirm === "completed" && note.trim().length < 2}
              onClick={() => confirm && mut.mutate(confirm)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function TasksEmptyHint() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <CalendarClock className="size-4" aria-hidden="true" />
      No follow-up tasks yet.
    </p>
  );
}
