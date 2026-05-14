import assert from "node:assert/strict";
import test from "node:test";
import { getEvolutionRetirementAudit } from "./evolution-retirement";

test("getEvolutionRetirementAudit returns scoped legacy usage counts", async () => {
    const calls: Array<{ model: string; method: string; args: any }> = [];
    const db = {
        location: {
            count: async (args: any) => {
                calls.push({ model: "location", method: "count", args });
                return args.where?.whatsappProviderMode === "evolution_linked" ? 1 : 2;
            },
            findMany: async (args: any) => {
                calls.push({ model: "location", method: "findMany", args });
                return [{
                    id: "loc_1",
                    name: "Main",
                    whatsappProviderMode: "evolution_linked",
                    evolutionInstanceId: "loc_1",
                    evolutionConnectionStatus: "open",
                }];
            },
        },
        whatsAppOutboundOutbox: {
            count: async (args: any) => {
                calls.push({ model: "outbox", method: "count", args });
                return 3;
            },
        },
        message: {
            count: async (args: any) => {
                calls.push({ model: "message", method: "count", args });
                return 4;
            },
        },
        conversationSync: {
            count: async (args: any) => {
                calls.push({ model: "conversationSync", method: "count", args });
                return 5;
            },
        },
        messageSync: {
            count: async (args: any) => {
                calls.push({ model: "messageSync", method: "count", args });
                return 6;
            },
        },
    };

    const audit = await getEvolutionRetirementAudit(db, "loc_1");

    assert.equal(audit.locations.evolutionLinked, 1);
    assert.equal(audit.locations.withEvolutionInstance, 2);
    assert.equal(audit.locations.examples[0].id, "loc_1");
    assert.equal(audit.recentUsage.evolutionOutboxRows, 3);
    assert.equal(audit.recentUsage.whatsappEvolutionMessages, 4);
    assert.equal(audit.recentUsage.evolutionConversationSyncRows, 5);
    assert.equal(audit.recentUsage.evolutionMessageSyncRows, 6);

    assert.ok(calls.some((call) => call.model === "outbox" && call.args.where.locationId === "loc_1"));
    assert.ok(calls.some((call) => call.model === "message" && call.args.where.conversation.locationId === "loc_1"));
    assert.ok(calls.every((call) => call.method === "count" || call.method === "findMany"));
});
