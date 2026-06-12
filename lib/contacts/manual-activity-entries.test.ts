import assert from "node:assert/strict";
import test from "node:test";

import {
    buildManualActivityChanges,
    deleteManualActivityEntry,
    updateManualActivityEntry,
} from "./manual-activity-entries";

test("buildManualActivityChanges validates note text and normalizes date", () => {
    assert.deepEqual(
        buildManualActivityChanges({
            entry: "Followed up",
            dateIso: "2026-06-12T09:30:00.000Z",
            editedAt: "2026-06-12T10:00:00.000Z",
            editedById: "user-1",
        }),
        {
            date: "2026-06-12T09:30:00.000Z",
            entry: "Followed up",
            editedAt: "2026-06-12T10:00:00.000Z",
            editedById: "user-1",
        }
    );

    assert.throws(
        () => buildManualActivityChanges({ entry: " ", dateIso: "2026-06-12T09:30:00.000Z" }),
        /Entry is required/
    );
    assert.throws(
        () => buildManualActivityChanges({ entry: "Followed up", dateIso: "not-a-date" }),
        /Date is invalid/
    );
});

test("updateManualActivityEntry restricts lookup to manual entries in the actor location", async () => {
    const calls: any[] = [];
    const db = {
        contactHistory: {
            findFirst: async (args: any) => {
                calls.push(["findFirst", args]);
                return { id: "history-1" };
            },
            update: async (args: any) => {
                calls.push(["update", args]);
                return {
                    id: "history-1",
                    createdAt: new Date("2026-06-12T09:00:00.000Z"),
                    action: "MANUAL_ENTRY",
                    changes: args.data.changes,
                    contactId: "contact-1",
                    user: { name: "Agent", email: "agent@example.com" },
                    contact: { conversations: [{ id: "conv-1" }] },
                };
            },
        },
    };

    const result = await updateManualActivityEntry({
        db: db as any,
        historyId: "history:history-1",
        locationId: "loc-1",
        actor: { id: "user-1" },
        entry: "Updated note",
        dateIso: "2026-06-12T09:30:00.000Z",
    });

    assert.equal(calls[0][1].where.id, "history-1");
    assert.equal(calls[0][1].where.action, "MANUAL_ENTRY");
    assert.equal(calls[0][1].where.deletedAt, null);
    assert.deepEqual(calls[0][1].where.contact, { locationId: "loc-1" });
    assert.equal(calls[1][1].data.updatedById, "user-1");
    assert.equal(result.activityEntry.id, "history:history-1");
    assert.deepEqual(result.conversationIds, ["conv-1"]);
});

test("deleteManualActivityEntry soft deletes manual entry rows", async () => {
    const calls: any[] = [];
    const db = {
        contactHistory: {
            findFirst: async (args: any) => {
                calls.push(["findFirst", args]);
                return { id: "history-1" };
            },
            update: async (args: any) => {
                calls.push(["update", args]);
                return {
                    id: "history-1",
                    contactId: "contact-1",
                    contact: { conversations: [{ id: "conv-1" }, { id: "conv-2" }] },
                };
            },
        },
    };

    const result = await deleteManualActivityEntry({
        db: db as any,
        historyId: "history-1",
        locationId: "loc-1",
        actor: { id: "user-1" },
        reason: "Wrong contact",
    });

    assert.equal(calls[0][1].where.action, "MANUAL_ENTRY");
    assert.equal(calls[0][1].where.deletedAt, null);
    assert.equal(calls[1][1].data.deletedById, "user-1");
    assert.equal(calls[1][1].data.deletedReason, "Wrong contact");
    assert.ok(calls[1][1].data.deletedAt instanceof Date);
    assert.equal(result.activityId, "history:history-1");
    assert.deepEqual(result.conversationIds, ["conv-1", "conv-2"]);
});
