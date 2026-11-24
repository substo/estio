import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarFileName, avatarObjectKey, MAX_AVATAR_BYTES, readAvatarBytes, sniffAvatarType } from "./avatar-policy";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]);
test("the image type is read from the bytes", () => {
  assert.equal(sniffAvatarType(jpeg), "image/jpeg");
  assert.equal(sniffAvatarType(png), "image/png");
  assert.equal(sniffAvatarType(webp), "image/webp");
  assert.equal(sniffAvatarType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), null);   // GIF
  assert.equal(sniffAvatarType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniffAvatarType(new Uint8Array([])), null);
});
test("a photo must be present, small and a real image", () => {
  assert.deepEqual(readAvatarBytes(jpeg), { ok: true, contentType: "image/jpeg" });
  assert.equal(readAvatarBytes(new Uint8Array([])).ok, false);
  assert.equal(readAvatarBytes(Buffer.alloc(MAX_AVATAR_BYTES + 1, 0xff)).ok, false);
  assert.equal(readAvatarBytes(Buffer.from("not an image at all")).ok, false);
});
test("the storage key is derived, per user, and does not contain the user id", () => {
  const a = avatarObjectKey("loc-1", "user_abc"), b = avatarObjectKey("loc-1", "user_def");
  assert.match(a, /^loc-1\/avatars\/[0-9a-f]{40}$/);
  assert.notEqual(a, b);
  assert.equal(a, avatarObjectKey("loc-1", "user_abc"));
  assert.ok(!a.includes("user_abc"));
});
test("the file name follows the type", () => {
  assert.equal(avatarFileName("image/png"), "storyboard-avatar.png");
  assert.equal(avatarFileName("image/webp"), "storyboard-avatar.webp");
  assert.equal(avatarFileName("image/jpeg"), "storyboard-avatar.jpg");
});
