import test from "node:test";
import assert from "node:assert/strict";
import {
    getWorkspaceCoreCacheEntry,
    setWorkspaceCoreCacheEntry,
} from "./workspace-core-cache.ts";

test("returns null for missing cache entry", () => {
    const cache = new Map();
    const value = getWorkspaceCoreCacheEntry(cache, "missing");
    assert.equal(value, null);
});

test("evicts least-recently-used entry when limit is exceeded", () => {
    const cache = new Map();
    setWorkspaceCoreCacheEntry(cache, "a", 1, 2);
    setWorkspaceCoreCacheEntry(cache, "b", 2, 2);
    setWorkspaceCoreCacheEntry(cache, "c", 3, 2);

    assert.equal(cache.has("a"), false);
    assert.equal(cache.has("b"), true);
    assert.equal(cache.has("c"), true);
});

test("reading an entry bumps recency", () => {
    const cache = new Map();
    setWorkspaceCoreCacheEntry(cache, "a", 1, 2);
    setWorkspaceCoreCacheEntry(cache, "b", 2, 2);
    assert.equal(getWorkspaceCoreCacheEntry(cache, "a"), 1);

    setWorkspaceCoreCacheEntry(cache, "c", 3, 2);
    assert.equal(cache.has("a"), true);
    assert.equal(cache.has("b"), false);
    assert.equal(cache.has("c"), true);
});
