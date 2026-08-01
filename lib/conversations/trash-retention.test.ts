import assert from "node:assert/strict";
import test from "node:test";

import {
    buildExpiredConversationTrashWhere,
    getConversationTrashRetentionCutoff,
    runConversationTrashRetentionPurge,
} from "./trash-retention";

type Row = { id: string; locationId: string; deletedAt: Date | null };

function createRepository(initialRows: Row[]) {
    let rows = [...initialRows];
    return {
        repository: {
            async findMany(args: any) {
                const cutoff = args.where.deletedAt.lt.getTime();
                return rows
                    .filter((row) => row.deletedAt && row.deletedAt.getTime() < cutoff)
                    .sort((a, b) => (a.deletedAt!.getTime() - b.deletedAt!.getTime()) || a.id.localeCompare(b.id))
                    .slice(0, args.take)
                    .map(({ id, locationId }) => ({ id, locationId }));
            },
            async deleteMany(args: any) {
                const ids = new Set(args.where.id.in);
                const cutoff = args.where.deletedAt.lt.getTime();
                const before = rows.length;
                rows = rows.filter((row) => !(
                    ids.has(row.id) && row.deletedAt && row.deletedAt.getTime() < cutoff
                ));
                return { count: before - rows.length };
            },
        },
        getRows: () => rows,
    };
}

test("automatic retention uses a strict 30-day deletedAt cutoff", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    const cutoff = getConversationTrashRetentionCutoff(now);

    assert.equal(cutoff.toISOString(), "2026-07-01T12:00:00.000Z");
    assert.deepEqual(buildExpiredConversationTrashWhere(cutoff), {
        deletedAt: { lt: cutoff },
    });
});

test("purge batches expired conversations across locations and preserves fresh trash", async () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    const exactCutoff = new Date("2026-07-01T12:00:00.000Z");
    const fake = createRepository([
        { id: "old_a", locationId: "loc_a", deletedAt: new Date("2026-06-01T00:00:00.000Z") },
        { id: "old_b", locationId: "loc_b", deletedAt: new Date("2026-06-15T00:00:00.000Z") },
        { id: "exact", locationId: "loc_a", deletedAt: exactCutoff },
        { id: "fresh", locationId: "loc_b", deletedAt: new Date("2026-07-20T00:00:00.000Z") },
        { id: "active", locationId: "loc_a", deletedAt: null },
    ]);

    const result = await runConversationTrashRetentionPurge({
        repository: fake.repository,
        now,
        batchSize: 1,
        maxBatches: 10,
    });

    assert.equal(result.purged, 2);
    assert.equal(result.batches, 2);
    assert.equal(result.limitReached, false);
    assert.deepEqual(result.affectedLocationIds, ["loc_a", "loc_b"]);
    assert.deepEqual(fake.getRows().map((row) => row.id), ["exact", "fresh", "active"]);
});

test("purge reports a bounded continuation when the batch cap is reached", async () => {
    const fake = createRepository([
        { id: "old_a", locationId: "loc_a", deletedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "old_b", locationId: "loc_a", deletedAt: new Date("2026-01-02T00:00:00.000Z") },
        { id: "old_c", locationId: "loc_a", deletedAt: new Date("2026-01-03T00:00:00.000Z") },
    ]);

    const result = await runConversationTrashRetentionPurge({
        repository: fake.repository,
        now: new Date("2026-07-31T12:00:00.000Z"),
        batchSize: 2,
        maxBatches: 1,
    });

    assert.equal(result.purged, 2);
    assert.equal(result.limitReached, true);
    assert.deepEqual(fake.getRows().map((row) => row.id), ["old_c"]);
});
