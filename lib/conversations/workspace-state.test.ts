import test from "node:test";
import assert from "node:assert/strict";
import {
    collectPendingMessagesForConversation,
    createWorkspaceCoreSnapshot,
    createWorkspaceHydrationState,
    getPendingMessageKey,
    isWorkspaceRefreshBusy,
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
