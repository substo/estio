import assert from "node:assert/strict";
import { test } from "node:test";
import { canRestoreViewingSession, moveViewingSessionToTrash, restoreViewingSession, viewingSessionTrashCutoff } from "@/lib/viewings/sessions/trash";

test("the 30-day recovery boundary is inclusive", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const cutoff = viewingSessionTrashCutoff(now);
    assert.equal(cutoff.toISOString(), "2026-09-10T12:00:00.000Z");
    assert.equal(canRestoreViewingSession(cutoff, null, now), true);
    assert.equal(canRestoreViewingSession(new Date(cutoff.getTime() - 1), null, now), false);
    assert.equal(canRestoreViewingSession(cutoff, now, now), false);
    assert.equal(canRestoreViewingSession(null, null, now), false);
});

test("delete and restore stay in the selected location and tolerate repeat requests", async () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const row = { id: "session-1", locationId: "location-1", status: "completed", deletedAt: null as Date | null, trashPurgedAt: null as Date | null };
    const delegate = {
        findFirst: async ({ where }: { where: { id: string; locationId: string } }) =>
            where.id === row.id && where.locationId === row.locationId ? { ...row } : null,
        updateMany: async ({ where, data }: { where: { id: string; locationId: string; deletedAt?: unknown; trashPurgedAt?: unknown }; data: { deletedAt?: Date | null } }) => {
            if (where.id !== row.id || where.locationId !== row.locationId) return { count: 0 };
            if (where.deletedAt === null && row.deletedAt) return { count: 0 };
            if (where.deletedAt && row.deletedAt === null) return { count: 0 };
            if (where.trashPurgedAt === null && row.trashPurgedAt) return { count: 0 };
            row.deletedAt = data.deletedAt ?? null;
            return { count: 1 };
        },
    };
    const database = {
        viewingSession: delegate,
        $transaction: async (callback: (tx: { viewingSession: typeof delegate }) => Promise<unknown>) => callback({ viewingSession: delegate }),
    } as unknown as NonNullable<Parameters<typeof moveViewingSessionToTrash>[1]>;

    assert.equal(await moveViewingSessionToTrash({ id: row.id, locationId: "location-2", now }, database), "not_found");
    assert.equal(await moveViewingSessionToTrash({ id: row.id, locationId: row.locationId, now }, database), "deleted");
    assert.equal(await moveViewingSessionToTrash({ id: row.id, locationId: row.locationId, now }, database), "already_deleted");
    assert.equal(await restoreViewingSession({ id: row.id, locationId: "location-2", now }, database), "not_found");
    assert.equal(await restoreViewingSession({ id: row.id, locationId: row.locationId, now }, database), "restored");
    assert.equal(await restoreViewingSession({ id: row.id, locationId: row.locationId, now }, database), "already_restored");
    row.status = "active";
    assert.equal(await moveViewingSessionToTrash({ id: row.id, locationId: row.locationId, now }, database), "active");
});
