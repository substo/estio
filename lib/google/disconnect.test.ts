import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { disconnectGoogleLocally, DISCONNECTED_GOOGLE_SETTINGS } from "./disconnect";

function recorder(result: unknown = { count: 1 }) {
    const calls: unknown[] = [];
    return {
        calls,
        fn: async (input: unknown) => {
            calls.push(input);
            return result;
        },
    };
}

test("local Google disconnect clears private state and disables only user-bound sync jobs", async () => {
    const userUpdate = recorder({ id: "user-1" });
    const gmailStateDelete = recorder();
    const directoryEntryDelete = recorder();
    const directoryStateDelete = recorder();
    const gmailOutboxUpdate = recorder({ count: 2 });
    const providerOutboxUpdate = recorder({ count: 3 });
    const contactSyncUpdate = recorder();
    const taskOutboxUpdate = recorder({ count: 4 });
    const taskSyncUpdate = recorder();
    const viewingOutboxUpdate = recorder({ count: 5 });
    const viewingSyncUpdate = recorder();
    const clearSecret = recorder();
    const upsertDocument = recorder();
    const tx = {
        user: { update: userUpdate.fn },
        gmailSyncState: { deleteMany: gmailStateDelete.fn },
        googleContactDirectoryEntry: { deleteMany: directoryEntryDelete.fn },
        googleContactDirectoryState: { deleteMany: directoryStateDelete.fn },
        gmailSyncOutbox: { updateMany: gmailOutboxUpdate.fn },
        providerOutbox: { updateMany: providerOutboxUpdate.fn },
        contactSync: { updateMany: contactSyncUpdate.fn },
        contactTaskOutbox: { updateMany: taskOutboxUpdate.fn },
        contactTaskSync: { updateMany: taskSyncUpdate.fn },
        viewingOutbox: { updateMany: viewingOutboxUpdate.fn },
        viewingSync: { updateMany: viewingSyncUpdate.fn },
    };

    const result = await disconnectGoogleLocally(
        tx as never,
        { userId: "user-1", requestId: "request-1", now: new Date("2026-08-02T12:00:00Z") },
        { clearSecret: clearSecret.fn as never, upsertDocument: upsertDocument.fn as never }
    );

    assert.deepEqual(result, {
        gmailJobsDisabled: 2,
        providerJobsDisabled: 3,
        taskJobsDisabled: 4,
        viewingJobsDisabled: 5,
    });
    assert.deepEqual((userUpdate.calls[0] as any).data, {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleSyncToken: null,
        ...DISCONNECTED_GOOGLE_SETTINGS,
    });
    assert.deepEqual((providerOutboxUpdate.calls[0] as any).where, {
        provider: "google",
        providerAccountId: "user-1",
        status: { in: ["pending", "processing", "failed"] },
    });
    assert.equal((taskOutboxUpdate.calls[0] as any).where.task.OR[0].assignedUserId, "user-1");
    assert.equal((viewingOutboxUpdate.calls[0] as any).where.viewing.userId, "user-1");
    assert.equal(clearSecret.calls.length, 2);
    assert.deepEqual((upsertDocument.calls[0] as any).payload, DISCONNECTED_GOOGLE_SETTINGS);
    assert.equal("contact" in tx, false, "business contacts must not be deleted or rewritten");
});

test("disconnect endpoint derives the user from Clerk and revokes only after local commit", async () => {
    const source = await readFile(new URL("../../app/api/google/disconnect/route.ts", import.meta.url), "utf8");
    assert.match(source, /const \{ userId: clerkUserId \} = await auth\(\)/);
    assert.match(source, /where: \{ clerkId: clerkUserId \}/);
    assert.doesNotMatch(source, /req\.json\(|request\.json\(/);
    assert.ok(source.indexOf("disconnectGoogleLocally") < source.indexOf("revokeToken"));
    assert.match(source, /return NextResponse\.json\(\{ success: true, externalWarning \}\)/);
});
