import assert from "node:assert/strict";
import test from "node:test";
import { validateSessionAuthArchiveEntries } from "./session-auth-archive";

const validEntries = [
    { path: "Default/", type: "Directory" },
    { path: "Default/IndexedDB/", type: "Directory" },
    { path: "Default/IndexedDB/state.db", type: "File", uncompressedSize: 1024 },
    { path: "Default/Local Storage/", type: "Directory" },
    { path: "Default/Local Storage/leveldb/data", type: "File", uncompressedSize: 2048 },
];

test("validates the bounded required profile shape", () => {
    assert.deepEqual(validateSessionAuthArchiveEntries({ entries: validEntries }), {
        entryCount: 5,
        uncompressedBytes: 3072,
    });
});

test("rejects traversal, absolute paths, symlinks, and missing required directories", () => {
    for (const unsafe of ["../secret", "/etc/passwd", "C:/secret", "Default\\secret"]) {
        assert.throws(() => validateSessionAuthArchiveEntries({ entries: [...validEntries, { path: unsafe }] }), /unsafe/);
    }
    assert.throws(() => validateSessionAuthArchiveEntries({
        entries: [...validEntries, { path: "Default/link", type: "SymbolicLink" }],
    }), /unsafe/);
    assert.throws(() => validateSessionAuthArchiveEntries({ entries: validEntries.slice(0, 2) }), /Local Storage/);
});

test("rejects archive bombs by entry and uncompressed byte limits", () => {
    assert.throws(() => validateSessionAuthArchiveEntries({ entries: validEntries, maxEntries: 4 }), /entry count/);
    assert.throws(() => validateSessionAuthArchiveEntries({ entries: validEntries, maxUncompressedBytes: 1024 }), /size limit/);
});
