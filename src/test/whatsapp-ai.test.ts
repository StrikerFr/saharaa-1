import { describe, expect, it } from "vitest";
import {
  classifyInboundWhatsAppIntent,
  fallbackRuleBasedIntent,
  processInboundWhatsAppMessageAI,
} from "@/lib/whatsapp-ai.server";
import {
  sendOutboundWhatsAppMessage,
} from "@/lib/whatsapp.server";

describe("Phase: WhatsApp Dynamic Outbound Messaging & Groq AI", () => {
  const orgId = "7e570000-0000-4000-8000-0000000000a1";
  const userId = "b6a65591-e29c-4f63-acf4-b3ccdc977fdb";
  const seniorId = "d93cf59e-228c-5bc1-92b7-6680782a0b03";
  const convId = "c89a17ee-f19d-4112-b6a6-3395ffff0295";

  const createMockAdmin = () => ({
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
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "whatsapp_messages") {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "msg_outbound_1",
                  ...row,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "whatsapp_audit_transitions") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  });

  describe("1. Dynamic Outbound Sending Fix", () => {
    it("sends free-form text as body without injecting template ContentSid", async () => {
      let createdPayload: any = null;
      const mockTwilio = {
        messages: {
          create: async (params: any) => {
            createdPayload = params;
            return {
              sid: "SM_test_dynamic_123",
              status: "sent",
              dateCreated: new Date(),
            };
          },
        },
      };

      const result = await sendOutboundWhatsAppMessage(
        {
          userId,
          conversationId: convId,
          bodyText: "Hello Mrs. Sharma, how are you feeling this afternoon?",
          // No contentSid provided
        },
        createMockAdmin() as any,
        mockTwilio,
      );

      expect(result.id).toBe("msg_outbound_1");
      expect(result.bodyText).toBe("Hello Mrs. Sharma, how are you feeling this afternoon?");
      expect(createdPayload).not.toBeNull();
      expect(createdPayload.body).toBe("Hello Mrs. Sharma, how are you feeling this afternoon?");
      expect(createdPayload.contentSid).toBeUndefined();
    });

    it("sends template ContentSid when explicitly requested by reminder action", async () => {
      let createdPayload: any = null;
      const mockTwilio = {
        messages: {
          create: async (params: any) => {
            createdPayload = params;
            return {
              sid: "SM_test_template_456",
              status: "sent",
              dateCreated: new Date(),
            };
          },
        },
      };

      const result = await sendOutboundWhatsAppMessage(
        {
          userId,
          conversationId: convId,
          bodyText: "Appointment Reminder",
          contentSid: "HXfe5ab5f00277942d4d4200328b4d403c",
        },
        createMockAdmin() as any,
        mockTwilio,
      );

      expect(result.id).toBe("msg_outbound_1");
      expect(createdPayload).not.toBeNull();
      expect(createdPayload.contentSid).toBe("HXfe5ab5f00277942d4d4200328b4d403c");
    });

    it("rejects empty or whitespace-only messages", async () => {
      await expect(
        sendOutboundWhatsAppMessage(
          {
            userId,
            conversationId: convId,
            bodyText: "    ",
          },
          createMockAdmin() as any,
          null,
        ),
      ).rejects.toThrow("Message body cannot be empty");
    });
  });

  describe("2. Multilingual Clinical Intent Classification", () => {
    it("interprets Hinglish medication update 'Dawai le li'", async () => {
      const intent = fallbackRuleBasedIntent("Dawai le li");
      expect(intent.category).toBe("routine_update");
      expect(intent.language).toBe("hinglish");
      expect(intent.routineDetail?.action).toBe("done");
      expect(intent.routineDetail?.itemHint).toBe("medicine");
    });

    it("interprets Hinglish elevated blood pressure 'BP 160/40 hai'", async () => {
      const intent = fallbackRuleBasedIntent("BP 160/40 hai");
      expect(intent.category).toBe("vital_or_symptom");
      expect(intent.vitalDetail?.type).toBe("blood_pressure");
      expect(intent.vitalDetail?.systolic).toBe(160);
      expect(intent.vitalDetail?.diastolic).toBe(40);
    });

    it("interprets acute emergency symptoms with urgent priority", async () => {
      const intent = fallbackRuleBasedIntent("Severe chest pain and sudden breathing difficulty");
      expect(intent.category).toBe("emergency");
      expect(intent.isEmergency).toBe(true);
    });

    it("interprets Hinglish symptom 'Mujhe chakkar aa rahe hain'", async () => {
      const intent = fallbackRuleBasedIntent("Mujhe chakkar aa rahe hain");
      expect(intent.category).toBe("vital_or_symptom");
      expect(intent.vitalDetail?.symptom).toContain("chakkar");
    });

    it("interprets coordinator callback request", async () => {
      const intent = fallbackRuleBasedIntent("Please have the coordinator call me urgently");
      expect(intent.category).toBe("coordinator_request");
    });
  });

  describe("3. End-to-End Clinical Safety & Inbound AI Execution", () => {
    it("safely handles unlinked phone numbers without exposing senior data", async () => {
      let replySentText = "";
      const mockTwilio = {
        messages: {
          create: async (params: any) => {
            replySentText = params.body;
            return { sid: "SM_test_unlinked", status: "sent" };
          },
        },
      };

      const mockAdmin: any = {
        from: () => ({
          insert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }),
      };

      const result = await processInboundWhatsAppMessageAI(
        {
          messageId: "msg_1",
          providerSid: "SM_inbound_1",
          fromNumber: "+919999999999",
          toNumber: "+17372508034",
          bodyText: "What is the status?",
          conversationId: "conv_unlinked",
          orgId,
          seniorId: null, // Unknown/unlinked
          identityId: "ident_unlinked",
        },
        mockAdmin,
        mockTwilio,
      );

      expect(result.handled).toBe(true);
      expect(result.replySent).toBe(true);
      expect(replySentText).toContain("not currently linked to an active senior profile");
    });

    it("logs routine with source 'whatsapp' on medication confirmation", async () => {
      let routineLogPayload: any = null;
      let replyBody = "";

      const mockTwilio = {
        messages: {
          create: async (params: any) => {
            replyBody = params.body;
            return { sid: "SM_test_routine", status: "sent" };
          },
        },
      };

      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "seniors") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "sen_1",
                      display_name: "Savitri Devi",
                      time_zone: "Asia/Kolkata",
                    },
                  }),
                }),
              }),
            };
          }
          if (table === "care_routine_items") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [
                      {
                        id: "item_morning_meds",
                        category: "medication",
                        title: "Morning Blood Pressure Medicine",
                        scheduled_time: "08:00:00",
                        days_of_week: [1, 2, 3, 4, 5, 6, 7],
                        active: true,
                      },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "care_routine_logs") {
            return {
              insert: async (payload: any) => {
                routineLogPayload = payload;
                return { error: null };
              },
            };
          }
          return {
            insert: async () => ({ error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        },
      };

      const result = await processInboundWhatsAppMessageAI(
        {
          messageId: "msg_2",
          providerSid: "SM_inbound_routine",
          fromNumber: "+917037917794",
          toNumber: "+17372508034",
          bodyText: "Dawai le li",
          conversationId: "conv_1",
          orgId,
          seniorId: "sen_1",
          identityId: "ident_1",
        },
        mockAdmin,
        mockTwilio,
      );

      expect(result.handled).toBe(true);
      expect(result.routineLogged).toBe(true);
      expect(routineLogPayload).not.toBeNull();
      expect(routineLogPayload.item_id).toBe("item_morning_meds");
      expect(routineLogPayload.status).toBe("done");
      expect(routineLogPayload.source).toBe("whatsapp");
      expect(replyBody).toContain("Aapka update record kar liya gaya hai");
    });

    it("elevated BP 160/40 creates candidate cues in care_reports pending review and alerts coordinator", async () => {
      let cuePayload: any = null;
      let taskPayload: any = null;
      let replyBody = "";

      const mockTwilio = {
        messages: {
          create: async (params: any) => {
            replyBody = params.body;
            return { sid: "SM_test_bp", status: "sent" };
          },
        },
      };

      const mockAdmin: any = {
        from: (table: string) => {
          if (table === "seniors") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "sen_1",
                      display_name: "Savitri Devi",
                      time_zone: "Asia/Kolkata",
                    },
                  }),
                }),
              }),
            };
          }
          if (table === "care_routine_items") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ data: [] }),
                }),
              }),
            };
          }
          if (table === "care_reports") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({ data: { id: "report_bp_123" } }),
                }),
              }),
            };
          }
          if (table === "report_cues") {
            return {
              insert: async (payload: any) => {
                cuePayload = payload;
                return { error: null };
              },
            };
          }
          if (table === "follow_up_tasks") {
            return {
              insert: async (payload: any) => {
                taskPayload = payload;
                return { error: null };
              },
            };
          }
          return {
            insert: async () => ({ error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        },
      };

      const result = await processInboundWhatsAppMessageAI(
        {
          messageId: "msg_3",
          providerSid: "SM_inbound_bp",
          fromNumber: "+917037917794",
          toNumber: "+17372508034",
          bodyText: "BP 160/40 hai",
          conversationId: "conv_1",
          orgId,
          seniorId: "sen_1",
          identityId: "ident_1",
        },
        mockAdmin,
        mockTwilio,
      );

      expect(result.handled).toBe(true);
      expect(result.alertRaised).toBe(true);
      expect(result.reportCreated).toBe(true);

      // Verify clinical safety: cue is pending_review, NOT direct truth
      expect(cuePayload).not.toBeNull();
      expect(cuePayload.review_status).toBe("pending_review");
      expect(cuePayload.cue.statedMeasurement).toEqual({
        value: 160,
        unit: "mmHg",
        subvalue: 40,
      });

      // Verify elevated BP coordinator task
      expect(taskPayload).not.toBeNull();
      expect(taskPayload.title).toContain("Elevated vital reported");
      expect(taskPayload.notes).toContain("Prompt review recommended");

      // Verify reply contains resting advice and coordinator notification
      expect(replyBody).toContain("Yeh reading elevated hai");
      expect(replyBody).toContain("care coordinator ko prompt review ke liye notify");
    });
  });
});
