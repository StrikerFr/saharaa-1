import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";

import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createFollowUpTask, listAssigneeOptions } from "@/lib/review.functions";

/** Create a follow-up task for a senior, optionally linked to a review case. */
export function TaskForm({ seniorId, caseId }: { seniorId: string; caseId?: string | null }) {
  const qc = useQueryClient();
  const create = useServerFn(createFollowUpTask);
  const fetchAssignees = useServerFn(listAssigneeOptions);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignee, setAssignee] = useState<string>("unassigned");

  const assigneesQuery = useQuery({
    queryKey: ["org-assignees"],
    queryFn: () => fetchAssignees(),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          seniorId,
          title: title.trim(),
          notes: notes.trim() || null,
          caseId: caseId ?? null,
          assignee: assignee === "unassigned" ? null : assignee,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      setTitle("");
      setNotes("");
      setDueAt("");
      setAssignee("unassigned");
      await qc.invalidateQueries({ queryKey: ["review-case"] });
      await qc.invalidateQueries({ queryKey: ["follow-up-tasks"] });
      await qc.invalidateQueries({ queryKey: ["ops-summary"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden="true" /> New follow-up task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New follow-up task</DialogTitle>
          <DialogDescription>
            Record the next human action for this person. Creating a task does not contact anyone
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-assignee">Assignee (optional)</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger id="task-assignee">
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(assigneesQuery.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-notes">Notes (optional)</Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-due">Due (optional)</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          {mut.isError && (
            <Notice tone="critical" title="Couldn't create the task.">
              {mut.error instanceof Error ? mut.error.message : "Please try again."}
            </Notice>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Back
          </Button>
          <Button
            loading={mut.isPending}
            disabled={title.trim().length < 2}
            onClick={() => mut.mutate()}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
