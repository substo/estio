import assert from "node:assert/strict";
import { test } from "node:test";
import { attachStoryboardAvatar } from "./avatar-claim";
import { avatarObjectKey } from "./avatar-policy";

const loc = "11111111-1111-4111-8111-111111111111";
const presigned: string[] = [];
const store = { presignWorkerRead: async (key: string, seconds?: number) => { presigned.push(`${key}@${seconds}`); return `https://r2.example/${key}?sig=1`; } };
const job = (over: Record<string, unknown> = {}) => ({ id: "j1", kind: "studio.video_assemble", location_id: loc, created_by_clerk_user_id: "user_a", payload: { recordId: "r1" }, ...over });
const has = { contentType: "image/png", byteSize: 1234 };

test("a video job whose creator saved a photo gets a short-lived private link to exactly that photo", async () => {
  const out = await attachStoryboardAvatar([job()], store, async (l, u) => (l === loc && u === "user_a" ? has : null)) as Array<{ payload: { avatar?: Record<string, unknown> } }>;
  assert.deepEqual(out[0].payload.avatar, { name: "storyboard-avatar.png", contentType: "image/png", byteSize: 1234, url: `https://r2.example/${avatarObjectKey(loc, "user_a")}?sig=1` });
  assert.deepEqual(presigned, [`${avatarObjectKey(loc, "user_a")}@3600`]);
});
test("another user's job never gets this user's photo", async () => {
  const out = await attachStoryboardAvatar([job({ created_by_clerk_user_id: "user_b" })], store, async (_l, u) => (u === "user_a" ? has : null)) as Array<{ payload: Record<string, unknown> }>;
  assert.equal("avatar" in out[0].payload, false);
});
test("no photo, another kind of job, no creator, no storage or a failed lookup leaves the job untouched", async () => {
  const same = job(), other = job({ kind: "studio.voice_preview" }), noCreator = job({ created_by_clerk_user_id: null });
  assert.deepEqual(await attachStoryboardAvatar([same], store, async () => null), [same]);
  assert.deepEqual(await attachStoryboardAvatar([other], store, async () => has), [other]);
  assert.deepEqual(await attachStoryboardAvatar([noCreator], store, async () => has), [noCreator]);
  assert.deepEqual(await attachStoryboardAvatar([same], null, async () => has), [same]);
  assert.deepEqual(await attachStoryboardAvatar([same], store, async () => { throw new Error("db down"); }), [same]);
});
