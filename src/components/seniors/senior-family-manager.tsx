import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, KeyRound, ShieldAlert, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

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
import { Notice } from "@/components/shell/states";
import { RELATIONSHIP_LABELS, type RelationshipLabel } from "@/lib/family";
import {
  createFamilyInvitation,
  listSeniorFamilyMembers,
  revokeFamilyAccess,
} from "@/lib/family.functions";

interface SeniorFamilyManagerProps {
  seniorId: string;
  seniorName: string;
}

interface SeniorFamilyMemberItem {
  id: string;
  userId: string;
  displayName: string;
  relationship: string;
  grantedAt: string;
}

export function SeniorFamilyManager({ seniorId, seniorName }: SeniorFamilyManagerProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState<string>("Daughter");
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const fetchMembers = useServerFn(listSeniorFamilyMembers);
  const sendInvite = useServerFn(createFamilyInvitation);
  const sendRevoke = useServerFn(revokeFamilyAccess);

  const membersQuery = useQuery({
    queryKey: ["senior-family-members", seniorId],
    queryFn: () => fetchMembers({ data: { seniorId } }),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await sendInvite({
        data: {
          seniorId,
          email: email.trim(),
          relationship,
        },
      });
      return res;
    },
    onSuccess: (data) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/invite?token=${data.token}`;
      setGeneratedInviteUrl(url);
      qc.invalidateQueries({ queryKey: ["senior-family-members", seniorId] });
      toast.success("Family invitation created!");
    },
    onError: (err: any) => setError(err.message || "Failed to create invitation."),
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      await sendRevoke({
        data: { seniorId, userId, reason: "Revoked by coordinator" },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["senior-family-members", seniorId] });
      toast.success("Family access revoked.");
    },
    onError: (err: any) => toast.error(err.message || "Failed to revoke access."),
  });

  const copyToClipboard = () => {
    if (generatedInviteUrl) {
      navigator.clipboard.writeText(generatedInviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("Invitation link copied to clipboard!");
    }
  };

  const members: SeniorFamilyMemberItem[] = (membersQuery.data as SeniorFamilyMemberItem[]) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Authorized Family & Caregivers</h3>
          <p className="text-xs text-muted-foreground">
            Family members with verified access to {seniorName}&apos;s updates and observation history.
          </p>
        </div>

        <Dialog
          open={inviteOpen}
          onOpenChange={(v) => {
            setInviteOpen(v);
            if (!v) {
              setEmail("");
              setGeneratedInviteUrl(null);
              setError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-2">
              <UserPlus className="size-4" /> Invite Family Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Family Member</DialogTitle>
              <DialogDescription>
                Generate a secure, single-use invitation link for {seniorName}&apos;s family member or primary caregiver.
              </DialogDescription>
            </DialogHeader>

            {error && <Notice tone="critical" title={error} />}

            {generatedInviteUrl ? (
              <div className="flex flex-col gap-4 py-3">
                <Notice tone="success" title="Invitation Generated">
                  This secure link is single-use and will expire in 7 days. Send it directly to the family member.
                </Notice>
                <div className="flex items-center gap-2">
                  <Input readOnly value={generatedInviteUrl} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={copyToClipboard} aria-label="Copy invitation link">
                    {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => setInviteOpen(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-email" className="text-xs font-semibold">
                    Email Address
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="family.member@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-relationship" className="text-xs font-semibold">
                    Relationship to Senior
                  </Label>
                  <select
                    id="invite-relationship"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {RELATIONSHIP_LABELS.map((lbl) => (
                      <option key={lbl} value={lbl}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <DialogFooter className="mt-2">
                  <Button
                    loading={inviteMutation.isPending}
                    disabled={!email.includes("@")}
                    onClick={() => inviteMutation.mutate()}
                    className="w-full sm:w-auto"
                  >
                    Generate Invitation Link
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          <Users className="size-8 opacity-40" />
          <p>No family members linked yet.</p>
          <p className="text-xs">Click &quot;Invite Family Member&quot; to securely connect an authorized caregiver.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-4">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-foreground">{m.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {m.relationship} · Linked on {new Date(m.grantedAt).toLocaleDateString()}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                loading={revokeMutation.isPending}
                onClick={() => {
                  if (confirm(`Revoke access for ${m.displayName}? They will no longer be able to view ${seniorName}'s records.`)) {
                    revokeMutation.mutate({ userId: m.userId });
                  }
                }}
              >
                <UserMinus className="size-4" /> Revoke Access
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
