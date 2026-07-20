import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createQuiescedSessionAuthArchive, restoreSessionAuthArchiveAtomically } from "./session-auth-archive";
import { findProfileScopedChromiumPids, getLocalAuthProfilePath } from "./session-auth-profile";
import { selectSessionAuthGenerationsForDeletion } from "./session-auth-retention";

test("quiesced LocalAuth archive restores required browser stores atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wa-auth-runtime-"));
    try {
        const source = path.join(root, "source");
        const restored = path.join(root, "restored");
        await mkdir(path.join(source, "Default", "IndexedDB"), { recursive: true });
        await mkdir(path.join(source, "Default", "Local Storage"), { recursive: true });
        await writeFile(path.join(source, "Default", "IndexedDB", "auth.db"), "durable-auth");
        await writeFile(path.join(source, "SingletonLock"), "stale-lock");
        const archive = await createQuiescedSessionAuthArchive({ profilePath: source });
        await restoreSessionAuthArchiveAtomically({ archive, profilePath: restored, scratchRoot: root });
        assert.equal(await readFile(path.join(restored, "Default", "IndexedDB", "auth.db"), "utf8"), "durable-auth");
        await assert.rejects(access(path.join(restored, "SingletonLock")));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("orphan Chromium discovery matches only the exact LocalAuth profile", () => {
    const profile = getLocalAuthProfilePath("/srv/wa", "tenant_a");
    const processes = [
        `123 chromium --user-data-dir=${profile}`,
        `124 chromium --user-data-dir=${profile}-other`,
        `125 node ${profile}`,
        `126 chrome --flag x --user-data-dir='${profile}'`,
    ].join("\n");
    assert.deepEqual(findProfileScopedChromiumPids(processes, profile), [123, 126]);
    assert.throws(() => getLocalAuthProfilePath("/srv/wa", "../escape"));
});

test("retention never deletes current, last-known-good, held, daily, or weekly backups", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const generations = Array.from({ length: 50 }, (_, index) => ({
        generation: index + 1,
        objectKey: `object-${index + 1}`,
        status: "verified",
        createdAt: new Date(now.getTime() - index * 86_400_000),
        retentionUntil: index === 20 ? new Date(now.getTime() + 86_400_000) : null,
    }));
    const deletable = selectSessionAuthGenerationsForDeletion({
        generations, currentGeneration: 1, lastKnownGoodGeneration: 2, now,
    });
    assert.ok(deletable.length > 0);
    assert.ok(!deletable.some((item) => [1, 2, 21].includes(item.generation)));
    assert.ok(!deletable.some((item) => item.generation <= 7));
});
