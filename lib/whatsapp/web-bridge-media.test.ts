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
                findFirst: async ({ where }: any) => {
                    return createdAttachments.find((row) => {
                        return (!where?.messageId || row.messageId === where.messageId)
                            && (!where?.url || row.url === where.url);
                    }) || null;
                },
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

test("upload content length uses decoded bytes instead of bridge estimate", async () => {
    const db = createDbMock();
    const body = Buffer.from("voice-note-with-padding");
    const uploadedLengths: any[] = [];

    const result = await ingestWhatsAppWebBridgeMediaAttachment({
        wamId: "wam_size_mismatch",
        media: {
            ...media,
            data: body.toString("base64"),
            size: body.length + 2,
        },
        messageType: "ptt",
        transientBackoffMs: 0,
        dependencies: {
            dbClient: db.dbClient as any,
            sleep: async () => undefined,
            putMediaObject: async (input) => {
                uploadedLengths.push(input.contentLength);
                return { key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" };
            },
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async () => undefined,
        },
    });

    assert.equal(result.status, "stored");
    assert.deepEqual(uploadedLengths, [body.length]);
    assert.equal(db.createdAttachments[0].size, body.length);
});

test("video media is stored without queuing audio transcription", async () => {
    const db = createDbMock();
    const queued: any[] = [];
    const body = Buffer.from("video-bytes");

    const result = await ingestWhatsAppWebBridgeMediaAttachment({
        wamId: "wam_video",
        media: {
            data: body.toString("base64"),
            mimetype: "video/mp4",
            filename: "clip.mp4",
            size: body.length,
        },
        messageType: "video",
        transientBackoffMs: 0,
        dependencies: {
            dbClient: db.dbClient as any,
            sleep: async () => undefined,
            putMediaObject: async (input) => {
                assert.equal(input.contentType, "video/mp4");
                assert.equal(input.contentLength, body.length);
                return { key: "media/key.mp4", r2Uri: "r2://bucket/media/key.mp4" };
            },
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async (input) => {
                queued.push(input);
            },
        },
    });
    await nextTick();

    assert.equal(result.status, "stored");
    assert.equal(db.createdAttachments.length, 1);
    assert.equal(db.createdAttachments[0].contentType, "video/mp4");
    assert.equal(db.createdAttachments[0].fileName, "clip.mp4");
    assert.deepEqual(queued, []);
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

test("transient attachment create failure is retried without re-uploading media", async () => {
    const db = createDbMock();
    const queued: any[] = [];
    let uploadAttempts = 0;
    let createAttempts = 0;
    const originalCreate = db.dbClient.messageAttachment.create;

    db.dbClient.messageAttachment.create = async (input: any) => {
        createAttempts += 1;
        if (createAttempts === 1) {
            throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        }
        return originalCreate(input);
    };

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
                return { key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" };
            },
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async (input) => {
                queued.push(input);
            },
        },
    });
    await nextTick();

    assert.equal(result.status, "stored");
    assert.equal(uploadAttempts, 1);
    assert.equal(createAttempts, 2);
    assert.equal(db.createdAttachments.length, 1);
    assert.deepEqual(queued, [{
        locationId: "loc_1",
        messageId: "msg_1",
        attachmentId: "att_1",
    }]);
});

test("ambiguous attachment create failure reuses existing attachment row", async () => {
    const db = createDbMock();
    const queued: any[] = [];
    let uploadAttempts = 0;
    let createAttempts = 0;

    db.dbClient.messageAttachment.create = async ({ data }: any) => {
        createAttempts += 1;
        const row = { id: `att_${db.createdAttachments.length + 1}`, ...data };
        db.createdAttachments.push(row);
        throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    };

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
                return { key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" };
            },
            initAudioTranscriptionWorker: async () => undefined,
            enqueueAudioTranscription: async (input) => {
                queued.push(input);
            },
        },
    });
    await nextTick();

    assert.equal(result.status, "stored");
    assert.equal(uploadAttempts, 1);
    assert.equal(createAttempts, 1);
    assert.equal(db.createdAttachments.length, 1);
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

test("concurrent ingest for the same WhatsApp media creates one attachment", async () => {
    const db = createDbMock();
    const queued: any[] = [];
    let uploadAttempts = 0;

    const dependencies = {
        dbClient: db.dbClient as any,
        sleep: async () => undefined,
        putMediaObject: async () => {
            uploadAttempts += 1;
            await new Promise((resolve) => setImmediate(resolve));
            return { key: "media/key.ogg", r2Uri: "r2://bucket/media/key.ogg" };
        },
        initAudioTranscriptionWorker: async () => undefined,
        enqueueAudioTranscription: async (input: any) => {
            queued.push(input);
        },
    };

    const [first, second] = await Promise.all([
        ingestWhatsAppWebBridgeMediaAttachment({
            wamId: "wam_concurrent",
            media,
            messageType: "ptt",
            transientBackoffMs: 0,
            dependencies,
        }),
        ingestWhatsAppWebBridgeMediaAttachment({
            wamId: "wam_concurrent",
            media,
            messageType: "ptt",
            transientBackoffMs: 0,
            dependencies,
        }),
    ]);
    await nextTick();

    assert.equal(first.status, "stored");
    assert.equal(second.status, "stored");
    assert.equal(uploadAttempts, 1);
    assert.equal(db.createdAttachments.length, 1);
    assert.equal(queued.length, 1);
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
