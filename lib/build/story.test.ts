import test from "node:test";
import assert from "node:assert/strict";
import { keepStory, makeStory, plain, richParts, shortUrl, storyInput, storyLimits, storyOf } from "./story";
import { decisionsOf, playbookDefaults } from "./playbook";
import { externalCommand, setStory, storyCommand, trackExternal } from "./external";

const report = `Implemented the change. Checks: 4 tests pass.

**Story:**
Area: Business data
Concept: Business details now live in one profile instead of three places (commit 9fd35f7c606c).
**Achieved:**
- One Business profile with \`location.business\`
- Readers moved to it
  including print and Studio
How it works:
1. Location keeps name and domain
2. See [onboarding](https://estio.co/admin/onboarding) and https://github.com/substo/estio/pull/12.
### Next
- Move CRM integration settings

Decisions:
- Kept the old column for one release: rollback safety`;

test("storyOf reads the Story section and stops at Decisions", () => {
  const s = storyOf(report)!;
  assert.equal(s.area, "Business data");
  assert.equal(s.concept, "Business details now live in one profile instead of three places (commit).");
  assert.deepEqual(s.achieved, ["One Business profile with location.business", "Readers moved to it including print and Studio"]);
  assert.equal(s.howItWorks.length, 2);
  assert.deepEqual(s.next, ["Move CRM integration settings"]);
  assert.match(decisionsOf(report)!, /rollback safety/);
});
test("Decisions before Story keep their own text; reports without a story or concept give null", () => {
  const swapped = "Done.\nDecisions: none\nStory:\nConcept: A thing.\nAchieved:\n- It works";
  assert.equal(decisionsOf(swapped), "none");
  assert.equal(storyOf(swapped)?.concept, "A thing.");
  assert.equal(storyOf("No story here. Storyline: none"), null);
  assert.equal(storyOf("Story:\nAchieved:\n- something"), null);
});
test("long stories are trimmed to the limits, never rejected", () => {
  const long = `Story:\nConcept: ${"word ".repeat(400)}\nAchieved:\n${Array.from({ length: 30 }, (_, i) => `- item ${i} ${"x".repeat(400)}`).join("\n")}`;
  const s = storyOf(long)!;
  assert.ok(s.concept.length <= storyLimits.concept);
  assert.equal(s.achieved.length, storyLimits.achieved);
  assert.ok(s.achieved.every(a => a.length <= storyLimits.item));
});
test("story schema is bounded, strict and plain", () => {
  assert.ok(!storyInput.safeParse({ concept: "" }).success);
  assert.ok(!storyInput.safeParse({ concept: "ok", extra: 1 }).success);
  assert.ok(!storyInput.safeParse({ concept: "ok", next: Array(9).fill("n") }).success);
  assert.ok(!storyInput.safeParse({ concept: "ok", achieved: ["x".repeat(281)] }).success);
  assert.equal(plain("Deployed `abc` at 4ac778e2 and da138858/7593c2e0 , done"), "Deployed abc at and /, done");
  assert.equal(plain("Numbers 1234567 and words like defaced stay"), "Numbers 1234567 and words like defaced stay");
});
test("links render as short labels", () => {
  assert.equal(shortUrl("https://www.estio.co/admin/onboarding/"), "estio.co/admin/onboarding");
  assert.equal(shortUrl("https://github.com/coleam00/ai-software-factory/tree/main"), "coleam00/ai-software-factory");
  const parts = richParts("See [the guide](https://x.dev/a) or https://estio.co/b.");
  assert.deepEqual(parts, [{ text: "See " }, { text: "the guide", href: "https://x.dev/a" }, { text: " or " }, { text: "estio.co/b", href: "https://estio.co/b" }, { text: "." }]);
});
test("a rewritten checkpoint keeps its story unless it brings a new one", () => {
  const story = makeStory({ concept: "Old", achieved: [], howItWorks: [], next: [] }, "owner");
  assert.deepEqual((keepStory({ story }, { nextStep: "x" }) as { story?: unknown }).story, story);
  const fresh = makeStory({ concept: "New", achieved: [], howItWorks: [], next: [] }, "task");
  assert.equal((keepStory({ story }, { story: fresh }) as { story: { concept: string } }).story.concept, "New");
  assert.ok(!("story" in keepStory({}, { story: undefined, a: 1 })));
});
test("the task playbook asks for a Story before Decisions", () => {
  const t = playbookDefaults.task.text;
  assert.ok(t.indexOf("Story:") > 0 && t.indexOf("Story:") < t.lastIndexOf("Decisions:"));
});
test("external reports keep the story; several records per thread; story command on any record", async () => {
  const threadId = "d9a3da99-00a7-473c-93c5-3053312d0661";
  const story = makeStory({ concept: "Kept", achieved: [], howItWorks: [], next: [] }, "worker");
  let written: any;
  const tx: any = { buildJob: {
    findUnique: async ({ where }: any) => ({ id: where.id, revision: 2, state: "external-working", checkpoint: { story } }),
    update: async (v: any) => { written = v; return { ...v.data, revision: 3 }; },
  } };
  const update = externalCommand.parse({ threadId, key: "business-data", revision: 2, status: "working", note: "Still going" });
  const result = await trackExternal(tx, update);
  assert.equal(result.id, `external-t3:${threadId}:business-data`);
  assert.equal(written.data.checkpoint.story.concept, "Kept");
  assert.ok(!externalCommand.safeParse({ threadId, key: "Bad Key", revision: 2, status: "working", note: "x" }).success);
  const cmd = storyCommand.parse({ action: "story", id: "cmw2e0j33000na4cuvm5tqege", story: { concept: "Plain words" } });
  const set = await setStory(tx, cmd.id, cmd.story, "owner");
  assert.equal(set.story.by, "owner");
  assert.equal(written.data.checkpoint.story.concept, "Plain words");
  assert.ok(!("revision" in written.data));
});
