import test from "node:test";
import assert from "node:assert/strict";
import {
    collectPendingMessagesForConversation,
    createWorkspaceCoreSnapshot,
    createWorkspaceHydrationState,
    getPendingMessageKey,
    isWorkspaceRefreshBusy,
    mergeLatestMessageWindowIntoCachedMessages,
    mergeSnapshotPreservingPendingMessages,
} from "./workspace-state";

test("getPendingMessageKey prefers client id, then message id, then wam id", () => {
    assert.equal(getPendingMessageKey({ clientMessageId: " cmid_1 ", id: "msg_1", wamId: "wam_1" } as any), "client:cmid_1");
    assert.equal(getPendingMessageKey({ id: " msg_2 ", wamId: "wam_2" } as any), "id:msg_2");
    assert.equal(getPendingMessageKey({ wamId: " wam_3 " } as any), "wam:wam_3");
    assert.equal(getPendingMessageKey({}), null);
});

test("collectPendingMessagesForConversation keeps only matching pending outbound messages", () => {
    const messages = [
        {
            id: "opt-1",
            clientMessageId: "cmid_1",
            conversationId: "conv_1",
            direction: "outbound",
            status: "sending",
            sendState: "queued",
        },
        {
            id: "opt-other",
            clientMessageId: "cmid_other",
            conversationId: "conv_other",
            direction: "outbound",
            status: "sending",
            sendState: "queued",
        },
        {
            id: "sent-1",
            conversationId: "conv_1",
            direction: "outbound",
            status: "sent",
            sendState: "sent",
        },
    ] as any[];

    const pending = collectPendingMessagesForConversation("conv_1", messages);
    assert.deepEqual(Array.from(pending.keys()), ["client:cmid_1"]);
    assert.equal(pending.get("client:cmid_1")?.id, "opt-1");
});

test("mergeSnapshotPreservingPendingMessages keeps stale optimistic outbound and reconciles matches", () => {
    const snapshot = [{
        id: "msg_real_1",
        clientMessageId: "cmid_1",
        direction: "outbound",
        status: "sent",
        dateAdded: "2026-03-24T10:00:01.000Z",
    }] as any[];
    const pending = [
        {
            id: "opt-1",
            clientMessageId: "cmid_1",
            direction: "outbound",
            status: "sending",
            sendState: "queued",
            dateAdded: "2026-03-24T10:00:00.000Z",
        },
        {
            id: "opt-2",
            clientMessageId: "cmid_2",
            direction: "outbound",
            status: "sending",
            sendState: "queued",
            dateAdded: "2026-03-24T10:00:02.000Z",
        },
    ] as any[];

    const merged = mergeSnapshotPreservingPendingMessages(snapshot, pending);
    assert.deepEqual(merged.map((message) => message.id), ["msg_real_1", "opt-2"]);
    assert.equal(merged[0].status, "sent");
});

test("mergeSnapshotPreservingPendingMessages preserves optimistic outbound omitted from capped refresh", () => {
    const cappedRefreshSnapshot = [
        {
            id: "msg_recent_1",
            direction: "inbound",
            status: "delivered",
            dateAdded: "2026-03-24T10:00:00.000Z",
        },
        {
            id: "msg_recent_2",
            direction: "inbound",
            status: "delivered",
            dateAdded: "2026-03-24T10:00:01.000Z",
        },
    ] as any[];
    const optimisticOutbound = {
        id: "opt-outbound-1",
        clientMessageId: "cmid_omitted_from_cap",
        conversationId: "conv_1",
        direction: "outbound",
        status: "sending",
        sendState: "queued",
        body: "still pending locally",
        dateAdded: "2026-03-24T10:00:02.000Z",
    };

    const merged = mergeSnapshotPreservingPendingMessages(cappedRefreshSnapshot, [optimisticOutbound] as any[]);

    assert.deepEqual(merged.map((message) => message.id), [
        "msg_recent_1",
        "msg_recent_2",
        "opt-outbound-1",
    ]);
    assert.equal((merged[2] as any).clientMessageId, "cmid_omitted_from_cap");
    assert.equal(merged[2].status, "sending");
});

test("mergeLatestMessageWindowIntoCachedMessages preserves older cached messages and updates latest window", () => {
    const cached = [
        { id: "m1", dateAdded: "2026-03-24T10:00:00.000Z", body: "older" },
        { id: "m2", dateAdded: "2026-03-24T10:01:00.000Z", body: "stale" },
        { id: "opt-1", clientMessageId: "cmid_1", dateAdded: "2026-03-24T10:02:00.000Z", body: "optimistic" },
    ] as any[];
    const latest = [
        { id: "m2", dateAdded: "2026-03-24T10:01:00.000Z", body: "fresh" },
        { id: "m3", dateAdded: "2026-03-24T10:03:00.000Z", body: "new" },
    ] as any[];

    const merged = mergeLatestMessageWindowIntoCachedMessages(cached, latest);

    assert.deepEqual(merged.map((message) => message.id), ["m1", "m2", "opt-1", "m3"]);
    assert.equal(merged[1].body, "fresh");
    assert.equal(merged[2].body, "optimistic");
});

test("mergeLatestMessageWindowIntoCachedMessages reconciles optimistic messages by client id", () => {
    const cached = [
        { id: "opt-1", clientMessageId: "cmid_1", dateAdded: "2026-03-24T10:00:00.000Z", body: "optimistic" },
    ] as any[];
    const latest = [
        { id: "real-1", clientMessageId: "cmid_1", dateAdded: "2026-03-24T10:00:01.000Z", body: "sent" },
    ] as any[];

    const merged = mergeLatestMessageWindowIntoCachedMessages(cached, latest);

    assert.deepEqual(merged.map((message) => message.id), ["real-1"]);
    assert.equal(merged[0].body, "sent");
});

test("mergeLatestMessageWindowIntoCachedMessages preserves transcript metadata omitted by first-paint refresh", () => {
    const cached = [{
        id: "m1",
        dateAdded: "2026-03-24T10:00:00.000Z",
        attachments: [{
            id: "att_1",
            url: "/api/media/attachments/att_1",
            transcript: { status: "completed", text: "Voice transcript" },
        }],
    }] as any[];
    const latest = [{
        id: "m1",
        dateAdded: "2026-03-24T10:00:00.000Z",
        attachments: [{
            id: "att_1",
            url: "/api/media/attachments/att_1",
            transcript: null,
        }],
    }] as any[];

    const merged = mergeLatestMessageWindowIntoCachedMessages(cached, latest);

    assert.equal((merged[0] as any).attachments[0].transcript.status, "completed");
    assert.equal((merged[0] as any).attachments[0].transcript.text, "Voice transcript");
});

test("workspace snapshot builders preserve payload shape and defaults", () => {
    const messages = [
        { id: "m1", dateAdded: "2026-03-24T10:00:00.000Z" },
        { id: "m2", dateAdded: "2026-03-24T10:01:00.000Z" },
    ] as any[];
    const hydration = createWorkspaceHydrationState({
        status: "partial",
        messages,
        messageWindow: { count: 2, requestedLimit: 35 },
    });

    assert.equal(hydration.status, "partial");
    assert.equal(hydration.initialCount, 2);
    assert.equal(hydration.requestedLimit, 35);
    assert.equal(hydration.oldestCursor, `${new Date(messages[0].dateAdded).getTime()}::m1`);
    assert.equal(hydration.newestCursor, `${new Date(messages[1].dateAdded).getTime()}::m2`);

    const snapshot = createWorkspaceCoreSnapshot({
        messages,
        activityTimeline: [{ id: "activity_1" }],
        transcriptEligibility: { success: true, enabled: true },
        hydration,
    });

    assert.equal(snapshot.conversationHeader, null);
    assert.equal(snapshot.messages, messages);
    assert.equal(snapshot.activityTimeline.length, 1);
    assert.equal(snapshot.transcriptOnDemandEnabled, true);
    assert.equal(snapshot.hydration, hydration);
});

test("isWorkspaceRefreshBusy includes deferred metadata enrichment", () => {
    const inFlight = {
        initialHydration: new Set<string>(),
        backfill: new Set<string>(["conv_backfill"]),
        activityHydration: new Set<string>(),
        messageMetadata: new Set<string>(["conv_metadata"]),
    };

    assert.equal(isWorkspaceRefreshBusy("conv_metadata", inFlight), true);
    assert.equal(isWorkspaceRefreshBusy("conv_backfill", inFlight), true);
    assert.equal(isWorkspaceRefreshBusy("conv_idle", inFlight), false);
    assert.equal(isWorkspaceRefreshBusy(" ", inFlight), false);
});
