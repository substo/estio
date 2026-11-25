import assert from "node:assert/strict";
import test from "node:test";
import { characterManifestKey, characterPhotoKey, cleanProfile, readManifest, referenceOrder } from "./character-profile";

test("keys are derived from the Location and a hash of the user, never the raw id", () => {
  const a = characterPhotoKey("loc1", "user_abc", 2);
  assert.match(a, /^loc1\/character\/[0-9a-f]{40}\/photo-2$/); assert.ok(!a.includes("user_abc"));
  assert.notEqual(a, characterPhotoKey("loc1", "user_xyz", 2));
  assert.match(characterManifestKey("loc1", "user_abc"), /\/profile\.json$/);
});

test("the stored manifest is validated on read: unknown roles, bad types, duplicates, out-of-range slots and unknown aspects are dropped", () => {
  const m = readManifest({ photos: [
    { n: 1, role: "face-front", contentType: "image/jpeg", byteSize: 1000, updatedAt: "2026-11-25T10:00:00Z" },
    { n: 1, role: "full-body", contentType: "image/png", byteSize: 1, updatedAt: "2026-11-25T10:00:00Z" },
    { n: 9, role: "face-front", contentType: "image/png", byteSize: 1, updatedAt: "2026-11-25T10:00:00Z" },
    { n: 2, role: "selfie", contentType: "image/png", byteSize: 1, updatedAt: "2026-11-25T10:00:00Z" },
    { n: 3, role: "full-body", contentType: "image/gif", byteSize: 1, updatedAt: "2026-11-25T10:00:00Z" },
    { n: 4, role: "outfit", contentType: "image/webp", byteSize: 99, updatedAt: "2026-11-25T10:00:00Z" } ],
    profile: { aspects: [{ key: "hair", value: "short dark", locked: true }, { key: "hair", value: "dup", locked: false }, { key: "bogus", value: "x", locked: true }], notes: "  slim  " } });
  assert.deepEqual(m.photos.map(p => p.n), [1, 4]);
  assert.deepEqual(m.profile.aspects, [{ key: "hair", value: "short dark", locked: true }]);
  assert.equal(m.profile.notes, "slim");
  assert.deepEqual(readManifest(null), { photos: [], profile: { aspects: [] } });
});

test("the form's profile is cleaned like the agent's edits: known aspects, short values, clothing-like ones free unless locked", () => {
  const p = cleanProfile({ aspects: [{ key: "hair", value: " short dark ", locked: true }, { key: "clothing", value: "navy sweater", locked: false }, { key: "bogus", value: "x", locked: true }, { key: "style", value: "  " }], notes: "broad shoulders" });
  assert.deepEqual(p.aspects, [{ key: "hair", value: "short dark", locked: true }, { key: "clothing", value: "navy sweater", locked: false }]);
  assert.equal(p.notes, "broad shoulders");
});

test("references go face first, then the angle, the body, the outfit", () => {
  const mk = (n: number, role: never) => ({ n, role, contentType: "image/png" as const, byteSize: 1, updatedAt: "2026-11-25T10:00:00Z" });
  assert.deepEqual(referenceOrder([mk(1, "outfit" as never), mk(2, "full-body" as never), mk(3, "face-front" as never), mk(4, "face-angle" as never)]).map(p => p.n), [3, 4, 2, 1]);
});
