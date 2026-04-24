import test from "node:test";
import assert from "node:assert/strict";
import {
    buildBaseReminderDraft,
    deriveGoogleMapsLink,
    extractGoogleMapsLinkFromText,
    processViewingReminderBatch,
    type ViewingReminderContext,
} from "./reminders";

function createContext(overrides?: Partial<ViewingReminderContext>): ViewingReminderContext {
    return {
        viewingId: "viewing_1",
        locationId: "loc_1",
        status: "scheduled",
        scheduledAtIso: "2026-04-22T09:00:00.000Z",
        scheduledTimeZone: "Europe/Nicosia",
        scheduledLabel: "Apr 22, 2026, 12:00 PM EEST (Europe/Nicosia)",
        propertyId: "prop_1",
        propertyLabel: "[REF-1] Sea View Apartment",
        propertyReference: "REF-1",
        locationLabel: "25 Makarios Ave, Limassol, Cyprus",
        accessNotes: null,
        directionsUrl: "https://maps.app.goo.gl/example123",
        directionsUrlSource: "metadata",
        reminders: {
            version: 1,
            lead: {
                "120": {
                    offsetMinutes: 120,
                    dueAt: "2026-04-22T07:00:00.000Z",
                    status: "pending",
                    enabledAt: "2026-04-21T08:00:00.000Z",
                    idempotencyKey: "viewing_lead_reminder:viewing_1:120:1760000000000",
                },
            },
        },
        lead: {
            contactId: "lead_1",
            name: "Lead Name",
            phone: "+35799111222",
            preferredLanguage: "en",
            activeConversationId: "conv_1",
            activeConversationInternalId: "conv_internal_1",
            canOpenConversation: true,
        },
        owner: {
            contactId: "owner_1",
            name: "Owner Name",
            phone: "+35799333444",
            preferredLanguage: "en",
            activeConversationId: "owner_conv_1",
            activeConversationInternalId: "owner_conv_internal_1",
            canOpenConversation: true,
            fallbackHint: "Use the side gate",
        },
        ...overrides,
    };
}

test("extractGoogleMapsLinkFromText prefers Google links embedded in notes", () => {
    const result = extractGoogleMapsLinkFromText(
        "Meet here https://maps.app.goo.gl/abc123",
        null,
        null
    );

    assert.equal(result.url, "https://maps.app.goo.gl/abc123");
    assert.equal(result.source, "viewingDirections");
});

test("deriveGoogleMapsLink prefers metadata before notes and coordinates", () => {
    const result = deriveGoogleMapsLink({
        metadata: { googleMapsLink: "https://maps.app.goo.gl/short123" },
        viewingDirections: "https://www.google.com/maps/search/?api=1&query=34.1,32.2",
        latitude: 34.1,
        longitude: 32.2,
    });

    assert.equal(result.url, "https://maps.app.goo.gl/short123");
    assert.equal(result.source, "metadata");
});

test("deriveGoogleMapsLink falls back to coordinates when no explicit link exists", () => {
    const result = deriveGoogleMapsLink({
        latitude: 34.775,
        longitude: 32.423,
    });

    assert.equal(result.url, "https://www.google.com/maps/search/?api=1&query=34.775,32.423");
    assert.equal(result.source, "coordinates");
});

test("buildBaseReminderDraft includes absolute viewing time and standalone directions URL", () => {
    const context = createContext();
    const draft = buildBaseReminderDraft(context, "lead");

    assert.match(draft, /Apr 22, 2026, 12:00 PM EEST/);
    assert.match(draft, /\[REF-1\] Sea View Apartment/);
    assert.match(draft, /\nDirections:\nhttps:\/\/maps\.app\.goo\.gl\/example123$/);
});

test("processViewingReminderBatch queues eligible lead reminders only once", async () => {
    const context = createContext();
    const persisted: Array<{ status?: string; messageId?: string | null }> = [];
    let enqueueCalls = 0;

    const stats = await processViewingReminderBatch(
        {
            now: new Date("2026-04-22T07:05:00.000Z"),
        },
        {
            listContexts: async () => [context],
            generateDraft: async () => ({
                audience: "lead",
                body: "Reminder body",
                viewingId: context.viewingId,
                conversationId: context.lead.activeConversationId,
                contactId: context.lead.contactId,
                targetName: context.lead.name,
                canAutoSend: true,
                scheduledLabel: context.scheduledLabel,
                directionsUrl: context.directionsUrl,
                propertyLabel: context.propertyLabel,
                locationLabel: context.locationLabel,
            }),
            resolveLeadEligibility: async () => ({ status: "eligible" }),
            enqueueMessage: async () => {
                enqueueCalls += 1;
                return { messageId: `msg_${enqueueCalls}` };
            },
            createSuggestedResponse: async () => ({ suggestionId: null }),
            persistReminderResult: async (_candidate, patch) => {
                persisted.push(patch);
                context.reminders.lead!["120"] = {
                    ...context.reminders.lead!["120"],
                    ...patch,
                };
            },
        }
    );

    assert.equal(stats.due, 1);
    assert.equal(stats.queued, 1);
    assert.equal(stats.suggested, 0);
    assert.equal(enqueueCalls, 1);
    assert.equal(persisted[0]?.status, "queued");

    const secondRun = await processViewingReminderBatch(
        {
            now: new Date("2026-04-22T07:10:00.000Z"),
        },
        {
            listContexts: async () => [context],
            resolveLeadEligibility: async () => ({ status: "eligible" }),
            generateDraft: async () => {
                throw new Error("should not regenerate once queued");
            },
            enqueueMessage: async () => {
                throw new Error("should not enqueue twice");
            },
            createSuggestedResponse: async () => ({ suggestionId: null }),
            persistReminderResult: async () => {
                throw new Error("should not persist again");
            },
        }
    );

    assert.equal(secondRun.due, 0);
    assert.equal(secondRun.queued, 0);
});

test("processViewingReminderBatch creates a suggested response when WhatsApp send is unavailable", async () => {
    const context = createContext({
        lead: {
            contactId: "lead_1",
            name: "Lead Name",
            phone: "+35799111222",
            preferredLanguage: "en",
            activeConversationId: null,
            activeConversationInternalId: null,
            canOpenConversation: true,
        },
    });

    const persisted: Array<{ status?: string; suggestionId?: string | null; reason?: string | null }> = [];

    const stats = await processViewingReminderBatch(
        {
            now: new Date("2026-04-22T07:05:00.000Z"),
        },
        {
            listContexts: async () => [context],
            generateDraft: async () => ({
                audience: "lead",
                body: "Reminder body",
                viewingId: context.viewingId,
                conversationId: null,
                contactId: context.lead.contactId,
                targetName: context.lead.name,
                canAutoSend: false,
                scheduledLabel: context.scheduledLabel,
                directionsUrl: context.directionsUrl,
                propertyLabel: context.propertyLabel,
                locationLabel: context.locationLabel,
            }),
            resolveLeadEligibility: async () => ({ status: "ineligible", reason: "No active WhatsApp conversation." }),
            enqueueMessage: async () => {
                throw new Error("should not enqueue without a sendable conversation");
            },
            createSuggestedResponse: async () => ({ suggestionId: "suggestion_1" }),
            persistReminderResult: async (_candidate, patch) => {
                persisted.push(patch);
            },
        }
    );

    assert.equal(stats.queued, 0);
    assert.equal(stats.suggested, 1);
    assert.equal(persisted[0]?.status, "suggested");
    assert.equal(persisted[0]?.suggestionId, "suggestion_1");
});
