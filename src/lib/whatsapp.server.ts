// Server-only WhatsApp management: inbound persistence, idempotency, audit, and inbox queries.
// Never exposes secrets or patient health data. All queries respect multi-tenant org isolation.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import twilio from "twilio";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  maskPhoneNumber,
  resolvePhoneIdentity,
  type ConversationFilterType,
  type WhatsAppIdentityRecord,
} from "./whatsapp";

/**
 * Creates an admin Supabase client using server-only credentials.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> | null {
  const url =
    process.env["SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    "https://jiqvjuquxrsglradhhpo.supabase.co";
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SAHAARA_SERVICE_ROLE_KEY"];
  if (!key) {
    return null;
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface InboundMessageParams {
  providerSid: string;
  fromNumber: string;
  toNumber: string;
  bodyText: string;
  mediaMeta?: Record<string, Json> | undefined;
  profileName?: string | null | undefined;
  payloadChecksum?: string | undefined;
}

export interface PersistInboundResult {
  messageId: string;
  conversationId: string;
  isDuplicate: boolean;
}

/**
 * Persists an inbound WhatsApp message idempotently with full identity resolution,
 * audit transition, and conversation preview update.
 */
export async function persistInboundWhatsAppMessage(
  params: InboundMessageParams,
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<PersistInboundResult> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    if (process.env["NODE_ENV"] === "test") {
      return {
        messageId: "test_msg_" + params.providerSid.slice(0, 16),
        conversationId: "test_conv_id",
        isDuplicate: false,
      };
    }
    throw new Error("Database service client is not configured on this server");
  }

  const {
    providerSid,
    fromNumber,
    toNumber,
    bodyText,
    mediaMeta = {},
    profileName = null,
    payloadChecksum,
  } = params;

  // 1. Idempotency Check: deduplicate using Twilio provider_message_sid
  const { data: existingMsg, error: existingErr } = await admin
    .from("whatsapp_messages" as never)
    .select("id, conversation_id" as never)
    .eq("provider_message_sid", providerSid)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Database error checking duplicate message: ${existingErr.message}`);
  }

  if (existingMsg) {
    const existing = existingMsg as { id: string; conversation_id: string };
    // Record duplicate transition for idempotency audit
    await admin.from("whatsapp_audit_transitions" as never).insert({
      message_id: existing.id,
      provider_message_sid: providerSid,
      from_status: "received",
      to_status: "duplicate",
      triggered_by: "webhook_inbound",
      details: { reason: "idempotent_duplicate_sid" },
    } as never);

    return {
      messageId: existing.id,
      conversationId: existing.conversation_id,
      isDuplicate: true,
    };
  }

  // 2. Identity Resolution
  // Query all identities for this phone number
  const { data: identityRows, error: idErr } = await admin
    .from("whatsapp_identities" as never)
    .select(
      "id, org_id, phone_number, senior_id, user_id, relationship_type, status, consent_status" as never,
    )
    .eq("phone_number", fromNumber);

  if (idErr) {
    throw new Error(`Database error querying phone identity: ${idErr.message}`);
  }

  const rawIdentities = (identityRows || []) as Array<{
    id: string;
    org_id: string;
    phone_number: string;
    senior_id: string | null;
    user_id: string | null;
    relationship_type: string;
    status: string;
    consent_status: string;
  }>;

  const identityRecords: WhatsAppIdentityRecord[] = rawIdentities.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    phoneNumber: r.phone_number,
    seniorId: r.senior_id,
    userId: r.user_id,
    relationshipType: r.relationship_type as WhatsAppIdentityRecord["relationshipType"],
    status: r.status as WhatsAppIdentityRecord["status"],
    consentStatus: r.consent_status as WhatsAppIdentityRecord["consentStatus"],
  }));

  const resolution = resolvePhoneIdentity(identityRecords);

  let targetOrgId: string;
  let targetSeniorId: string | null = null;
  let targetIdentityId: string;
  let isAmbiguous = false;

  if (resolution.status === "unique_match") {
    targetOrgId = resolution.identity.orgId;
    targetSeniorId = resolution.identity.seniorId;
    targetIdentityId = resolution.identity.id;
  } else if (resolution.status === "ambiguous") {
    const firstCand = resolution.candidates[0]!;
    targetOrgId = firstCand.orgId;
    targetIdentityId = firstCand.id;
    // CRITICAL CARE-SAFETY RULE: ambiguous phone NEVER auto-links senior data
    targetSeniorId = null;
    isAmbiguous = true;
  } else {
    // resolution.status === "no_active_identity" (pending, not_found, revoked, or consent_withdrawn)
    targetSeniorId = null;

    if (identityRecords.length > 0 && identityRecords[0]) {
      targetOrgId = identityRecords[0].orgId;
      targetIdentityId = identityRecords[0].id;
    } else {
      // Find default organization (primary active org in database)
      const { data: orgs } = await admin
        .from("organizations" as never)
        .select("id" as never)
        .limit(1);

      const orgList = orgs as Array<{ id: string }> | null;
      targetOrgId =
        orgList && orgList[0]?.id ? orgList[0].id : "7e570000-0000-4000-8000-0000000000a1"; // Fallback to Demo Cohort org

      // Create pending identity so the message is not dropped
      const { data: createdIdent, error: createIdentErr } = await admin
        .from("whatsapp_identities" as never)
        .insert({
          org_id: targetOrgId,
          phone_number: fromNumber,
          display_name: profileName || "Unverified Sender",
          relationship_type: "other",
          status: "pending",
          verification_method: "coordinator_manual",
          consent_status: "pending",
        } as never)
        .select("id" as never)
        .single();

      if (createIdentErr || !createdIdent) {
        throw new Error(
          `Failed to register pending identity for inbound sender: ${createIdentErr?.message}`,
        );
      }

      targetIdentityId = (createdIdent as { id: string }).id;
    }
  }

  // 3. Find or Create Conversation
  const { data: existingConv } = await admin
    .from("whatsapp_conversations" as never)
    .select("id, unread_count" as never)
    .eq("whatsapp_identity_id", targetIdentityId)
    .maybeSingle();

  let conversationId: string;
  const preview = (bodyText || "").slice(0, 150);

  if (existingConv) {
    const conv = existingConv as { id: string; unread_count: number };
    conversationId = conv.id;

    // Update conversation metadata
    await admin
      .from("whatsapp_conversations" as never)
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        unread_count: (conv.unread_count || 0) + 1,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", conversationId);
  } else {
    // Insert new conversation
    const { data: newConv, error: newConvErr } = await admin
      .from("whatsapp_conversations" as never)
      .insert({
        org_id: targetOrgId,
        whatsapp_identity_id: targetIdentityId,
        senior_id: targetSeniorId,
        phone_number: fromNumber,
        status: "active",
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        unread_count: 1,
      } as never)
      .select("id" as never)
      .single();

    if (newConvErr || !newConv) {
      throw new Error(`Failed to create conversation: ${newConvErr?.message}`);
    }

    conversationId = (newConv as { id: string }).id;
  }

  // 4. Insert Message
  const hasMedia = Object.keys(mediaMeta).length > 0;
  const messageType = hasMedia ? "image" : "text";

  const { data: insertedMsg, error: msgErr } = await admin
    .from("whatsapp_messages" as never)
    .insert({
      org_id: targetOrgId,
      conversation_id: conversationId,
      whatsapp_identity_id: targetIdentityId,
      provider_message_sid: providerSid,
      direction: "inbound",
      from_number: fromNumber,
      to_number: toNumber,
      message_type: messageType,
      body_text: bodyText,
      media_meta: mediaMeta,
      provider_status: "received",
      processing_status: "pending",
      raw_payload_checksum: payloadChecksum || null,
    } as never)
    .select("id" as never)
    .single();

  if (msgErr || !insertedMsg) {
    throw new Error(`Failed to persist inbound message: ${msgErr?.message}`);
  }

  const messageId = (insertedMsg as { id: string }).id;

  // 5. Append-Only Audit Transition
  await admin.from("whatsapp_audit_transitions" as never).insert({
    message_id: messageId,
    provider_message_sid: providerSid,
    from_status: "none",
    to_status: "received",
    triggered_by: "webhook_inbound",
    details: {
      from: fromNumber,
      has_senior: !!targetSeniorId,
      is_ambiguous: isAmbiguous,
    },
  } as never);

  return {
    messageId,
    conversationId,
    isDuplicate: false,
  };
}

export interface ConversationSummary {
  id: string;
  orgId: string;
  phoneNumber: string;
  maskedPhoneNumber: string;
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  identity: {
    id: string;
    displayName: string | null;
    relationshipType: string;
    status: string;
    consentStatus: string;
    verifiedAt: string | null;
  } | null;
  senior: {
    id: string;
    displayName: string;
    recordCode: string;
  } | null;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  providerMessageSid: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  messageType: string;
  bodyText: string | null;
  mediaMeta: Record<string, Json>;
  providerStatus: string;
  processingStatus: string;
  createdAt: string;
}

/**
 * Lists WhatsApp conversations accessible to the given authenticated user.
 * Enforces organization boundary and role-based access.
 */
export async function listWhatsAppConversationsForUser(
  params: {
    userId: string;
    search?: string | undefined;
    filter?: ConversationFilterType | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<{
  conversations: ConversationSummary[];
  total: number;
  unreadTotal: number;
}> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, search = "", filter = "all", page = 0, pageSize = 30 } = params;

  // Verify user organization
  const { data: member, error: memErr } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr || !member) {
    throw new Error("Forbidden: User is not assigned to an organization");
  }

  const userOrgId = (member as { org_id: string }).org_id;

  // Verify roles
  const { data: roles } = await admin
    .from("user_roles" as never)
    .select("role" as never)
    .eq("user_id", userId);

  const roleList = (roles || []) as Array<{ role: string }>;
  const isCareStaff = roleList.some((r) => r.role === "coordinator" || r.role === "admin");

  let query = admin
    .from("whatsapp_conversations" as never)
    .select("*, whatsapp_identities(*), seniors(id, display_name, record_code)", { count: "exact" })
    .eq("org_id", userOrgId);

  // If family user: restricted to seniors they are explicitly linked to
  if (!isCareStaff) {
    const { data: famSeniors } = await admin
      .from("senior_family_members" as never)
      .select("senior_id" as never)
      .eq("user_id", userId);

    const seniorIds = ((famSeniors || []) as Array<{ senior_id: string }>).map((s) => s.senior_id);

    if (seniorIds.length === 0) {
      return { conversations: [], total: 0, unreadTotal: 0 };
    }
    query = query.in("senior_id", seniorIds);
  }

  // Filter application
  if (filter === "unread") {
    query = query.gt("unread_count", 0);
  } else if (filter === "authorized") {
    query = query.not("senior_id", "is", null);
  } else if (filter === "pending") {
    query = query.is("senior_id", null);
  }

  // Order by most recent activity
  query = query.order("last_message_at", { ascending: false, nullsFirst: false });

  // Pagination
  const fromIndex = page * pageSize;
  const toIndex = fromIndex + pageSize - 1;
  query = query.range(fromIndex, toIndex);

  const { data: rows, count, error: qErr } = await query;
  if (qErr) {
    throw new Error(`Failed to query conversations: ${qErr.message}`);
  }

  const rawRows = (rows || []) as Array<{
    id: string;
    org_id: string;
    phone_number: string;
    status: string;
    last_message_at: string | null;
    last_message_preview: string | null;
    unread_count: number;
    whatsapp_identities: {
      id: string;
      display_name: string | null;
      relationship_type: string;
      status: string;
      consent_status: string;
      verified_at: string | null;
    } | null;
    seniors: {
      id: string;
      display_name: string;
      record_code: string;
    } | null;
  }>;

  // Compute total unread across the user's accessible conversations in this org
  const { data: unreadRows } = await admin
    .from("whatsapp_conversations" as never)
    .select("unread_count" as never)
    .eq("org_id", userOrgId)
    .gt("unread_count", 0);

  const unreadTotal = ((unreadRows || []) as Array<{ unread_count: number }>).reduce(
    (sum, r) => sum + (r.unread_count || 0),
    0,
  );

  let mapped: ConversationSummary[] = rawRows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    phoneNumber: r.phone_number,
    maskedPhoneNumber: maskPhoneNumber(r.phone_number),
    status: r.status,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    unreadCount: r.unread_count ?? 0,
    identity: r.whatsapp_identities
      ? {
          id: r.whatsapp_identities.id,
          displayName: r.whatsapp_identities.display_name,
          relationshipType: r.whatsapp_identities.relationship_type,
          status: r.whatsapp_identities.status,
          consentStatus: r.whatsapp_identities.consent_status,
          verifiedAt: r.whatsapp_identities.verified_at,
        }
      : null,
    senior: r.seniors
      ? {
          id: r.seniors.id,
          displayName: r.seniors.display_name,
          recordCode: r.seniors.record_code,
        }
      : null,
  }));

  // In-memory search filtering when search query is provided
  if (search.trim().length > 0) {
    const s = search.trim().toLowerCase();
    mapped = mapped.filter((c) => {
      return (
        c.phoneNumber.toLowerCase().includes(s) ||
        (c.lastMessagePreview && c.lastMessagePreview.toLowerCase().includes(s)) ||
        (c.identity?.displayName && c.identity.displayName.toLowerCase().includes(s)) ||
        (c.senior?.displayName && c.senior.displayName.toLowerCase().includes(s)) ||
        (c.senior?.recordCode && c.senior.recordCode.toLowerCase().includes(s))
      );
    });
  }

  return {
    conversations: mapped,
    total: count ?? mapped.length,
    unreadTotal,
  };
}

/**
 * Retrieves the messages and details for a selected conversation,
 * verifying authorization.
 */
export async function getWhatsAppConversationDetailForUser(
  params: {
    userId: string;
    conversationId: string;
    page?: number | undefined;
    pageSize?: number | undefined;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<{
  conversation: ConversationSummary;
  messages: MessageItem[];
  totalMessages: number;
}> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, conversationId, page = 0, pageSize = 50 } = params;

  // Verify caller's organization
  const { data: member } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    throw new Error("Forbidden: User does not belong to an organization");
  }

  const userOrgId = (member as { org_id: string }).org_id;

  // Fetch conversation with identity and senior
  const { data: convRow, error: cErr } = await admin
    .from("whatsapp_conversations" as never)
    .select("*, whatsapp_identities(*), seniors(id, display_name, record_code)")
    .eq("id", conversationId)
    .maybeSingle();

  if (cErr || !convRow) {
    throw new Error("Conversation not found");
  }

  const r = convRow as {
    id: string;
    org_id: string;
    phone_number: string;
    status: string;
    last_message_at: string | null;
    last_message_preview: string | null;
    unread_count: number;
    whatsapp_identities: {
      id: string;
      display_name: string | null;
      relationship_type: string;
      status: string;
      consent_status: string;
      verified_at: string | null;
    } | null;
    seniors: {
      id: string;
      display_name: string;
      record_code: string;
    } | null;
  };

  // Enforce tenant boundary
  if (r.org_id !== userOrgId) {
    throw new Error("Forbidden: Cannot access conversations from another organization");
  }

  const conversation: ConversationSummary = {
    id: r.id,
    orgId: r.org_id,
    phoneNumber: r.phone_number,
    maskedPhoneNumber: maskPhoneNumber(r.phone_number),
    status: r.status,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    unreadCount: r.unread_count ?? 0,
    identity: r.whatsapp_identities
      ? {
          id: r.whatsapp_identities.id,
          displayName: r.whatsapp_identities.display_name,
          relationshipType: r.whatsapp_identities.relationship_type,
          status: r.whatsapp_identities.status,
          consentStatus: r.whatsapp_identities.consent_status,
          verifiedAt: r.whatsapp_identities.verified_at,
        }
      : null,
    senior: r.seniors
      ? {
          id: r.seniors.id,
          displayName: r.seniors.display_name,
          recordCode: r.seniors.record_code,
        }
      : null,
  };

  // Fetch messages with pagination (ordered chronologically)
  const fromIndex = page * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  const {
    data: msgRows,
    count: msgCount,
    error: mErr,
  } = await admin
    .from("whatsapp_messages" as never)
    .select("*", { count: "exact" })
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .range(fromIndex, toIndex);

  if (mErr) {
    throw new Error(`Failed to load messages: ${mErr.message}`);
  }

  const messages: MessageItem[] = (
    (msgRows || []) as Array<{
      id: string;
      conversation_id: string;
      provider_message_sid: string;
      direction: "inbound" | "outbound";
      from_number: string;
      to_number: string;
      message_type: string;
      body_text: string | null;
      media_meta: Record<string, Json>;
      provider_status: string;
      processing_status: string;
      created_at: string;
    }>
  ).map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    providerMessageSid: m.provider_message_sid,
    direction: m.direction,
    fromNumber: m.from_number,
    toNumber: m.to_number,
    messageType: m.message_type,
    bodyText: m.body_text,
    mediaMeta: (m.media_meta ?? {}) as Record<string, Json>,
    providerStatus: m.provider_status,
    processingStatus: m.processing_status,
    createdAt: m.created_at,
  }));

  return {
    conversation,
    messages,
    totalMessages: msgCount ?? messages.length,
  };
}

/**
 * Marks an authorized conversation as read (sets unread_count = 0).
 */
export async function markWhatsAppConversationReadForUser(
  params: {
    userId: string;
    conversationId: string;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<{ success: boolean }> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, conversationId } = params;

  // Verify caller's organization
  const { data: member } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    throw new Error("Forbidden: User does not belong to an organization");
  }

  const userOrgId = (member as { org_id: string }).org_id;

  const { error } = await admin
    .from("whatsapp_conversations" as never)
    .update({ unread_count: 0, updated_at: new Date().toISOString() } as never)
    .eq("id", conversationId)
    .eq("org_id", userOrgId);

  if (error) {
    throw new Error(`Failed to mark conversation as read: ${error.message}`);
  }

  return { success: true };
}

export interface TwilioLikeClient {
  messages: {
    create: (params: {
      from: string;
      to: string;
      body?: string;
      contentSid?: string;
      contentVariables?: string;
    }) => Promise<{ sid: string; status?: string }>;
    list?: (params?: { limit?: number }) => Promise<
      Array<{
        sid: string;
        from: string;
        to: string;
        body: string | null;
        direction: string;
        status: string;
        dateCreated?: Date | string | null;
      }>
    >;
  };
}

export interface SendOutboundParams {
  userId: string;
  conversationId: string;
  bodyText: string;
  contentSid?: string | undefined;
  contentVariables?: Record<string, string> | undefined;
}

/**
 * Sends a real outbound WhatsApp message to an authorized recipient,
 * persists it in whatsapp_messages, updates the conversation, and logs an audit transition.
 */
export async function sendOutboundWhatsAppMessage(
  params: SendOutboundParams,
  injectedAdmin?: SupabaseClient<Database> | null,
  injectedTwilioClient?: TwilioLikeClient | null,
): Promise<MessageItem> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, conversationId, bodyText, contentSid, contentVariables } = params;

  // 1. Verify caller membership and role
  const { data: member } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    throw new Error("Forbidden: User does not belong to an organization");
  }
  const userOrgId = (member as { org_id: string }).org_id;

  const { data: roles } = await admin
    .from("user_roles" as never)
    .select("role" as never)
    .eq("user_id", userId);
  const roleList = (roles || []) as Array<{ role: string }>;
  const isCareStaff = roleList.some((r) => r.role === "coordinator" || r.role === "admin");

  // 2. Load conversation
  const { data: convRow, error: cErr } = await admin
    .from("whatsapp_conversations" as never)
    .select("*, whatsapp_identities(*)")
    .eq("id", conversationId)
    .maybeSingle();

  if (cErr || !convRow) {
    throw new Error("Conversation not found");
  }

  const conv = convRow as {
    id: string;
    org_id: string;
    phone_number: string;
    senior_id: string | null;
    whatsapp_identity_id: string;
    whatsapp_identities: {
      id: string;
      status: string;
      consent_status: string;
      phone_number: string;
    } | null;
  };

  // Enforce tenant boundary
  if (conv.org_id !== userOrgId) {
    throw new Error("Forbidden: Cannot message a conversation outside your organization");
  }

  // If family user: ensure linked to senior
  if (!isCareStaff) {
    if (!conv.senior_id) {
      throw new Error("Forbidden: Family members cannot message unlinked conversations");
    }
    const { data: famSeniors } = await admin
      .from("senior_family_members" as never)
      .select("id" as never)
      .eq("user_id", userId)
      .eq("senior_id", conv.senior_id)
      .maybeSingle();

    if (!famSeniors) {
      throw new Error("Forbidden: You are not authorized for this senior");
    }
  }

  // Care safety check: ensure identity consent not withdrawn or revoked
  if (conv.whatsapp_identities) {
    if (conv.whatsapp_identities.status === "revoked") {
      throw new Error("Cannot message: This contact's WhatsApp identity has been revoked");
    }
    if (conv.whatsapp_identities.consent_status === "withdrawn") {
      throw new Error("Cannot message: This contact has withdrawn WhatsApp communication consent");
    }
  }

  // 3. Send message via Twilio API
  const twilioAccountSid = process.env["TWILIO_ACCOUNT_SID"];
  const twilioAuthToken = process.env["TWILIO_AUTH_TOKEN"];
  const twilioFrom = process.env["TWILIO_WHATSAPP_NUMBER"] || "whatsapp:+17372508034";
  const toAddress = conv.phone_number.startsWith("whatsapp:")
    ? conv.phone_number
    : `whatsapp:${conv.phone_number}`;
  const fromAddress = twilioFrom.startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`;

  let twilioSid: string;
  let twilioStatus = "sent";

  if (injectedTwilioClient) {
    const res = await injectedTwilioClient.messages.create({
      from: fromAddress,
      to: toAddress,
      body: bodyText,
    });
    twilioSid = res.sid;
    twilioStatus = res.status ?? "sent";
  } else if (process.env["NODE_ENV"] === "test") {
    twilioSid = "SM_mock_outbound_" + Date.now().toString(36);
    twilioStatus = "sent";
  } else {
    if (!twilioAccountSid || !twilioAuthToken) {
      throw new Error("Twilio credentials are not configured on this server");
    }
    const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

    try {
      const activeContentSid = contentSid || process.env["TWILIO_CONTENT_SID"];
      if (activeContentSid) {
        const res = await twilioClient.messages.create({
          from: fromAddress,
          to: toAddress,
          contentSid: activeContentSid,
          contentVariables: JSON.stringify(contentVariables || { 1: bodyText }),
        });
        twilioSid = res.sid;
        twilioStatus = res.status ?? "sent";
      } else {
        const res = await twilioClient.messages.create({
          from: fromAddress,
          to: toAddress,
          body: bodyText,
        });
        twilioSid = res.sid;
        twilioStatus = res.status ?? "sent";
      }
    } catch (twilioErr: unknown) {
      const errObj = twilioErr as { code?: number; message?: string } | null;
      if (errObj?.code === 21654) {
        throw new Error(
          "Twilio trial sender requires an approved Content Template SID (Error 21654). Please configure TWILIO_CONTENT_SID with your trial template SID in environment.",
        );
      }
      throw new Error(
        `Twilio send failed (${errObj?.code || "unknown"}): ${errObj?.message || String(twilioErr)}`,
      );
    }
  }

  // 4. Persist outbound message
  const { data: insertedMsg, error: msgErr } = await admin
    .from("whatsapp_messages" as never)
    .insert({
      org_id: conv.org_id,
      conversation_id: conv.id,
      whatsapp_identity_id: conv.whatsapp_identity_id,
      provider_message_sid: twilioSid,
      direction: "outbound",
      from_number: fromAddress.replace("whatsapp:", ""),
      to_number: toAddress.replace("whatsapp:", ""),
      message_type: "text",
      body_text: bodyText,
      media_meta: {},
      provider_status: twilioStatus,
      processing_status: "processed",
    } as never)
    .select("*" as never)
    .single();

  if (msgErr || !insertedMsg) {
    throw new Error(`Failed to record outbound message: ${msgErr?.message}`);
  }

  const rawMsg = insertedMsg as {
    id: string;
    conversation_id: string;
    provider_message_sid: string;
    direction: "inbound" | "outbound";
    from_number: string;
    to_number: string;
    message_type: string;
    body_text: string | null;
    media_meta: Record<string, Json>;
    provider_status: string;
    processing_status: string;
    created_at: string;
  };

  // 5. Update conversation metadata
  await admin
    .from("whatsapp_conversations" as never)
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: bodyText.slice(0, 150),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", conv.id);

  // 6. Audit Transition
  await admin.from("whatsapp_audit_transitions" as never).insert({
    message_id: rawMsg.id,
    provider_message_sid: twilioSid,
    from_status: "none",
    to_status: twilioStatus,
    triggered_by: "coordinator_outbound",
    details: {
      actor_id: userId,
      to: toAddress,
    },
  } as never);

  return {
    id: rawMsg.id,
    conversationId: rawMsg.conversation_id,
    providerMessageSid: rawMsg.provider_message_sid,
    direction: rawMsg.direction,
    fromNumber: rawMsg.from_number,
    toNumber: rawMsg.to_number,
    messageType: rawMsg.message_type,
    bodyText: rawMsg.body_text,
    mediaMeta: (rawMsg.media_meta ?? {}) as Record<string, Json>,
    providerStatus: rawMsg.provider_status,
    processingStatus: rawMsg.processing_status,
    createdAt: rawMsg.created_at,
  };
}

/**
 * Synchronizes recent messages directly from Twilio's REST API into the local database,
 * making messaging reliable even when webhooks are pending or dropped.
 */
export async function syncTwilioWhatsAppMessages(
  params: {
    userId?: string | undefined;
    limit?: number | undefined;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
  injectedTwilioClient?: TwilioLikeClient | null,
): Promise<{ syncedCount: number; newMessages: number }> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    return { syncedCount: 0, newMessages: 0 };
  }

  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  if (!injectedTwilioClient && (!accountSid || !authToken)) {
    return { syncedCount: 0, newMessages: 0 };
  }

  const client = (injectedTwilioClient ??
    (accountSid && authToken ? twilio(accountSid, authToken) : null)) as TwilioLikeClient | null;
  if (!client) {
    return { syncedCount: 0, newMessages: 0 };
  }
  const limit = params.limit ?? 30;

  let messages: Array<{
    sid: string;
    from: string;
    to: string;
    body: string | null;
    direction: string;
    status: string;
    dateCreated?: Date | string | null;
  }> = [];
  try {
    if (client.messages.list) {
      messages = await client.messages.list({ limit });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("Failed to fetch Twilio messages for sync:", errMsg);
    return { syncedCount: 0, newMessages: 0 };
  }

  let newMessages = 0;
  // Iterate chronologically (oldest first)
  const sorted = [...messages].reverse();

  for (const m of sorted) {
    const sid = m.sid;
    if (!sid) continue;

    // Check if already in db
    const { data: existing } = await admin
      .from("whatsapp_messages" as never)
      .select("id" as never)
      .eq("provider_message_sid", sid)
      .maybeSingle();

    if (existing) continue;

    const fromNum = (m.from || "").replace("whatsapp:", "");
    const toNum = (m.to || "").replace("whatsapp:", "");
    const isOutbound = m.direction === "outbound-api" || m.direction === "outbound-reply";

    if (!isOutbound) {
      try {
        await persistInboundWhatsAppMessage(
          {
            providerSid: sid,
            fromNumber: fromNum,
            toNumber: toNum,
            bodyText: m.body || "",
          },
          admin,
        );
        newMessages++;
      } catch (e) {
        console.warn("Failed to sync inbound message:", sid, e);
      }
    } else {
      // Outbound sync
      const recipientPhone = toNum;
      // Find identity for recipient
      const { data: idRow } = await admin
        .from("whatsapp_identities" as never)
        .select("id, org_id, senior_id" as never)
        .eq("phone_number", recipientPhone)
        .maybeSingle();

      let targetOrgId = "7e570000-0000-4000-8000-0000000000a1";
      let targetIdentId: string | null = null;

      if (idRow) {
        const idObj = idRow as { id: string; org_id: string; senior_id: string | null };
        targetOrgId = idObj.org_id;
        targetIdentId = idObj.id;
      }

      // Find conversation
      let convId: string | null = null;
      if (targetIdentId) {
        const { data: convRow } = await admin
          .from("whatsapp_conversations" as never)
          .select("id" as never)
          .eq("whatsapp_identity_id", targetIdentId)
          .maybeSingle();

        if (convRow) {
          convId = (convRow as { id: string }).id;
        }
      }

      if (convId && targetIdentId) {
        const { data: insMsg } = await admin
          .from("whatsapp_messages" as never)
          .insert({
            org_id: targetOrgId,
            conversation_id: convId,
            whatsapp_identity_id: targetIdentId,
            provider_message_sid: sid,
            direction: "outbound",
            from_number: fromNum,
            to_number: toNum,
            message_type: "text",
            body_text: m.body || "",
            media_meta: {},
            provider_status: m.status || "delivered",
            processing_status: "processed",
            created_at: m.dateCreated
              ? new Date(m.dateCreated).toISOString()
              : new Date().toISOString(),
          } as never)
          .select("id" as never)
          .single();

        if (insMsg) {
          newMessages++;
          await admin
            .from("whatsapp_conversations" as never)
            .update({
              last_message_at: m.dateCreated
                ? new Date(m.dateCreated).toISOString()
                : new Date().toISOString(),
              last_message_preview: (m.body || "").slice(0, 150),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", convId);
        }
      }
    }
  }

  return { syncedCount: sorted.length, newMessages };
}

/**
 * Retrieves the WhatsApp summary for a given senior:
 * linked identities, primary conversation, and recent messages.
 */
export async function getSeniorWhatsAppSummaryForUser(
  params: {
    userId: string;
    seniorId: string;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<{
  senior: { id: string; displayName: string; recordCode: string };
  identities: Array<{
    id: string;
    phoneNumber: string;
    maskedPhoneNumber: string;
    displayName: string | null;
    relationshipType: string;
    status: string;
    consentStatus: string;
    verifiedAt: string | null;
  }>;
  conversation: ConversationSummary | null;
  recentMessages: MessageItem[];
}> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, seniorId } = params;

  // 1. Verify user organization
  const { data: member } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    throw new Error("Forbidden: User does not belong to an organization");
  }
  const userOrgId = (member as { org_id: string }).org_id;

  // 2. Fetch senior
  const { data: seniorRow, error: sErr } = await admin
    .from("seniors" as never)
    .select("id, org_id, display_name, record_code" as never)
    .eq("id", seniorId)
    .maybeSingle();

  if (sErr || !seniorRow) {
    throw new Error("Senior not found");
  }
  const senior = seniorRow as {
    id: string;
    org_id: string;
    display_name: string;
    record_code: string;
  };

  if (senior.org_id !== userOrgId) {
    throw new Error("Forbidden: Senior belongs to another organization");
  }

  // 3. Fetch linked WhatsApp identities
  const { data: idRows } = await admin
    .from("whatsapp_identities" as never)
    .select(
      "id, phone_number, display_name, relationship_type, status, consent_status, verified_at" as never,
    )
    .eq("senior_id", seniorId)
    .eq("org_id", userOrgId);

  const rawIdentities = (idRows || []) as Array<{
    id: string;
    phone_number: string;
    display_name: string | null;
    relationship_type: string;
    status: string;
    consent_status: string;
    verified_at: string | null;
  }>;

  const identities = rawIdentities.map((id) => ({
    id: id.id,
    phoneNumber: id.phone_number,
    maskedPhoneNumber: maskPhoneNumber(id.phone_number),
    displayName: id.display_name,
    relationshipType: id.relationship_type,
    status: id.status,
    consentStatus: id.consent_status,
    verifiedAt: id.verified_at,
  }));

  // 4. Fetch conversation if any
  const { data: convRow } = await admin
    .from("whatsapp_conversations" as never)
    .select("*, whatsapp_identities(*), seniors(id, display_name, record_code)")
    .eq("senior_id", seniorId)
    .eq("org_id", userOrgId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  let conversation: ConversationSummary | null = null;
  let recentMessages: MessageItem[] = [];

  if (convRow) {
    const c = convRow as {
      id: string;
      org_id: string;
      phone_number: string;
      status: string;
      last_message_at: string | null;
      last_message_preview: string | null;
      unread_count: number | null;
      whatsapp_identities: {
        id: string;
        display_name: string | null;
        relationship_type: string;
        status: string;
        consent_status: string;
        verified_at: string | null;
      } | null;
    };
    conversation = {
      id: c.id,
      orgId: c.org_id,
      phoneNumber: c.phone_number,
      maskedPhoneNumber: maskPhoneNumber(c.phone_number),
      status: c.status,
      lastMessageAt: c.last_message_at,
      lastMessagePreview: c.last_message_preview,
      unreadCount: c.unread_count ?? 0,
      identity: c.whatsapp_identities
        ? {
            id: c.whatsapp_identities.id,
            displayName: c.whatsapp_identities.display_name,
            relationshipType: c.whatsapp_identities.relationship_type,
            status: c.whatsapp_identities.status,
            consentStatus: c.whatsapp_identities.consent_status,
            verifiedAt: c.whatsapp_identities.verified_at,
          }
        : null,
      senior: {
        id: senior.id,
        displayName: senior.display_name,
        recordCode: senior.record_code,
      },
    };

    // Load recent 50 messages
    const { data: msgRows } = await admin
      .from("whatsapp_messages" as never)
      .select("*")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true })
      .limit(50);

    const rawMsgs = (msgRows || []) as Array<{
      id: string;
      conversation_id: string;
      provider_message_sid: string;
      direction: "inbound" | "outbound";
      from_number: string;
      to_number: string;
      message_type: string;
      body_text: string | null;
      media_meta: Record<string, Json> | null;
      provider_status: string;
      processing_status: string;
      created_at: string;
    }>;

    recentMessages = rawMsgs.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      providerMessageSid: m.provider_message_sid,
      direction: m.direction,
      fromNumber: m.from_number,
      toNumber: m.to_number,
      messageType: m.message_type,
      bodyText: m.body_text,
      mediaMeta: (m.media_meta ?? {}) as Record<string, Json>,
      providerStatus: m.provider_status,
      processingStatus: m.processing_status,
      createdAt: m.created_at,
    }));
  }

  return {
    senior: {
      id: senior.id,
      displayName: senior.display_name,
      recordCode: senior.record_code,
    },
    identities,
    conversation,
    recentMessages,
  };
}

/**
 * Links a verified WhatsApp phone identity and conversation to a Senior.
 * Authorized for coordinators and administrators.
 */
export async function linkSeniorWhatsAppIdentityForUser(
  params: {
    userId: string;
    seniorId: string;
    phoneNumber: string;
    displayName: string;
    relationshipType: string;
  },
  injectedAdmin?: SupabaseClient<Database> | null,
): Promise<{ identityId: string; conversationId: string }> {
  const admin = injectedAdmin ?? getSupabaseAdmin();
  if (!admin) {
    throw new Error("Database service client is not configured");
  }

  const { userId, seniorId, phoneNumber, displayName, relationshipType } = params;

  // 1. Verify organization and role
  const { data: member } = await admin
    .from("organization_members" as never)
    .select("org_id" as never)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    throw new Error("Forbidden: User does not belong to an organization");
  }
  const userOrgId = (member as { org_id: string }).org_id;

  const { data: roles } = await admin
    .from("user_roles" as never)
    .select("role" as never)
    .eq("user_id", userId);
  const roleList = (roles || []) as Array<{ role: string }>;
  const isCareStaff = roleList.some((r) => r.role === "coordinator" || r.role === "admin");

  if (!isCareStaff) {
    throw new Error("Forbidden: Only coordinators and administrators can link WhatsApp numbers");
  }

  // 2. Verify senior exists in org
  const { data: seniorRow } = await admin
    .from("seniors" as never)
    .select("id, org_id" as never)
    .eq("id", seniorId)
    .maybeSingle();

  if (!seniorRow || (seniorRow as { org_id: string }).org_id !== userOrgId) {
    throw new Error("Senior not found in your organization");
  }

  // 3. Check for existing identity
  const { data: existingIdent } = await admin
    .from("whatsapp_identities" as never)
    .select("id" as never)
    .eq("phone_number", phoneNumber)
    .eq("org_id", userOrgId)
    .maybeSingle();

  let identityId: string;
  if (existingIdent) {
    identityId = (existingIdent as { id: string }).id;
    await admin
      .from("whatsapp_identities" as never)
      .update({
        senior_id: seniorId,
        display_name: displayName,
        relationship_type: relationshipType,
        status: "active",
        consent_status: "granted",
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", identityId);
  } else {
    const { data: newIdent, error: idErr } = await admin
      .from("whatsapp_identities" as never)
      .insert({
        org_id: userOrgId,
        phone_number: phoneNumber,
        senior_id: seniorId,
        display_name: displayName,
        relationship_type: relationshipType,
        status: "active",
        consent_status: "granted",
        verification_method: "coordinator_manual",
        verified_at: new Date().toISOString(),
      } as never)
      .select("id" as never)
      .single();

    if (idErr || !newIdent) {
      throw new Error(`Failed to create WhatsApp identity: ${idErr?.message}`);
    }
    identityId = (newIdent as { id: string }).id;
  }

  // 4. Find or create conversation
  const { data: existingConv } = await admin
    .from("whatsapp_conversations" as never)
    .select("id" as never)
    .eq("whatsapp_identity_id", identityId)
    .maybeSingle();

  let conversationId: string;
  if (existingConv) {
    conversationId = (existingConv as { id: string }).id;
    await admin
      .from("whatsapp_conversations" as never)
      .update({
        senior_id: seniorId,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: cErr } = await admin
      .from("whatsapp_conversations" as never)
      .insert({
        org_id: userOrgId,
        whatsapp_identity_id: identityId,
        senior_id: seniorId,
        phone_number: phoneNumber,
        status: "active",
        unread_count: 0,
      } as never)
      .select("id" as never)
      .single();

    if (cErr || !newConv) {
      throw new Error(`Failed to create conversation: ${cErr?.message}`);
    }
    conversationId = (newConv as { id: string }).id;
  }

  return { identityId, conversationId };
}
