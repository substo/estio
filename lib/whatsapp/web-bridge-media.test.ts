import assert from "node:assert/strict";
import test from "node:test";

import {
    ingestWhatsAppWebBridgeMediaAttachment,
    isTransientWebBridgeMediaIngestError,
} from "./web-bridge-media";

const media = {
    data: Buffer.from("voice-note").toString("base64"),
    mimetype: "audio/ogg; codecs=opus",
    filename: "voice.ogg",
    size: 10,
};

function createDbMock() {
    const createdAttachments: any[] = [];
    const message = {
        id: "msg_1",
        attachments: [],
        conversation: {
            id: "conv_1",
            locationId: "loc_1",
            contactId: "contact_1",
        },
    };

    return {
        createdAttachments,
        dbClient: {
            message: {
                findFirst: async () => message,
            },
            messageAttachment: {
                create: async ({ data }: any) => {
                    const row = { id: `att_${createdAttachments.length + 1}`, ...data };
                    createdAttachments.push(row);
                    return row;
                },
            },
        },
    };
}

async function nextTick() {
    await new Promise((resolve) => setImmediate(resolve));
}

test("isTransientWebBridgeMediaIngestError detects recoverable connection failures", () => {
    assert.equal(isTransientWebBridgeMediaIngestError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
    assert.equal(isTransientWebBridgeMediaIngestError(new Error("Runtime.callFunctionOn timed out")), true);
    assert.equal(isTransientWebBridgeMediaIngestError(new Error("invalid base64")), false);
});

test("transient upload failure is retried and creates an attachment", async () => {
    const db = createDbMock();
    let uploadAttempts = 0;

    const result = await ingestWhatsAppWebBridgeMediaAttachment({
        wamId: "wam_1",
        media,
        messageType: "ptt",
        transientBackoffMs: 0,
        dependencies: {
            dbClient: db.dbClient as any,
            sleep: async () => undefined,
            putMediaObject: async () => {
                uploadAttempts += 1;
                if (uploadAttempts === 1) {
                    throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
                }
                return { key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" };
            },
            headMediaObject: async () => ({ exists: false as const }),
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async () => undefined,
        },
    });

    assert.equal(result.status, "stored");
    assert.equal(uploadAttempts, 2);
    assert.equal(db.createdAttachments.length, 1);
    assert.equal(db.createdAttachments[0].contentType, "audio/ogg; codecs=opus");
});

test("ambiguous transient upload failure verifies existing object and creates attachment", async () => {
    const db = createDbMock();
    const queued: any[] = [];

    const result = await ingestWhatsAppWebBridgeMediaAttachment({
        wamId: "wam_1",
        media,
        messageType: "ptt",
        transientBackoffMs: 0,
        dependencies: {
            dbClient: db.dbClient as any,
            sleep: async () => undefined,
            putMediaObject: async () => {
                throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
            },
            headMediaObject: async (key) => ({
                exists: true as const,
                contentLength: 10,
                contentType: "audio/ogg; codecs=opus",
                etag: `"${key}"`,
            }),
            toMediaUri: (key) => `r2://bucket/${key}`,
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async (input) => {
                queued.push(input);
            },
        },
    });
    await nextTick();

    assert.equal(result.status, "stored");
    assert.equal(db.createdAttachments.length, 1);
    assert.equal(db.createdAttachments[0].url.startsWith("r2://"), true);
    assert.deepEqual(queued, [{
        locationId: "loc_1",
        messageId: "msg_1",
        attachmentId: "att_1",
    }]);
});

test("successful audio retry queues transcription for the created attachment", async () => {
    const db = createDbMock();
    const queued: any[] = [];

    await ingestWhatsAppWebBridgeMediaAttachment({
        wamId: "wam_1",
        media,
        messageType: "ptt",
        transientBackoffMs: 0,
        dependencies: {
            dbClient: db.dbClient as any,
            sleep: async () => undefined,
            putMediaObject: async () => ({ key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" }),
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async (input) => {
                queued.push(input);
            },
        },
    });
    await nextTick();

    assert.deepEqual(queued, [{
        locationId: "loc_1",
        messageId: "msg_1",
        attachmentId: "att_1",
    }]);
});

test("permanent upload failure is not retried forever and does not create an attachment", async () => {
    const db = createDbMock();
    let uploadAttempts = 0;

    await assert.rejects(
        ingestWhatsAppWebBridgeMediaAttachment({
            wamId: "wam_1",
            media,
            messageType: "ptt",
            maxTransientAttempts: 3,
            transientBackoffMs: 0,
            dependencies: {
                dbClient: db.dbClient as any,
                sleep: async () => undefined,
                putMediaObject: async () => {
                    uploadAttempts += 1;
                    throw new Error("AccessDenied");
                },
                initAudioTranscriptionWorker: async () => undefined,
                enqueueAudioTranscription: async () => undefined,
            },
        }),
        /AccessDenied/
    );

    assert.equal(uploadAttempts, 1);
    assert.equal(db.createdAttachments.length, 0);
});
