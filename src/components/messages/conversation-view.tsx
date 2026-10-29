import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MessagesSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationSummary, MessageItem } from "@/lib/whatsapp";
import { sendWhatsAppMessage, syncWhatsAppMessages } from "@/lib/whatsapp.functions";
import { cn } from "@/lib/utils";

export interface ConversationViewProps {
  conversation: ConversationSummary | null;
  messages: MessageItem[];
  isLoading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  onBackToList?: () => void;
  totalMessages: number;
  onSendMessage?: (bodyText: string) => Promise<void>;
}

/** Formats message time cleanly for bubbles. */
function formatMessageTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Formats date header dividers between message days. */
function formatDateHeader(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

export function ConversationView({
  conversation,
  messages,
  isLoading,
  isFetching,
  onRefresh,
  onBackToList,
  onSendMessage,
}: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendWhatsAppMessageFn = useServerFn(sendWhatsAppMessage);
  const syncMessagesFn = useServerFn(syncWhatsAppMessages);

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Auto-scroll to latest message on load and when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !conversation || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      if (onSendMessage) {
        await onSendMessage(text);
      } else {
        await sendWhatsAppMessageFn({
          data: {
            conversationId: conversation.id,
            bodyText: text,
          },
        });
      }
      setInputText("");
      onRefresh();
    } catch (err: unknown) {
      setSendError(
        err instanceof Error
          ? err.message
          : "Failed to send WhatsApp message. Please check your Twilio configuration.",
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSendReminder = async () => {
    if (!conversation || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await sendWhatsAppMessageFn({
        data: {
          conversationId: conversation.id,
          bodyText: "Appointment Reminder",
          contentSid: "HXfe5ab5f00277942d4d4200328b4d403c",
        },
      });
      onRefresh();
    } catch (err: unknown) {
      setSendError(
        err instanceof Error
          ? err.message
          : "Failed to send template reminder.",
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncMessagesFn({ data: { limit: 30 } });
      onRefresh();
    } catch {
      // Ignored
    } finally {
      setIsSyncing(false);
    }
  };

  // When no conversation is selected
  if (!conversation) {
    return (
      <section
        aria-label="Conversation Details"
        className="flex h-full flex-col items-center justify-center p-8 text-center"
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary shadow-sm">
          <MessagesSquare className="size-7" aria-hidden="true" />
        </span>
        <div className="mt-4 max-w-sm">
          <h2 className="text-lg font-semibold text-foreground">Select a conversation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a contact or senior from the left list to view their WhatsApp message history and
            care coordination updates.
          </p>
        </div>
      </section>
    );
  }

  const isVerified = !!conversation.senior && conversation.identity?.status === "active";
  const contactName =
    conversation.identity?.displayName ||
    (conversation.senior ? `${conversation.senior.displayName}'s Family` : "Unverified Contact");

  return (
    <section
      aria-label={`Conversation with ${contactName}`}
      className="flex h-full flex-col overflow-hidden bg-background"
    >
      {/* 1. Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Back Button */}
          {onBackToList && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBackToList}
              className="size-8 md:hidden text-muted-foreground hover:text-foreground"
              aria-label="Back to conversations list"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}

          {/* Contact Details */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{contactName}</h2>

              {/* Status Badge */}
              {isVerified ? (
                <Badge
                  variant="outline"
                  className="bg-success-soft text-success border-success/30 gap-1 text-[11px]"
                >
                  <ShieldCheck className="size-3" />
                  Verified Contact
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-warning-soft text-warning border-warning/30 gap-1 text-[11px]"
                >
                  <ShieldAlert className="size-3" />
                  Pending Verification
                </Badge>
              )}

              {conversation.identity?.relationshipType && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                  {(conversation.identity.relationshipType || "").replace("_", " ")}
                </span>
              )}
            </div>

            {/* Meta row: Masked Phone & Linked Senior */}
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{conversation.maskedPhoneNumber}</span>

              {conversation.senior ? (
                <Link
                  to="/seniors/$seniorId"
                  params={{ seniorId: conversation.senior.id }}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <UserRound className="size-3" />
                  Senior: {conversation.senior.displayName} ({conversation.senior.recordCode})
                  <ExternalLink className="size-2.5 opacity-70" />
                </Link>
              ) : (
                <span className="text-warning">No senior linked</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing || isFetching}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Sync WhatsApp messages with Twilio"
          >
            <RefreshCw
              className={cn("size-3.5", (isSyncing || isFetching) && "animate-spin text-primary")}
              aria-hidden="true"
            />
            <span>{isSyncing ? "Syncing..." : "Sync Twilio"}</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh messages"
            title="Refresh messages"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              className={cn("size-4", isFetching && "animate-spin text-primary")}
              aria-hidden="true"
            />
          </Button>
        </div>
      </header>

      {/* 2. Message History Area */}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label="Message History"
        className="flex-1 space-y-4 overflow-y-auto p-4 focus-visible:outline-none"
      >
        {isLoading ? (
          <div className="space-y-4 p-4">
            <div className="flex justify-start">
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-12 w-1/2 rounded-2xl" />
            </div>
            <div className="flex justify-start">
              <Skeleton className="h-16 w-3/4 rounded-2xl" />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <MessagesSquare className="mb-2 size-8 text-muted-foreground/50" />
            <p className="font-medium text-foreground">No messages in this conversation yet</p>
            <p className="mt-1 text-xs">
              When WhatsApp messages arrive for this contact, they will appear here.
            </p>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isOutbound = m.direction === "outbound";
            const prevMsg = messages[idx - 1];
            const isNewDay =
              !prevMsg ||
              new Date(m.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

            return (
              <div key={m.id} className="space-y-3">
                {/* Date Divider */}
                {isNewDay && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
                      {formatDateHeader(m.createdAt)}
                    </span>
                  </div>
                )}

                {/* Bubble Container */}
                <div className={cn("flex w-full", isOutbound ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "group relative max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-xs transition-shadow",
                      isOutbound
                        ? "rounded-tr-xs bg-primary text-primary-foreground"
                        : "rounded-tl-xs bg-card border border-border/80 text-foreground",
                    )}
                  >
                    {/* Header info for sender */}
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-2 text-[11px] font-medium opacity-80",
                        isOutbound ? "justify-end" : "justify-start",
                      )}
                    >
                      <span>{isOutbound ? "Sahaara Team" : contactName}</span>
                    </div>

                    {/* Media Attachment if present */}
                    {m.messageType === "image" && (
                      <div className="mb-2 flex items-center gap-2 rounded bg-black/10 p-2 text-xs">
                        <ImageIcon className="size-4 shrink-0" />
                        <span className="truncate">WhatsApp Image Attachment</span>
                      </div>
                    )}
                    {m.messageType === "document" && (
                      <div className="mb-2 flex items-center gap-2 rounded bg-black/10 p-2 text-xs">
                        <FileText className="size-4 shrink-0" />
                        <span className="truncate">Document Attachment</span>
                      </div>
                    )}

                    {/* Message Body (Safe plain text rendering) */}
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                      {m.bodyText || <span className="italic opacity-70">Empty message</span>}
                    </p>

                    {/* Timestamp & Delivery Status */}
                    <div
                      className={cn(
                        "mt-1.5 flex items-center gap-1.5 text-[10px] opacity-75",
                        isOutbound ? "justify-end" : "justify-start",
                      )}
                    >
                      <span>{formatMessageTime(m.createdAt)}</span>

                      {/* Status indicator for outbound */}
                      {isOutbound && (
                        <span>
                          {m.providerStatus === "delivered" || m.providerStatus === "read" ? (
                            <CheckCheck className="size-3 text-white" aria-label="Delivered" />
                          ) : m.providerStatus === "sent" ? (
                            <Check className="size-3 text-white/80" aria-label="Sent" />
                          ) : (
                            <Clock className="size-3 text-white/60" aria-label="Queued" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. Interactive Message Composer */}
      <footer className="border-t border-border bg-card p-3">
        {sendError && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Message failed to send</p>
              <p className="mt-0.5">{sendError}</p>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-destructive/70 hover:text-destructive"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={isSending}
            placeholder={`Reply to ${contactName} on WhatsApp...`}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            aria-label={`Reply to ${contactName} on WhatsApp`}
            maxLength={4000}
          />
          <Button
            type="submit"
            disabled={isSending || !inputText.trim()}
            size="sm"
            className="h-9 gap-1.5 px-4 text-xs font-medium"
            aria-label="Send WhatsApp message"
          >
            {isSending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Sends custom WhatsApp text</span>
            <button
              type="button"
              onClick={handleSendReminder}
              disabled={isSending}
              className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors"
              title="Send approved WhatsApp template outside 24h window"
            >
              <Calendar className="size-3" /> Send Appointment Template
            </button>
          </div>
          <span>{inputText.length}/4000</span>
        </div>
      </footer>
    </section>
  );
}
