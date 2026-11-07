import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundTalkWhere, freshStarts, startDigest, planKey } from "./talk-policy";
test("background selection includes bound idle/waiting only", () => {
  assert.deepEqual(backgroundTalkWhere, { state: { in: ["idle", "waiting"] }, threadId: { not: null } });
});
const items = [{ title: "Unread badge", outcome: "Counts per channel", reason: "Owner asked", scope: ["components/inbox/channel-list.tsx"], acceptance: ["Badge shows unread count"] }];
const saved = { runId: "p", items };
const concrete = { role: "assistant", text: "```json\n" + JSON.stringify({ plan: items }) + "\n```", runId: "p" };
test("Start requires a preceding saved plan, user provenance and fresh digest", () => {
  const start = { role: "user", text: "Start", runId: "s" };
  const plan = concrete;
  assert.equal(freshStarts("t", saved, [start, plan], []).length, 0);
  assert.equal(freshStarts("t", saved, [plan, start], []).length, 1);
  assert.equal(freshStarts("t", saved, [plan, start], [startDigest("t", start)]).length, 0);
  for (const m of [{ ...start, role: "assistant" }, { ...start, runId: undefined }, { ...start, text: "Please Start" }]) assert.equal(freshStarts("t", saved, [plan, m], []).length, 0);
  assert.equal(freshStarts(null, saved, [plan, start], []).length, 0);
});

test("proposal identities are stable and distinguish talk, plan and task", () => {
  const key = planKey("talk", "run", 0);
  assert.equal(key, planKey("talk", "run", 0));
  for (const other of [planKey("other", "run", 0), planKey("talk", "next", 0), planKey("talk", "run", 1)]) assert.notEqual(key, other);
});

test("interim messages never establish approval; latest concrete plan wins", () => {
  const interim = { role: "assistant", runId: "p", text: "Preparing a plan" };
  const start = { role: "user", runId: "s", text: "Start it" };
  assert.equal(freshStarts("t", saved, [interim, start, concrete], []).length, 0);
  assert.equal(freshStarts("t", saved, [concrete, { ...concrete, runId: "other" }, start], []).length, 0);
  assert.equal(freshStarts("t", saved, [concrete, { ...concrete, text: concrete.text.replace("Unread badge", "Different task") }, start], []).length, 0);
});
test("first running snapshot approves once; terminal snapshot cannot replay Start", () => {
  const messages = [concrete, { role: "user", runId: "s", text: "Start" }];
  const seen: string[] = [];
  const running = freshStarts("t", saved, messages, seen);
  assert.equal(running.length, 1);
  seen.push(...running.map(m => startDigest("t", m)));
  assert.equal(freshStarts("t", saved, messages, seen).length, 0);
});

test("stored JSON key order does not change the approved plan identity", () => {
  const reordered = items.map(item => Object.fromEntries(Object.entries(item).reverse()));
  assert.equal(freshStarts("t", { runId: "p", items: reordered }, [concrete, { role: "user", runId: "s", text: "Start" }], []).length, 1);
});
