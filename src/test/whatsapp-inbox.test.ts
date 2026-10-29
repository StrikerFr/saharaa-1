import { describe, expect, it } from "vitest";
import { maskPhoneNumber, resolvePhoneIdentity, type WhatsAppIdentityRecord } from "@/lib/whatsapp";
import { persistInboundWhatsAppMessage, type InboundMessageParams } from "@/lib/whatsapp.server";

describe("Phase: Real WhatsApp Inbox Integration", () => {
  // -------------------------------------------------------------------------
  // 1. Phone Number Privacy Masking
  // -------------------------------------------------------------------------
  describe("Phone Number Privacy Masking", () => {
    it("masks Indian E.164 phone numbers showing country code and last 4 digits", () => {
      const masked = maskPhoneNumber("+919876543210");
      expect(masked).toBe("+91 ••••• •3210");
    });

    it("masks US E.164 phone numbers showing country code and last 4 digits", () => {
      const masked = maskPhoneNumber("+14155238886");
      expect(masked).toBe("+1 ••••• •8886");
    });

    it("handles UK E.164 phone numbers", () => {
      const masked = maskPhoneNumber("+447911123456");
      expect(masked).toBe("+44 ••••• •3456");
    });

    it("falls back safely for malformed or short input", () => {
      expect(maskPhoneNumber("")).toBe("••••");
      expect(maskPhoneNumber("123")).toBe("••••");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Identity Resolution & Care-Safety Boundary
  // -------------------------------------------------------------------------
  describe("Identity Resolution & Care-Safety", () => {
    const orgId = "7e570000-0000-4000-8000-0000000000a1";
    const seniorId1 = "11111111-1111-4000-8000-000000000001";
    const seniorId2 = "22222222-2222-4000-8000-000000000002";

    it("uniquely matches an active, consented phone number to the correct senior", () => {
      const records: WhatsAppIdentityRecord[] = [
        {
          id: "id-1",
          orgId,
          phoneNumber: "+919876543210",
          seniorId: seniorId1,
          userId: null,
          relationshipType: "family_member",
          status: "active",
          consentStatus: "granted",
        },
      ];

      const res = resolvePhoneIdentity(records);
      expect(res.status).toBe("unique_match");
      if (res.status === "unique_match") {
        expect(res.identity.seniorId).toBe(seniorId1);
        expect(res.identity.relationshipType).toBe("family_member");
      }
    });

    it("safely flags ambiguous shared phones without auto-linking senior data", () => {
      // Shared phone across two seniors (e.g. joint caregiver or shared family phone)
      const records: WhatsAppIdentityRecord[] = [
        {
          id: "id-1",
          orgId,
          phoneNumber: "+919876543210",
          seniorId: seniorId1,
          userId: null,
          relationshipType: "family_member",
          status: "active",
          consentStatus: "granted",
        },
        {
          id: "id-2",
          orgId,
          phoneNumber: "+919876543210",
          seniorId: seniorId2,
          userId: null,
          relationshipType: "family_member",
          status: "active",
          consentStatus: "granted",
        },
      ];

      const res = resolvePhoneIdentity(records);
      expect(res.status).toBe("ambiguous");
      if (res.status === "ambiguous") {
        expect(res.candidates.length).toBe(2);
        expect(res.message).toContain("Disambiguation");
      }
    });

    it("detects unverified or pending phone numbers", () => {
      const records: WhatsAppIdentityRecord[] = [
        {
          id: "id-1",
          orgId,
          phoneNumber: "+919876543210",
          seniorId: seniorId1,
          userId: null,
          relationshipType: "other",
          status: "pending",
          consentStatus: "pending",
        },
      ];

      const res = resolvePhoneIdentity(records);
      expect(res.status).toBe("no_active_identity");
      if (res.status === "no_active_identity") {
        expect(res.reason).toBe("pending");
      }
    });

    it("respects withdrawn consent and blocks access", () => {
      const records: WhatsAppIdentityRecord[] = [
        {
          id: "id-1",
          orgId,
          phoneNumber: "+919876543210",
          seniorId: seniorId1,
          userId: null,
          relationshipType: "family_member",
          status: "active",
          consentStatus: "withdrawn",
        },
      ];

      const res = resolvePhoneIdentity(records);
      expect(res.status).toBe("no_active_identity");
      if (res.status === "no_active_identity") {
        expect(res.reason).toBe("consent_withdrawn");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Inbound Persistence & Idempotency
  // -------------------------------------------------------------------------
  describe("Inbound Persistence & Idempotency", () => {
    const orgId = "7e570000-0000-4000-8000-0000000000a1";
    const testSeniorId = "11111111-1111-4000-8000-000000000001";

    function createMockSupabaseAdmin(options?: {
      hasDuplicate?: boolean;
      existingIdentities?: Array<Record<string, unknown>>;
      shouldFailOnInsert?: boolean;
    }) {
      const existingMsg = options?.hasDuplicate
        ? { id: "msg-existing-123", conversation_id: "conv-existing-123" }
        : null;

      const identities = options?.existingIdentities ?? [
        {
          id: "ident-1",
          org_id: orgId,
          phone_number: "+919876543210",
          senior_id: testSeniorId,
          user_id: null,
          relationship_type: "family_member",
          status: "active",
          consent_status: "granted",
        },
      ];

      const insertedAuditTransitions: Array<Record<string, unknown>> = [];
      const insertedMessages: Array<Record<string, unknown>> = [];
      const updatedConversations: Array<Record<string, unknown>> = [];

      const mockClient = {
        from: (table: string) => {
          if (table === "whatsapp_messages") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: async () => ({
                    data: existingMsg,
                    error: null,
                  }),
                }),
              }),
              insert: (record: Record<string, unknown>) => {
                if (options?.shouldFailOnInsert) {
                  return {
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { message: "Database connection lost" },
                      }),
                    }),
                  };
                }
                insertedMessages.push(record);
                return {
                  select: () => ({
                    single: async () => ({
                      data: { id: "msg-new-456" },
                      error: null,
                    }),
                  }),
                };
              },
            };
          }

          if (table === "whatsapp_identities") {
            return {
              select: () => ({
                eq: (col: string, val: string) =>
                  Promise.resolve({
                    data: identities,
                    error: null,
                  }),
              }),
              insert: (record: Record<string, unknown>) => ({
                select: () => ({
                  single: async () => ({
                    data: { id: "ident-created-789", org_id: orgId },
                    error: null,
                  }),
                }),
              }),
            };
          }

          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: async () => ({
                    data: { id: "conv-789", unread_count: 2 },
                    error: null,
                  }),
                }),
              }),
              update: (record: Record<string, unknown>) => {
                updatedConversations.push(record);
                return {
                  eq: () => Promise.resolve({ error: null }),
                };
              },
              insert: (record: Record<string, unknown>) => ({
                select: () => ({
                  single: async () => ({
                    data: { id: "conv-created-999" },
                    error: null,
                  }),
                }),
              }),
            };
          }

          if (table === "whatsapp_audit_transitions") {
            return {
              insert: async (record: Record<string, unknown>) => {
                insertedAuditTransitions.push(record);
                return { error: null };
              },
            };
          }

          if (table === "organizations") {
            return {
              select: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [{ id: orgId }],
                    error: null,
                  }),
              }),
            };
          }

          return {
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
          };
        },
        _insertedAuditTransitions: insertedAuditTransitions,
        _insertedMessages: insertedMessages,
        _updatedConversations: updatedConversations,
      };

      return mockClient as unknown as import("@supabase/supabase-js").SupabaseClient;
    }

    it("persists a valid inbound message, updates conversation preview and unread count", async () => {
      const mockAdmin = createMockSupabaseAdmin();
      const params: InboundMessageParams = {
        providerSid: "SM112233445566778899aabbccddeeff",
        fromNumber: "+919876543210",
        toNumber: "+14155238886",
        bodyText: "Asha finished breakfast and took her 8:00 AM medicines.",
        payloadChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };

      const result = await persistInboundWhatsAppMessage(params, mockAdmin as never);
      expect(result.isDuplicate).toBe(false);
      expect(result.messageId).toBe("msg-new-456");
      expect(result.conversationId).toBe("conv-789");

      // Verify message insertion
      const insertedMsgs = (
        mockAdmin as unknown as { _insertedMessages: Array<Record<string, unknown>> }
      )._insertedMessages;
      expect(insertedMsgs.length).toBe(1);
      expect(insertedMsgs[0]?.["body_text"]).toBe(params.bodyText);
      expect(insertedMsgs[0]?.["from_number"]).toBe(params.fromNumber);
      expect(insertedMsgs[0]?.["direction"]).toBe("inbound");

      // Verify conversation unread count incremented
      const updatedConvs = (
        mockAdmin as unknown as { _updatedConversations: Array<Record<string, unknown>> }
      )._updatedConversations;
      expect(updatedConvs.length).toBe(1);
      expect(updatedConvs[0]?.["unread_count"]).toBe(3); // 2 + 1
      expect(updatedConvs[0]?.["last_message_preview"]).toContain("Asha finished breakfast");

      // Verify append-only audit transition
      const audits = (
        mockAdmin as unknown as { _insertedAuditTransitions: Array<Record<string, unknown>> }
      )._insertedAuditTransitions;
      expect(audits.length).toBe(1);
      expect(audits[0]?.["to_status"]).toBe("received");
    });

    it("handles duplicate MessageSid deliveries idempotently without inserting duplicate messages", async () => {
      const mockAdmin = createMockSupabaseAdmin({ hasDuplicate: true });
      const params: InboundMessageParams = {
        providerSid: "SM_DUPLICATE_TEST_SID",
        fromNumber: "+919876543210",
        toNumber: "+14155238886",
        bodyText: "Retrying message",
      };

      const result = await persistInboundWhatsAppMessage(params, mockAdmin as never);
      expect(result.isDuplicate).toBe(true);
      expect(result.messageId).toBe("msg-existing-123");

      // No duplicate message inserted
      const insertedMsgs = (
        mockAdmin as unknown as { _insertedMessages: Array<Record<string, unknown>> }
      )._insertedMessages;
      expect(insertedMsgs.length).toBe(0);

      // Audit transition records duplicate event
      const audits = (
        mockAdmin as unknown as { _insertedAuditTransitions: Array<Record<string, unknown>> }
      )._insertedAuditTransitions;
      expect(audits.length).toBe(1);
      expect(audits[0]?.["to_status"]).toBe("duplicate");
      const details = audits[0]?.["details"] as Record<string, unknown> | undefined;
      expect(details?.["reason"]).toBe("idempotent_duplicate_sid");
    });

    it("handles unknown phone numbers by creating a pending identity without leaking senior data", async () => {
      // Empty existing identities -> Unknown sender
      const mockAdmin = createMockSupabaseAdmin({ existingIdentities: [] });
      const params: InboundMessageParams = {
        providerSid: "SM_UNKNOWN_SENDER_123",
        fromNumber: "+919999888877",
        toNumber: "+14155238886",
        bodyText: "Hello, who is this?",
        profileName: "Rajesh Kumar",
      };

      const result = await persistInboundWhatsAppMessage(params, mockAdmin as never);
      expect(result.isDuplicate).toBe(false);
      expect(result.messageId).toBe("msg-new-456");

      // Audit records unknown sender without senior link
      const audits = (
        mockAdmin as unknown as { _insertedAuditTransitions: Array<Record<string, unknown>> }
      )._insertedAuditTransitions;
      expect(audits.length).toBe(1);
      const details = audits[0]?.["details"] as Record<string, unknown> | undefined;
      expect(details?.["has_senior"]).toBe(false);
    });

    it("fails closed on database error so Twilio webhook can return retryable 500", async () => {
      const mockAdmin = createMockSupabaseAdmin({ shouldFailOnInsert: true });
      const params: InboundMessageParams = {
        providerSid: "SM_FAIL_TEST",
        fromNumber: "+919876543210",
        toNumber: "+14155238886",
        bodyText: "Critical note",
      };

      await expect(persistInboundWhatsAppMessage(params, mockAdmin as never)).rejects.toThrow(
        "Failed to persist inbound message",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Inbox Authorization & Multi-Tenant Isolation
  // -------------------------------------------------------------------------
  describe("Inbox Authorization & Multi-Tenant Isolation", () => {
    const userOrgId = "7e570000-0000-4000-8000-0000000000a1";
    const otherOrgId = "d3401309-adb6-4408-a440-e56889431a8f";
    const testUserId = "user-123";

    function createMockInboxClient(options?: {
      userOrgId?: string | null;
      roles?: string[];
      conversations?: Array<Record<string, unknown>>;
      messages?: Array<Record<string, unknown>>;
      conversationOrgId?: string;
    }) {
      const userOrg = options?.userOrgId !== undefined ? options.userOrgId : userOrgId;
      const roles = options?.roles ?? ["coordinator"];
      const conversations = options?.conversations ?? [
        {
          id: "conv-1",
          org_id: userOrgId,
          phone_number: "+919876543210",
          status: "active",
          last_message_at: "2026-10-29T10:00:00Z",
          last_message_preview: "Metoprolol taken at 8:00 AM",
          unread_count: 1,
          whatsapp_identities: {
            id: "ident-1",
            display_name: "Priya Sharma",
            relationship_type: "family_member",
            status: "active",
            consent_status: "granted",
            verified_at: "2026-10-28T12:00:00Z",
          },
          seniors: {
            id: "senior-1",
            display_name: "Arjun Patel",
            record_code: "AP-101",
          },
        },
      ];

      const convOrg = options?.conversationOrgId ?? userOrgId;

      return {
        from: (table: string) => {
          if (table === "organization_members") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: userOrg ? { org_id: userOrg } : null,
                    error: null,
                  }),
                }),
              }),
            };
          }

          if (table === "user_roles") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: roles.map((r) => ({ role: r })),
                    error: null,
                  }),
              }),
            };
          }

          if (table === "whatsapp_conversations") {
            return {
              select: (_cols?: string, _opts?: { count?: string }) => {
                let filtered = [...conversations];
                const queryObj = {
                  eq: (_col: string, val: string) => {
                    filtered = filtered.filter((c) => (c as Record<string, unknown>)[_col] === val);
                    return queryObj;
                  },
                  gt: (_col: string, val: number) => {
                    filtered = filtered.filter(
                      (c) => ((c as Record<string, unknown>)[_col] as number) > val,
                    );
                    return queryObj;
                  },
                  not: () => queryObj,
                  is: () => queryObj,
                  in: () => queryObj,
                  order: () => queryObj,
                  range: () =>
                    Promise.resolve({
                      data: filtered,
                      count: filtered.length,
                      error: null,
                    }),
                  maybeSingle: async () => ({
                    data: {
                      id: "conv-test",
                      org_id: convOrg,
                      phone_number: "+919876543210",
                      status: "active",
                      last_message_at: "2026-10-29T10:00:00Z",
                      last_message_preview: "Hello test",
                      unread_count: 1,
                      whatsapp_identities: null,
                      seniors: null,
                    },
                    error: null,
                  }),
                };
                return queryObj;
              },
              update: () => ({
                eq: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
              }),
            };
          }

          if (table === "whatsapp_messages") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    range: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "m-1",
                            conversation_id: "conv-test",
                            provider_message_sid: "SM001",
                            direction: "inbound",
                            from_number: "+919876543210",
                            to_number: "+14155238886",
                            message_type: "text",
                            body_text: "First message in conversation",
                            media_meta: {},
                            provider_status: "received",
                            processing_status: "pending",
                            created_at: "2026-10-29T10:00:00Z",
                          },
                        ],
                        count: 1,
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }

          return {
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
          };
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient;
    }

    it("rejects conversation listing if user does not belong to an organization", async () => {
      const mockClient = createMockInboxClient({ userOrgId: null });
      const { listWhatsAppConversationsForUser } = await import("@/lib/whatsapp.server");

      await expect(
        listWhatsAppConversationsForUser({ userId: testUserId }, mockClient as never),
      ).rejects.toThrow("User is not assigned to an organization");
    });

    it("lists conversations scoped strictly to the caller's organization and masks phone numbers", async () => {
      const mockClient = createMockInboxClient();
      const { listWhatsAppConversationsForUser } = await import("@/lib/whatsapp.server");

      const result = await listWhatsAppConversationsForUser(
        { userId: testUserId },
        mockClient as never,
      );

      expect(result.conversations.length).toBe(1);
      const conv = result.conversations[0]!;
      expect(conv.orgId).toBe(userOrgId);
      expect(conv.maskedPhoneNumber).toBe("+91 ••••• •3210");
      expect(conv.senior?.displayName).toBe("Arjun Patel");
      expect(conv.senior?.recordCode).toBe("AP-101");
      expect(conv.identity?.displayName).toBe("Priya Sharma");
    });

    it("prevents cross-organization conversation access", async () => {
      // User is in userOrgId, but conversation belongs to otherOrgId
      const mockClient = createMockInboxClient({
        userOrgId,
        conversationOrgId: otherOrgId,
      });

      const { getWhatsAppConversationDetailForUser } = await import("@/lib/whatsapp.server");

      await expect(
        getWhatsAppConversationDetailForUser(
          { userId: testUserId, conversationId: "conv-cross-org" },
          mockClient as never,
        ),
      ).rejects.toThrow("Cannot access conversations from another organization");
    });

    it("marks conversation as read successfully", async () => {
      const mockClient = createMockInboxClient();
      const { markWhatsAppConversationReadForUser } = await import("@/lib/whatsapp.server");

      const res = await markWhatsAppConversationReadForUser(
        { userId: testUserId, conversationId: "conv-1" },
        mockClient as never,
      );

      expect(res.success).toBe(true);
    });
  });
});
