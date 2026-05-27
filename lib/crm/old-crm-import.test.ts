import test from "node:test";
import assert from "node:assert/strict";
import {
    extractLegacyCrmRefCandidates,
    hasOldCrmImportCapability,
} from "./old-crm-import";
import { handlePasteLeadPropertyImportJobFailure } from "@/lib/queue/paste-lead-property-import";

test("hasOldCrmImportCapability requires crmUrl, crmUsername, and crmPassword", () => {
    assert.deepEqual(
        hasOldCrmImportCapability({
            crmUrl: "https://www.downtowncyprus.com/admin",
            crmUsername: "agent",
            crmPassword: "secret",
        }),
        {
            canImportOldCrmProperties: true,
            missing: [],
        }
    );

    assert.deepEqual(
        hasOldCrmImportCapability({
            crmUrl: "",
            crmUsername: "agent",
            crmPassword: null,
        }),
        {
            canImportOldCrmProperties: false,
            missing: ["crmUrl", "crmPassword"],
        }
    );
});

test("extractLegacyCrmRefCandidates parses explicit DT references", () => {
    assert.deepEqual(
        extractLegacyCrmRefCandidates("Ref. No.: DT3327"),
        [
            {
                publicReference: "DT3327",
                oldCrmPropertyId: "2327",
                source: "explicit_ref",
            },
        ]
    );
});

test("extractLegacyCrmRefCandidates parses bare DT references without a ref label", () => {
    assert.deepEqual(
        extractLegacyCrmRefCandidates("Customer asked about DT4039 and DT4040"),
        [
            {
                publicReference: "DT4039",
                oldCrmPropertyId: "3039",
                source: "explicit_ref",
            },
            {
                publicReference: "DT4040",
                oldCrmPropertyId: "3040",
                source: "explicit_ref",
            },
        ]
    );
});

test("extractLegacyCrmRefCandidates parses Downtown Cyprus public URLs", () => {
    const [candidate] = extractLegacyCrmRefCandidates("https://www.downtowncyprus.com/properties/apartment-for-sale-in-anavargos-paphos-ref-dt3327");
    assert.equal(candidate?.publicReference, "DT3327");
    assert.equal(candidate?.oldCrmPropertyId, "2327");
});

test("extractLegacyCrmRefCandidates deduplicates and keeps multiple DT refs", () => {
    const refs = extractLegacyCrmRefCandidates([
        "Ref. No.: DT3327",
        "https://www.downtowncyprus.com/properties/apartment-for-sale-in-anavargos-paphos-ref-dt3327",
        "Also liked Ref No DT3328",
        "AB3327 should be ignored",
    ].join("\n"));

    assert.deepEqual(refs, [
        {
            publicReference: "DT3327",
            oldCrmPropertyId: "2327",
            source: "explicit_ref",
        },
        {
            publicReference: "DT3328",
            oldCrmPropertyId: "2328",
            source: "explicit_ref",
        },
    ]);
});

test("paste-lead queue writes final failure note only on terminal failure", async () => {
    const notes: Array<{ conversationId: string; body: string }> = [];
    const data = {
        locationId: "loc_123",
        conversationId: "conv_123",
        contactId: "contact_123",
        actorUserId: "user_123",
        publicReference: "DT3327",
        oldCrmPropertyId: "2327",
        source: "explicit_ref" as const,
        queuedAt: "2026-05-27T00:00:00.000Z",
    };
    const retryableError = new Error("Navigation timeout of 60000 ms exceeded");
    retryableError.name = "TimeoutError";

    await handlePasteLeadPropertyImportJobFailure({
        job: {
            id: "job_1",
            attemptsMade: 1,
            opts: { attempts: 3 },
            data,
        },
        err: retryableError,
        addNote: async (note) => {
            notes.push(note);
        },
    });

    assert.equal(notes.length, 0);

    await handlePasteLeadPropertyImportJobFailure({
        job: {
            id: "job_1",
            attemptsMade: 3,
            opts: { attempts: 3 },
            data,
        },
        err: retryableError,
        addNote: async (note) => {
            notes.push(note);
        },
    });

    assert.deepEqual(notes, [
        {
            conversationId: "conv_123",
            body: "Old CRM pull failed temporarily; retry is safe.",
        },
    ]);
});

test("paste-lead queue treats unrecoverable non-retryable failure as terminal", async () => {
    const notes: Array<{ conversationId: string; body: string }> = [];
    const notFoundError = new Error('Property "2327" was not found in the old CRM.');
    notFoundError.name = "UnrecoverableError";
    (notFoundError as any).oldCrmPropertyPullError = {
        code: "PROPERTY_NOT_FOUND",
        message: 'Property "2327" was not found in the old CRM.',
        retryable: false,
        verifyUrl: "https://crm.test/admin/properties/2327/edit",
        rawError: 'Property "2327" was not found in the old CRM.',
    };

    await handlePasteLeadPropertyImportJobFailure({
        job: {
            id: "job_2",
            attemptsMade: 1,
            opts: { attempts: 3 },
            data: {
                locationId: "loc_123",
                conversationId: "conv_123",
                contactId: "contact_123",
                actorUserId: "user_123",
                publicReference: "DT3327",
                oldCrmPropertyId: "2327",
                source: "explicit_ref",
                queuedAt: "2026-05-27T00:00:00.000Z",
            },
        },
        err: notFoundError,
        addNote: async (note) => {
            notes.push(note);
        },
    });

    assert.deepEqual(notes, [
        {
            conversationId: "conv_123",
            body: "Property DT3327 was not found in Old CRM.",
        },
    ]);
});
