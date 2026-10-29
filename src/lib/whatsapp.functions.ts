// Server functions for WhatsApp Conversations & Messages inbox.
// Guarded by requireSupabaseAuth, role validation, and tenant isolation.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getConversationDetailInput,
  listConversationsInput,
  markConversationReadInput,
} from "./whatsapp";
import {
  getWhatsAppConversationDetailForUser,
  listWhatsAppConversationsForUser,
  markWhatsAppConversationReadForUser,
} from "./whatsapp.server";

/**
 * Lists WhatsApp conversations for the authenticated user within their organization.
 */
export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listConversationsInput.parse(d))
  .handler(async ({ data, context }) => {
    return await listWhatsAppConversationsForUser({
      userId: context.userId,
      search: data.search,
      filter: data.filter,
      page: data.page,
      pageSize: data.pageSize,
    });
  });

/**
 * Retrieves full details and message history for a conversation.
 */
export const getWhatsAppConversationDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => getConversationDetailInput.parse(d))
  .handler(async ({ data, context }) => {
    return await getWhatsAppConversationDetailForUser({
      userId: context.userId,
      conversationId: data.conversationId,
      page: data.page,
      pageSize: data.pageSize,
    });
  });

/**
 * Marks a conversation as read (resets unread_count to 0).
 */
export const markWhatsAppConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => markConversationReadInput.parse(d))
  .handler(async ({ data, context }) => {
    return await markWhatsAppConversationReadForUser({
      userId: context.userId,
      conversationId: data.conversationId,
    });
  });

