import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeQuickViewingSession } from "@/lib/viewings/sessions/resume";

test("a completed private session continues with the same transcript and usage identity", async () => {
    const row = {
        id: "session-1", locationId: "location-1", sessionThreadId: "thread-1",
        chainIndex: 1, sessionKind: "quick_translate", participantMode: "agent_only",
        status: "completed", deletedAt: null as Date | null,
        startedAt: new Date("2026-10-12T10:00:00Z"), endedAt: new Date("2026-10-12T10:30:00Z") as Date | null,
        savePolicy: "save_transcript", label: "Downtown",
    };
    let deletedContent = false;
    const delegate = {
        findFirst: async ({ where }: { where: { id?: string; locationId: string } }) => {
            if (where.id && where.id !== row.id) return null;
            if (where.locationId !== row.locationId || row.deletedAt) return null;
            return where.id ? { ...row } : null;
        },
        updateMany: async ({ where, data }: { where: { id: string; locationId: string; status: string }; data: Record<string, unknown> }) => {
            if (where.id !== row.id || where.locationId !== row.locationId || where.status !== row.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        },
        deleteMany: async () => { deletedContent = true; return { count: 0 }; },
    };
    const database = {
        viewingSession: delegate,
        viewingSessionMessage: { deleteMany: delegate.deleteMany },
        viewingSessionUsage: { deleteMany: delegate.deleteMany },
        $transaction: async (callback: (tx: { viewingSession: typeof delegate }) => Promise<unknown>) => callback({ viewingSession: delegate }),
    } as unknown as NonNullable<Parameters<typeof resumeQuickViewingSession>[1]>;
    const effects = { publishStatus: async () => undefined, appendEvent: async () => undefined } as unknown as NonNullable<Parameters<typeof resumeQuickViewingSession>[2]>;

    const result = await resumeQuickViewingSession({ sessionId: row.id, locationId: row.locationId }, database, effects);
    assert.equal(result.kind, "resumed");
    assert.equal(result.sessionId, row.id);
    assert.equal(row.status, "active");
    assert.equal(row.endedAt, null);
    assert.equal(row.label, "Downtown");
    assert.equal(deletedContent, false);
    assert.equal((await resumeQuickViewingSession({ sessionId: row.id, locationId: row.locationId }, database, effects)).kind, "active");
    assert.equal((await resumeQuickViewingSession({ sessionId: row.id, locationId: "other-location" }, database, effects)).kind, "not_found");
});
