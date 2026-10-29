import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ExternalLink,
  MessageSquare,
  MessagesSquare,
  Phone,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationView } from "@/components/messages/conversation-view";
import {
  getSeniorWhatsAppSummary,
  linkSeniorWhatsAppIdentity,
  sendWhatsAppMessage,
  syncWhatsAppMessages,
} from "@/lib/whatsapp.functions";
import { WHATSAPP_RELATIONSHIP_TYPES, type WhatsAppRelationshipType } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export interface SeniorWhatsAppSectionProps {
  seniorId: string;
  seniorName: string;
}

export function SeniorWhatsAppSection({ seniorId, seniorName }: SeniorWhatsAppSectionProps) {
  const queryClient = useQueryClient();
  const getSummaryFn = useServerFn(getSeniorWhatsAppSummary);
  const linkIdentityFn = useServerFn(linkSeniorWhatsAppIdentity);
  const sendWhatsAppMessageFn = useServerFn(sendWhatsAppMessage);
  const syncMessagesFn = useServerFn(syncWhatsAppMessages);

  const [showAddForm, setShowAddForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [relationshipType, setRelationshipType] = useState<string>("family_member");
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Fetch WhatsApp summary for this senior (identities, conversation, recent messages)
  const summaryQuery = useQuery({
    queryKey: ["senior-whatsapp-summary", seniorId],
    queryFn: () => getSummaryFn({ data: { seniorId } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const identities = summaryQuery.data?.identities ?? [];
  const conversation = summaryQuery.data?.conversation ?? null;
  const recentMessages = summaryQuery.data?.recentMessages ?? [];

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !displayName.trim()) return;

    setIsLinking(true);
    setLinkError(null);
    try {
      await linkIdentityFn({
        data: {
          seniorId,
          phoneNumber: phoneNumber.trim(),
          displayName: displayName.trim(),
          relationshipType: relationshipType as WhatsAppRelationshipType,
        },
      });
      setPhoneNumber("");
      setDisplayName("");
      setShowAddForm(false);
      await queryClient.invalidateQueries({ queryKey: ["senior-whatsapp-summary", seniorId] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : "Failed to link WhatsApp number.");
    } finally {
      setIsLinking(false);
    }
  };

  const handleSendMessage = async (bodyText: string) => {
    if (!conversation) return;
    await sendWhatsAppMessageFn({
      data: {
        conversationId: conversation.id,
        bodyText,
      },
    });
    await summaryQuery.refetch();
    await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
  };

  const handleSyncTwilio = async () => {
    try {
      await syncMessagesFn({ data: { limit: 25 } });
      await summaryQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    } catch {
      // Ignored
    }
  };

  if (summaryQuery.isError) {
    return (
      <div className="surface p-5 rounded-xl border border-border flex flex-col gap-3">
        <div className="flex items-center gap-2 text-warning">
          <AlertCircle className="size-5" />
          <h3 className="font-semibold text-foreground">WhatsApp Communications Unavailable</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {summaryQuery.error instanceof Error
            ? summaryQuery.error.message
            : "Could not load WhatsApp communications for this senior."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start gap-1 text-xs"
          onClick={() => summaryQuery.refetch()}
        >
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      </div>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Header & Connected Identities Card */}
      <section
        className="surface p-5 rounded-xl border border-border"
        aria-labelledby="wa-identities-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="wa-identities-title"
              className="text-base font-semibold text-foreground flex items-center gap-2"
            >
              <MessagesSquare className="size-5 text-primary" aria-hidden="true" />
              WhatsApp Communications
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Direct two-way messaging with authorized family members and caregivers for{" "}
              {seniorName}.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncTwilio}
              className="h-8 gap-1.5 text-xs"
              title="Sync latest WhatsApp messages with Twilio"
            >
              <RefreshCw
                className={cn("size-3.5", summaryQuery.isFetching && "animate-spin text-primary")}
              />
              Sync Twilio
            </Button>

            {!showAddForm && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowAddForm(true)}
                className="h-8 gap-1.5 text-xs"
              >
                <Plus className="size-3.5" />
                Add Contact
              </Button>
            )}
          </div>
        </div>

        {/* Add Contact Form (Toggleable) */}
        {showAddForm && (
          <form
            onSubmit={handleLinkSubmit}
            className="mt-4 rounded-lg border border-border bg-card p-4 space-y-3"
            aria-label="Link WhatsApp phone number to senior"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Link Authorized WhatsApp Contact
              </h3>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            {linkError && (
              <div className="flex items-center gap-2 rounded bg-destructive-soft p-2 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="contact-phone"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Phone (E.164 with Country Code)
                </label>
                <input
                  id="contact-phone"
                  type="text"
                  required
                  placeholder="+919876543210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-name"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Contact Name
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  placeholder="e.g. Aryan (Daughter)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-rel"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Relationship
                </label>
                <select
                  id="contact-rel"
                  value={relationshipType}
                  onChange={(e) => setRelationshipType(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {WHATSAPP_RELATIONSHIP_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isLinking} size="sm" className="h-8 text-xs">
                {isLinking ? "Linking Contact..." : "Save & Verify Contact"}
              </Button>
            </div>
          </form>
        )}

        {/* Identities List */}
        <div className="mt-4">
          {identities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              <Phone className="mx-auto size-5 opacity-40 mb-1" />
              <p className="font-medium text-foreground">
                No WhatsApp numbers linked to {seniorName} yet.
              </p>
              <p className="mt-0.5">
                Click &quot;Add Contact&quot; to connect a family member&apos;s WhatsApp number.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {identities.map((id) => (
                <div
                  key={id.id}
                  className="flex items-center justify-between rounded-lg border border-border/80 bg-background/50 p-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground truncate">
                        {id.displayName || "Family Contact"}
                      </span>
                      <span className="rounded bg-secondary px-1.5 py-0.2 text-[10px] text-muted-foreground capitalize">
                        {(id.relationshipType || "").replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground font-mono text-[11px]">
                      {id.maskedPhoneNumber}
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className="bg-success-soft text-success border-success/30 gap-1 text-[10px]"
                  >
                    <ShieldCheck className="size-3" />
                    Verified
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. Embedded Live Chat Section */}
      <section
        className="surface overflow-hidden rounded-xl border border-border"
        aria-labelledby="wa-chat-title"
      >
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 id="wa-chat-title" className="text-sm font-semibold text-foreground">
              Live WhatsApp Chat History
            </h3>
            {conversation && conversation.unreadCount > 0 && (
              <Badge variant="secondary" className="bg-primary text-primary-foreground text-[10px]">
                {conversation.unreadCount} unread
              </Badge>
            )}
          </div>

          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-primary hover:text-primary"
          >
            <Link to="/messages">
              <ExternalLink className="size-3.5" />
              Open in Messages Inbox
            </Link>
          </Button>
        </div>

        <div className="h-[28rem]">
          {conversation ? (
            <ConversationView
              conversation={conversation}
              messages={recentMessages}
              isLoading={summaryQuery.isLoading}
              isFetching={summaryQuery.isFetching}
              onRefresh={() => summaryQuery.refetch()}
              totalMessages={recentMessages.length}
              onSendMessage={handleSendMessage}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground">
              <MessageSquare className="size-8 opacity-40 mb-2" />
              <p className="font-medium text-foreground text-sm">No WhatsApp messages yet</p>
              <p className="mt-1 max-w-sm">
                Once a verified family member sends a WhatsApp message or is linked above, their
                real-time messages will appear here.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
