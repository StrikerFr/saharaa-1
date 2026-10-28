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
    <ul className="surface divide-y divide-border">
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
    <li className="flex flex-col gap-2 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{task.title}</span>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        {overdue && <StatusBadge tone="critical">Overdue</StatusBadge>}
        {!overdue && task.dueSoon && <StatusBadge tone="warning">Due soon</StatusBadge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {showSenior && task.seniorName ? (
          <>
            <Link
              to="/seniors/$seniorId"
              params={{ seniorId: task.senior_id }}
              className="font-medium underline-offset-2 hover:underline"
            >
              {task.seniorName}
            </Link>
            {" · "}
          </>
        ) : null}
        {task.due_at ? `Due ${formatWhen(task.due_at)}` : "No due date"}
        {task.assigneeName ? ` · Assigned to ${task.assigneeName}` : ""}
        {task.completed_at ? ` · Completed ${formatWhen(task.completed_at)}` : ""}
      </p>
      {task.notes && <p className="text-sm">{task.notes}</p>}
      {task.outcome_note && (
        <p className="text-sm">
          <span className="font-semibold">Outcome:</span> {task.outcome_note}
        </p>
      )}
      {next.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {next.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "cancelled" ? "outline" : "secondary"}
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
                    ? "Complete"
                    : "Cancel"}
            </Button>
          ))}
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
