import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox, MessageCircleOff, MessagesSquare, PlugZap, ShieldCheck } from "lucide-react";

import { Page } from "@/components/shell/page";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Sahaara" },
      { name: "description", content: "Conversations with seniors and families." },
      { property: "og:title", content: "Messages — Sahaara" },
      { property: "og:description", content: "Conversations with seniors and families." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Messages,
});

/**
 * Messaging is not connected. This page states that honestly and shows the
 * layout conversations will use; it never shows sample conversations.
 */
function Messages() {
  return (
    <Page
      breadcrumbs={[{ label: "Messages" }]}
      title="Messages"
      description="Conversations with seniors and their families will appear here."
    >
      <Notice tone="info" title="Messaging is not connected">
        No messaging service (such as WhatsApp) is set up for your organisation, so no messages are
        sent or received. Until then, record what people tell you as a written report or voice note
        on the senior's profile.
      </Notice>

      <div className="surface grid min-h-[26rem] overflow-hidden md:grid-cols-[18rem_minmax(0,1fr)]">
        <aside
          aria-label="Conversations"
          className="flex flex-col border-b border-border md:border-b-0 md:border-r"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-semibold">Conversations</h2>
            <span className="text-data ml-auto text-sm text-muted-foreground">0</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageCircleOff className="size-6" aria-hidden="true" />
            No conversations
          </div>
        </aside>
        <section
          aria-label="Conversation"
          className="flex flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
            <MessagesSquare className="size-6" aria-hidden="true" />
          </span>
          <div className="max-w-md">
            <h2 className="text-section">Nothing to show yet</h2>
            <p className="mt-1 text-muted-foreground">
              Once messaging is connected, each conversation will show the contact, the linked
              senior, consent status, message history and delivery state.
            </p>
          </div>
          <ul className="flex flex-col gap-2 text-left text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <PlugZap className="size-4 shrink-0" aria-hidden="true" /> Requires a connected
              messaging provider
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> Contacts must consent
              before they are messaged
            </li>
          </ul>
          <Button asChild variant="outline">
            <Link to="/seniors">Go to seniors</Link>
          </Button>
        </section>
      </div>
    </Page>
  );
}
