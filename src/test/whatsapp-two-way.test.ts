import { describe, expect, it } from "vitest";
import {
  sendOutboundWhatsAppMessage,
  syncTwilioWhatsAppMessages,
  getSeniorWhatsAppSummaryForUser,
  linkSeniorWhatsAppIdentityForUser,
  type TwilioLikeClient,
} from "@/lib/whatsapp.server";

describe("Phase: Real Two-Way WhatsApp Messaging", () => {
  const orgId = "7e570000-0000-4000-8000-0000000000a1";
  const userId = "b6a65591-e29c-4f63-acf4-b3ccdc977fdb";
  const seniorId = "d93cf59e-228c-5bc1-92b7-6680782a0b03";
  const convId = "c89a17ee-f19d-4112-b6a6-3395ffff0295";

  // -------------------------------------------------------------------------
  // 1. Outbound Sending & Audit
  // -------------------------------------------------------------------------
  describe("Outbound Sending & Delivery Audit", () => {
    it("persists outbound messages, updates preview, and writes audit transition", async () => {
      const insertedMessages: any[] = [];
      const updatedConversations: any[] = [];
      const auditTransitions: any[] = [];

      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "organization_members") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { org_id: orgId },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "user_roles") {
            return {
              select: () => ({
                eq: async () => ({
                  data: [{ role: "coordinator" }],
                  error: null,
                }),
              }),
            };
          }
          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: convId,
                      org_id: orgId,
                      phone_number: "+917037917794",
                      senior_id: seniorId,
                      whatsapp_identity_id: "ident-1",
                      whatsapp_identities: {
                        id: "ident-1",
                        status: "active",
                        consent_status: "granted",
                        phone_number: "+917037917794",
                      },
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => ({
                eq: async (col: string, val: string) => {
                  updatedConversations.push({ col, val, patch });
                  return { error: null };
                },
              }),
            };
          }
          if (table === "whatsapp_messages") {
            return {
              insert: (row: any) => {
                const inserted = {
                  id: "msg_outbound_1",
                  ...row,
                  created_at: new Date().toISOString(),
                };
                insertedMessages.push(inserted);
                return {
                  select: () => ({
                    single: async () => ({
                      data: inserted,
                      error: null,
                    }),
                  }),
                };
              },
            };
          }
          if (table === "whatsapp_audit_transitions") {
            return {
              insert: async (row: any) => {
                auditTransitions.push(row);
                return { error: null };
              },
            };
          }
          return {};
        },
      };

      const mockTwilio: TwilioLikeClient = {
        messages: {
          create: async () => ({
            sid: "SM_test_tw_123",
            status: "delivered",
          }),
        },
      };

      const res = await sendOutboundWhatsAppMessage(
        {
          userId,
          conversationId: convId,
          bodyText: "Dr. Sharma's checkup is confirmed for tomorrow morning at 10 AM.",
        },
        mockAdmin,
        mockTwilio,
      );

      expect(res.providerMessageSid).toBe("SM_test_tw_123");
      expect(res.direction).toBe("outbound");
      expect(res.bodyText).toBe("Dr. Sharma's checkup is confirmed for tomorrow morning at 10 AM.");

      // Check DB persistence
      expect(insertedMessages.length).toBe(1);
      expect(insertedMessages[0].provider_message_sid).toBe("SM_test_tw_123");
      expect(insertedMessages[0].direction).toBe("outbound");

      // Check conversation preview update
      expect(updatedConversations.length).toBe(1);
      expect(updatedConversations[0].patch.last_message_preview).toContain("Dr. Sharma");

      // Check audit log
      expect(auditTransitions.length).toBe(1);
      expect(auditTransitions[0].triggered_by).toBe("coordinator_outbound");
      expect(auditTransitions[0].to_status).toBe("delivered");
    });

    it("rejects sending outbound message if contact consent is withdrawn (Care Safety)", async () => {
      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "organization_members") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { org_id: orgId }, error: null }),
                }),
              }),
            };
          }
          if (table === "user_roles") {
            return {
              select: () => ({
                eq: async () => ({ data: [{ role: "coordinator" }], error: null }),
              }),
            };
          }
          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: convId,
                      org_id: orgId,
                      phone_number: "+917037917794",
                      senior_id: seniorId,
                      whatsapp_identity_id: "ident-1",
                      whatsapp_identities: {
                        id: "ident-1",
                        status: "active",
                        consent_status: "withdrawn", // Withdrawn consent!
                        phone_number: "+917037917794",
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };

      await expect(
        sendOutboundWhatsAppMessage(
          {
            userId,
            conversationId: convId,
            bodyText: "Test message",
          },
          mockAdmin,
        ),
      ).rejects.toThrow("withdrawn WhatsApp communication consent");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Direct Twilio Sync & Ingestion
  // -------------------------------------------------------------------------
  describe("Twilio Message Sync & Deduplication", () => {
    it("idempotently syncs inbound and outbound messages from Twilio", async () => {
      const existingSids = new Set(["SM_existing_1"]);
      const persistedMessages: any[] = [];

      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "whatsapp_messages") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: async () => ({
                    data: existingSids.has(val) ? { id: "msg_existing" } : null,
                    error: null,
                  }),
                }),
              }),
              insert: (row: any) => {
                persistedMessages.push(row);
                return {
                  select: () => ({
                    single: async () => ({ data: { id: "new_" + row.provider_message_sid }, error: null }),
                  }),
                };
              },
            };
          }
          if (table === "whatsapp_identities") {
            const identData = [
              {
                id: "ident-1",
                org_id: orgId,
                senior_id: seniorId,
                phone_number: "+917037917794",
                user_id: null,
                relationship_type: "family_member",
                status: "active",
                consent_status: "granted",
              },
            ];
            return {
              select: () => {
                const queryObj: any = {
                  eq: () => queryObj,
                  maybeSingle: async () => ({ data: identData[0], error: null }),
                  then: (resolve: any) => resolve({ data: identData, error: null }),
                };
                return queryObj;
              },
              insert: (row: any) => ({
                select: () => ({
                  single: async () => ({ data: { id: "ident-1", ...row }, error: null }),
                }),
              }),
            };
          }
          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: convId, unread_count: 0 },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          }
          if (table === "whatsapp_audit_transitions") {
            return {
              insert: async () => ({ error: null }),
            };
          }
          if (table === "organizations") {
            return {
              select: () => ({
                limit: async () => ({ data: [{ id: orgId }], error: null }),
              }),
            };
          }
          return {};
        },
      };

      const mockTwilio: TwilioLikeClient = {
        messages: {
          create: async () => ({ sid: "SM_test" }),
          list: async () => [
            {
              sid: "SM_existing_1", // Should be skipped (deduplicated)
              from: "whatsapp:+917037917794",
              to: "whatsapp:+17372508034",
              body: "Old message",
              direction: "inbound",
              status: "received",
            },
            {
              sid: "SM_new_2", // Should be persisted
              from: "whatsapp:+917037917794",
              to: "whatsapp:+17372508034",
              body: "How is Arjun feeling today?",
              direction: "inbound",
              status: "received",
            },
          ],
        },
      };

      const syncResult = await syncTwilioWhatsAppMessages(
        { limit: 10 },
        mockAdmin,
        mockTwilio,
      );

      expect(syncResult.syncedCount).toBe(2);
      expect(syncResult.newMessages).toBe(1);
      expect(persistedMessages.length).toBe(1);
      expect(persistedMessages[0].provider_message_sid).toBe("SM_new_2");
      expect(persistedMessages[0].body_text).toBe("How is Arjun feeling today?");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Senior Profile WhatsApp Integration
  // -------------------------------------------------------------------------
  describe("Senior Profile WhatsApp Summary & Link", () => {
    it("retrieves the WhatsApp summary, linked identities and messages for a Senior", async () => {
      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "organization_members") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { org_id: orgId }, error: null }),
                }),
              }),
            };
          }
          if (table === "seniors") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: seniorId,
                      org_id: orgId,
                      display_name: "Synthetic Arjun 0004",
                      record_code: "S2C23-0004",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "whatsapp_identities") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [
                      {
                        id: "ident-1",
                        phone_number: "+917037917794",
                        display_name: "Aryan (Family Member)",
                        relationship_type: "family_member",
                        status: "active",
                        consent_status: "granted",
                        verified_at: "2026-10-29T15:00:00Z",
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: {
                            id: convId,
                            org_id: orgId,
                            phone_number: "+917037917794",
                            status: "active",
                            last_message_at: "2026-10-29T15:20:00Z",
                            last_message_preview: "Thank you for the update!",
                            unread_count: 0,
                            whatsapp_identities: {
                              id: "ident-1",
                              display_name: "Aryan (Family Member)",
                              relationship_type: "family_member",
                              status: "active",
                              consent_status: "granted",
                              verified_at: "2026-10-29T15:00:00Z",
                            },
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "whatsapp_messages") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          id: "m1",
                          conversation_id: convId,
                          provider_message_sid: "SM1",
                          direction: "inbound",
                          from_number: "+917037917794",
                          to_number: "+17372508034",
                          message_type: "text",
                          body_text: "Thank you for the update!",
                          media_meta: {},
                          provider_status: "received",
                          processing_status: "processed",
                          created_at: "2026-10-29T15:20:00Z",
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };

      const summary = await getSeniorWhatsAppSummaryForUser(
        { userId, seniorId },
        mockAdmin,
      );

      expect(summary.senior.displayName).toBe("Synthetic Arjun 0004");
      expect(summary.identities.length).toBe(1);
      expect(summary.identities[0]!.maskedPhoneNumber).toBe("+91 ••••• •7794");
      expect(summary.conversation?.lastMessagePreview).toBe("Thank you for the update!");
      expect(summary.recentMessages.length).toBe(1);
      expect(summary.recentMessages[0]!.bodyText).toBe("Thank you for the update!");
    });

    it("allows a coordinator to link a new WhatsApp identity to a senior", async () => {
      let createdIdent: any = null;
      let createdConv: any = null;

      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "organization_members") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { org_id: orgId }, error: null }),
                }),
              }),
            };
          }
          if (table === "user_roles") {
            return {
              select: () => ({
                eq: async () => ({ data: [{ role: "coordinator" }], error: null }),
              }),
            };
          }
          if (table === "seniors") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: seniorId, org_id: orgId }, error: null }),
                }),
              }),
            };
          }
          if (table === "whatsapp_identities") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
              insert: (row: any) => {
                createdIdent = { id: "ident_created_1", ...row };
                return {
                  select: () => ({
                    single: async () => ({ data: createdIdent, error: null }),
                  }),
                };
              },
            };
          }
          if (table === "whatsapp_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              insert: (row: any) => {
                createdConv = { id: "conv_created_1", ...row };
                return {
                  select: () => ({
                    single: async () => ({ data: createdConv, error: null }),
                  }),
                };
              },
            };
          }
          return {};
        },
      };

      const res = await linkSeniorWhatsAppIdentityForUser(
        {
          userId,
          seniorId,
          phoneNumber: "+919999988888",
          displayName: "Dr. Verma (Caregiver)",
          relationshipType: "caregiver",
        },
        mockAdmin,
      );

      expect(res.identityId).toBe("ident_created_1");
      expect(res.conversationId).toBe("conv_created_1");
      expect(createdIdent.relationship_type).toBe("caregiver");
      expect(createdIdent.status).toBe("active");
      expect(createdConv.senior_id).toBe(seniorId);
    });
  });
});
