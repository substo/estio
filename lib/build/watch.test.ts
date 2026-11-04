import assert from "node:assert/strict";
import test from "node:test";
import { checkGithub, describeUrl, watchId } from "./watch";

test("links are described and keyed stably", () => {
  assert.deepEqual(describeUrl("https://github.com/deepseek-ai/dsh-superagent-prototype"), { name: "deepseek-ai/dsh-superagent-prototype", area: "GitHub", github: { owner: "deepseek-ai", repo: "dsh-superagent-prototype" } });
  assert.equal(describeUrl("https://youtu.be/OrcsMi2-IcM?is=abc").area, "Video");
  assert.equal(describeUrl("https://example.com/feature").name, "example.com/feature");
  assert.throws(() => describeUrl("http://example.com"));
  assert.equal(watchId("https://youtu.be/OrcsMi2-IcM?is=a"), watchId("https://youtu.be/OrcsMi2-IcM?is=b"));
  assert.notEqual(watchId("https://www.youtube.com/watch?v=a"), watchId("https://www.youtube.com/watch?v=b"));
});

test("GitHub check reports release and commit without a model", async () => {
  const fake = (async (u: string) => ({ ok: true, status: 200, json: async () => u.includes("releases") ? { tag_name: "v2" } : [{ sha: "abcdef1234567890", commit: { message: "Add thing\n\nbody", committer: { date: "2026-11-02T10:00:00Z" } } }] })) as unknown as typeof fetch;
  const r = await checkGithub("https://github.com/o/r", fake);
  assert.equal(r.latest, "v2@abcdef123456");
  assert.match(r.summary, /Latest release v2\. Latest commit abcdef123456 \(2026-11-02\): Add thing$/);
  const down = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
  assert.equal((await checkGithub("https://github.com/o/r", down)).latest, undefined);
});
