// Server functions for WhatsApp Conversations & Messages inbox.
// Guarded by requireSupabaseAuth, role validation, and tenant isolation.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getConversationDetailInput,
  getSeniorWhatsAppSummaryInput,
  linkSeniorWhatsAppIdentityInput,
  listConversationsInput,
  markConversationReadInput,
  sendWhatsAppMessageInput,
  syncWhatsAppMessagesInput,
} from "./whatsapp";
import {
  getSeniorWhatsAppSummaryForUser,
  getWhatsAppConversationDetailForUser,
  linkSeniorWhatsAppIdentityForUser,
  listWhatsAppConversationsForUser,
  markWhatsAppConversationReadForUser,
  sendOutboundWhatsAppMessage,
  syncTwilioWhatsAppMessages,
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

/**
 * Sends a real outbound WhatsApp message to the contact in a conversation.
 */
export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendWhatsAppMessageInput.parse(d))
  .handler(async ({ data, context }) => {
    return await sendOutboundWhatsAppMessage({
      userId: context.userId,
      conversationId: data.conversationId,
      bodyText: data.bodyText,
      contentSid: data.contentSid,
      contentVariables: data.contentVariables,
    });
  });

/**
 * Synchronizes recent messages from Twilio REST API into Sahaara's database.
 */
export const syncWhatsAppMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => syncWhatsAppMessagesInput.parse(d))
  .handler(async ({ data, context }) => {
    return await syncTwilioWhatsAppMessages({
      userId: context.userId,
      limit: data.limit,
    });
  });

/**
 * Retrieves the WhatsApp summary (identities, conversation, messages) for a Senior.
 */
export const getSeniorWhatsAppSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => getSeniorWhatsAppSummaryInput.parse(d))
  .handler(async ({ data, context }) => {
    return await getSeniorWhatsAppSummaryForUser({
      userId: context.userId,
      seniorId: data.seniorId,
    });
  });

/**
 * Links a WhatsApp phone number to a senior.
 */
export const linkSeniorWhatsAppIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => linkSeniorWhatsAppIdentityInput.parse(d))
  .handler(async ({ data, context }) => {
    return await linkSeniorWhatsAppIdentityForUser({
      userId: context.userId,
      seniorId: data.seniorId,
      phoneNumber: data.phoneNumber,
      displayName: data.displayName,
      relationshipType: data.relationshipType,
    });
  });
