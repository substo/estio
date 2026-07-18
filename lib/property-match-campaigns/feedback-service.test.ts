import test from "node:test";
import assert from "node:assert/strict";
import {
  processActivityNotePropertyFeedback,
  processInboundPropertyFeedback,
  processTranscriptPropertyFeedback,
  shouldUseMultilingualFeedbackFallback,
} from "./feedback-service";

function feedbackDb(args: {
  inboundBody: string;
  currentLanguage?: string | null;
  previousMessages?: Array<{ id: string; body: string; createdAt: Date }>;
  properties?: Array<{
    id: string;
    reference: string | null;
    slug: string;
    externalPublicUrl: string | null;
    agentUrl: string | null;
  }>;
}) {
  return {
    message: {
      findFirst: async () => ({
        id: "msg_in",
        body: args.inboundBody,
        createdAt: new Date("2026-07-18T12:00:00.000Z"),
        conversationId: "conv_1",
        conversation: { currentLanguage: args.currentLanguage || null },
      }),
      findMany: async () => args.previousMessages || [],
    },
    property: {
      findMany: async () => args.properties || [],
    },
  };
}

test("multilingual fallback is limited to non-English language context or script", () => {
  assert.equal(shouldUseMultilingualFeedbackFallback("demasiado caro", "es"), true);
  assert.equal(shouldUseMultilingualFeedbackFallback("أريد مشاهدة العقار", null), true);
  assert.equal(shouldUseMultilingualFeedbackFallback("thanks", "en"), false);
});

test("inbound feedback uses multilingual AI only after resolving one property", async () => {
  const recorded: any[] = [];
  const classifications: any[] = [];
  const result = await processInboundPropertyFeedback({
    locationId: "loc_es",
    contactId: "contact_1",
    conversationId: "conv_1",
    messageId: "msg_in",
  }, {
    db: feedbackDb({
      inboundBody: "Es demasiado caro para mí",
      currentLanguage: "es",
      previousMessages: [{
        id: "msg_out",
        body: "Propiedad DT5115",
        createdAt: new Date("2026-07-18T11:00:00.000Z"),
      }],
      properties: [{
        id: "prop_1",
        reference: "DT5115",
        slug: "apartment-dt5115",
        externalPublicUrl: null,
        agentUrl: null,
      }],
    }),
    classifyExplicitPropertyFeedbackWithAi: async (args: any) => {
      classifications.push(args);
      return {
        status: "classified",
        confidence: 0.98,
        feedback: { eventType: "rejected", sentiment: "negative", reason: "price_rejection" },
      };
    },
    recordContactPropertyInteraction: async (interaction: any) => {
      recorded.push(interaction);
      return interaction;
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(classifications.length, 1);
  assert.equal(recorded[0].propertyId, "prop_1");
  assert.equal(recorded[0].evidence.reason, "price_rejection");
});

test("inbound feedback service records an explicit rejection tied to its DT reference", async () => {
  const recorded: any[] = [];
  const result = await processInboundPropertyFeedback({
    locationId: "loc_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    messageId: "msg_in",
  }, {
    db: feedbackDb({
      inboundBody: "DT5115 is too expensive for me",
      properties: [{
        id: "prop_1",
        reference: "DT5115",
        slug: "apartment-dt5115",
        externalPublicUrl: null,
        agentUrl: null,
      }],
    }),
    recordContactPropertyInteraction: async (interaction: any) => {
      recorded.push(interaction);
      return interaction;
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(result.propertyId, "prop_1");
  assert.equal(result.anchorSource, "inbound_message");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].eventType, "rejected");
  assert.equal(recorded[0].sentiment, "negative");
  assert.equal(recorded[0].sourceId, "msg_in");
});

test("inbound feedback service can use one recent outbound property as reply context", async () => {
  const recorded: any[] = [];
  const result = await processInboundPropertyFeedback({
    locationId: "loc_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    messageId: "msg_in",
  }, {
    db: feedbackDb({
      inboundBody: "I am interested in this one",
      previousMessages: [{
        id: "msg_out",
        body: "Here is DT5115: https://estio.co/properties/apartment-dt5115",
        createdAt: new Date("2026-07-18T11:00:00.000Z"),
      }],
      properties: [{
        id: "prop_1",
        reference: "DT5115",
        slug: "apartment-dt5115",
        externalPublicUrl: null,
        agentUrl: null,
      }],
    }),
    recordContactPropertyInteraction: async (interaction: any) => {
      recorded.push(interaction);
      return interaction;
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(result.anchorSource, "previous_outbound");
  assert.equal(recorded[0].eventType, "liked");
  assert.equal(recorded[0].evidence.anchorMessageId, "msg_out");
});

test("inbound feedback service ignores explicit feedback without resolvable property context", async () => {
  let recordCount = 0;
  const result = await processInboundPropertyFeedback({
    locationId: "loc_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    messageId: "msg_in",
  }, {
    db: feedbackDb({ inboundBody: "I am interested in this one" }),
    recordContactPropertyInteraction: async () => {
      recordCount += 1;
      return {} as any;
    },
  });

  assert.equal(result.recorded, false);
  assert.equal(result.reason, "unresolved_or_ambiguous_property_context");
  assert.equal(recordCount, 0);
});

test("activity note feedback records observed evidence for an explicit property", async () => {
  const recorded: any[] = [];
  const database = {
    contactHistory: {
      findFirst: async () => ({
        id: "history_1",
        createdAt: new Date("2026-07-18T12:00:00.000Z"),
        changes: {
          date: "2026-07-18T11:30:00.000Z",
          entry: "Client said DT5115 is too expensive.",
        },
      }),
    },
    message: { findMany: async () => [] },
    property: {
      findMany: async () => [{
        id: "prop_1",
        reference: "DT5115",
        slug: "apartment-dt5115",
        externalPublicUrl: null,
        agentUrl: null,
      }],
    },
  };
  const result = await processActivityNotePropertyFeedback({
    locationId: "loc_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    historyId: "history_1",
  }, {
    db: database,
    recordContactPropertyInteraction: async (interaction: any) => {
      recorded.push(interaction);
      return interaction;
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(result.anchorSource, "activity_note");
  assert.equal(recorded[0].sourceType, "note");
  assert.equal(recorded[0].signalStrength, "observed");
  assert.equal(recorded[0].replaceSourceInteractions, true);
});

test("editing an activity note to remove feedback clears its old interaction", async () => {
  const cleared: any[] = [];
  const result = await processActivityNotePropertyFeedback({
    locationId: "loc_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    historyId: "history_1",
  }, {
    db: {
      contactHistory: {
        findFirst: async () => ({
          id: "history_1",
          createdAt: new Date("2026-07-18T12:00:00.000Z"),
          changes: { entry: "Called client; follow up next week." },
        }),
      },
    },
    clearContactPropertyInteractionsForSource: async (args: any) => {
      cleared.push(args);
      return { count: 1 } as any;
    },
  });

  assert.equal(result.recorded, false);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].sourceType, "note");
});

test("completed inbound transcript can use recent outbound property context", async () => {
  const recorded: any[] = [];
  const result = await processTranscriptPropertyFeedback({
    locationId: "loc_1",
    transcriptId: "transcript_1",
  }, {
    db: {
      messageTranscript: {
        findFirst: async () => ({
          id: "transcript_1",
          text: "Could we arrange a viewing tomorrow?",
          completedAt: new Date("2026-07-18T12:01:00.000Z"),
          message: {
            id: "msg_voice",
            createdAt: new Date("2026-07-18T12:00:00.000Z"),
            conversationId: "conv_1",
            conversation: { contactId: "contact_1" },
          },
        }),
      },
      message: {
        findMany: async () => [{
          id: "msg_out",
          body: "Here is DT5115",
          createdAt: new Date("2026-07-18T11:00:00.000Z"),
        }],
      },
      property: {
        findMany: async () => [{
          id: "prop_1",
          reference: "DT5115",
          slug: "apartment-dt5115",
          externalPublicUrl: null,
          agentUrl: null,
        }],
      },
    },
    recordContactPropertyInteraction: async (interaction: any) => {
      recorded.push(interaction);
      return interaction;
    },
  });

  assert.equal(result.recorded, true);
  assert.equal(recorded[0].sourceType, "transcript");
  assert.equal(recorded[0].signalStrength, "explicit");
  assert.equal(recorded[0].eventType, "viewing_requested");
  assert.equal(recorded[0].evidence.anchorMessageId, "msg_out");
});
