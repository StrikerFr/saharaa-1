import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessagesSquare } from "lucide-react";

import { CareAccessGate } from "@/components/seniors/access-gate";
import { Page } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { ConversationList } from "@/components/messages/conversation-list";
import { ConversationView } from "@/components/messages/conversation-view";
import { supabase } from "@/integrations/supabase/client";
import {
  getWhatsAppConversationDetail,
  listWhatsAppConversations,
  markWhatsAppConversationRead,
} from "@/lib/whatsapp.functions";
import type { ConversationFilterType } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Sahaara" },
      {
        name: "description",
        content:
          "Real-time WhatsApp conversations and care coordination updates with seniors and families.",
      },
      { property: "og:title", content: "Messages — Sahaara" },
      {
        property: "og:description",
        content:
          "Real-time WhatsApp conversations and care coordination updates with seniors and families.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MessagesRoutePage,
});

function MessagesRoutePage() {
  const { user } = Route.useRouteContext();

  return (
    <Page
      eyebrow="Communications"
      title="Messages"
      description="Live WhatsApp conversations with seniors and families. Inbound updates are synchronized automatically in real time."
    >
      <CareAccessGate userId={user.id}>{() => <MessagesInbox />}</CareAccessGate>
    </Page>
  );
}

function MessagesInbox() {
  const queryClient = useQueryClient();
  const listConversationsFn = useServerFn(listWhatsAppConversations);
  const getConversationDetailFn = useServerFn(getWhatsAppConversationDetail);
  const markReadFn = useServerFn(markWhatsAppConversationRead);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConversationFilterType>("all");
  const [search, setSearch] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // 1. Fetch Conversations with bounded 5s polling
  const conversationsQuery = useQuery({
    queryKey: ["whatsapp-conversations", filter, search],
    queryFn: () => listConversationsFn({ data: { filter, search, page: 0, pageSize: 50 } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data?.conversations],
  );
  const unreadTotal = conversationsQuery.data?.unreadTotal ?? 0;

  // Auto-select first conversation if none selected on desktop
  useEffect(() => {
    if (!selectedId && conversations.length > 0 && window.innerWidth >= 768) {
      setSelectedId(conversations[0]?.id ?? null);
    }
  }, [conversations, selectedId]);

  // 2. Fetch Selected Conversation Detail & Messages
  const detailQuery = useQuery({
    queryKey: ["whatsapp-conversation-detail", selectedId],
    queryFn: () =>
      selectedId
        ? getConversationDetailFn({ data: { conversationId: selectedId, page: 0, pageSize: 100 } })
        : null,
    enabled: !!selectedId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const selectedConversation = detailQuery.data?.conversation ?? null;
  const messages = detailQuery.data?.messages ?? [];
  const totalMessages = detailQuery.data?.totalMessages ?? 0;

  // 3. Mark Conversation as Read when opened with unread count
  useEffect(() => {
    if (selectedId && selectedConversation && selectedConversation.unreadCount > 0) {
      markReadFn({ data: { conversationId: selectedId } })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        })
        .catch(() => {
          // Non-blocking error handling
        });
    }
  }, [selectedId, selectedConversation, markReadFn, queryClient]);

  // 4. Live Updates: Supabase Realtime channel with cleanup
  useEffect(() => {
    if (!supabase || typeof supabase.channel !== "function") return;

    const channel = supabase
      .channel("whatsapp_inbox_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        if (selectedId) {
          queryClient.invalidateQueries({
            queryKey: ["whatsapp-conversation-detail", selectedId],
          });
        }
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, selectedId]);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  };

  const handleBackToList = () => {
    setMobileView("list");
  };

  if (conversationsQuery.isError) {
    return (
      <Notice tone="critical" title="Failed to load conversations">
        <div className="mt-2 flex items-center gap-3">
          <span>
            {conversationsQuery.error instanceof Error
              ? conversationsQuery.error.message
              : "An error occurred."}
          </span>
          <button
            type="button"
            onClick={() => conversationsQuery.refetch()}
            className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </Notice>
    );
  }

  return (
    <div className="surface grid min-h-[34rem] h-[calc(100vh-14rem)] overflow-hidden rounded-xl border border-border shadow-xs md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* Left Pane (Conversations List) */}
      <div
        className={cn(
          "h-full overflow-hidden",
          mobileView === "detail" ? "hidden md:block" : "block",
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={handleSelectConversation}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          isLoading={conversationsQuery.isLoading}
          isFetching={conversationsQuery.isFetching}
          onRefresh={() => conversationsQuery.refetch()}
          unreadTotal={unreadTotal}
        />
      </div>

      {/* Main Pane (Selected Conversation View) */}
      <div
        className={cn(
          "h-full overflow-hidden",
          mobileView === "list" ? "hidden md:block" : "block",
        )}
      >
        <ConversationView
          conversation={selectedConversation}
          messages={messages}
          isLoading={detailQuery.isLoading}
          isFetching={detailQuery.isFetching}
          onRefresh={() => detailQuery.refetch()}
          onBackToList={handleBackToList}
          totalMessages={totalMessages}
        />
      </div>
    </div>
  );
}
