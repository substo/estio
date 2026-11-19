import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSourceNote, draftIdeaFromReactions, relatedSearchPhrase, SOURCE_NOTES_LIMIT } from "./source-assistant-policy";
import { summarizeComputerReadiness } from "./computer-readiness-policy";

test("appends a dated note and keeps existing notes verbatim", () => {
  const result = appendSourceNote("Earlier thought", "  Great hook in minute 2  ", new Date("2026-11-19T10:00:00Z"));
  assert.deepEqual(result, { ok: true, value: "Earlier thought\n\n[2026-11-19] Great hook in minute 2" });
  assert.deepEqual(appendSourceNote(undefined, "First", new Date("2026-01-02T00:00:00Z")), { ok: true, value: "[2026-01-02] First" });
});
test("rejects empty, oversized and overflowing notes without truncating", () => {
  assert.equal(appendSourceNote("", "   ").ok, false);
  assert.equal(appendSourceNote("", "x".repeat(4001)).ok, false);
  assert.equal(appendSourceNote("y".repeat(SOURCE_NOTES_LIMIT - 5), "more").ok, false);
});
test("idea draft uses the user's first sentence and falls back to the source title", () => {
  assert.deepEqual(draftIdeaFromReactions("Source", ["Show how an accountant films one tip a week. Then repurpose.", "Second"]), { title: "Show how an accountant films one tip a week.", summary: "Show how an accountant films one tip a week. Then repurpose.\n\nSecond" });
  assert.equal(draftIdeaFromReactions("Source", []).title, "Idea from Source");
  assert.ok(draftIdeaFromReactions("S", ["a".repeat(200)]).title.length <= 80);
});
test("related search phrase prefers the latest substantial reaction, else the title", () => {
  assert.equal(relatedSearchPhrase(["short", "formats for lawyers on youtube"], "T"), "formats for lawyers on youtube");
  assert.equal(relatedSearchPhrase(["hi"], "The title"), "The title");
});
test("computer readiness distinguishes none, ready, paused and offline", () => {
  assert.equal(summarizeComputerReadiness([]).tone, "none");
  assert.equal(summarizeComputerReadiness([{ name: "Mac", status: "revoked", processingEnabled: true }]).tone, "none");
  assert.equal(summarizeComputerReadiness([{ name: "Mac", status: "online", processingEnabled: true }]).tone, "ready");
  assert.match(summarizeComputerReadiness([{ name: "Mac", status: "paused", processingEnabled: true }]).label, /paused/);
  assert.match(summarizeComputerReadiness([{ name: "Mac", status: "offline", processingEnabled: true }]).label, /offline/);
});

import { saveSourceNote, type SourceNoteDeps } from "./source-note-service";
const source = { kind: "reference", title: "T", version: 4, archived: false, payload: { notes: "old", description: "keep" } };
function deps(over: Partial<SourceNoteDeps> = {}) {
  const saved: unknown[] = [];
  const base: SourceNoteDeps = { hasAccess: async () => true, getSource: async () => source, save: async (...args) => { saved.push(args); }, isConflict: error => (error as { code?: string }).code === "40001" };
  return { saved, deps: { ...base, ...over } };
}
test("note save patches only notes, appends, and is fenced to the version it read", async () => {
  const { saved, deps: d } = deps();
  assert.deepEqual(await saveSourceNote(d, "loc", "rec", "new thought", new Date("2026-11-19T00:00:00Z")), { ok: true });
  assert.deepEqual(saved, [["loc", "rec", { kind: "reference", title: "T", payload: { title: "T", notes: "old\n\n[2026-11-19] new thought" } }, 4]]);
});
test("note save refuses without access, for other Locations' or missing sources, channels and archived sources", async () => {
  for (const over of [{ hasAccess: async () => false }, { getSource: async () => null }, { getSource: async () => ({ ...source, kind: "channel" }) }, { getSource: async () => ({ ...source, archived: true }) }]) {
    const { saved, deps: d } = deps(over);
    assert.equal((await saveSourceNote(d, "loc", "rec", "x")).ok, false);
    assert.equal(saved.length, 0);
  }
});
test("note save reports a version conflict and a generic failure without saving twice", async () => {
  const conflict = await saveSourceNote(deps({ save: async () => { throw { code: "40001" }; } }).deps, "l", "r", "x");
  assert.match(conflict.ok ? "" : conflict.error, /another tab/);
  const other = await saveSourceNote(deps({ save: async () => { throw new Error("db"); } }).deps, "l", "r", "x");
  assert.match(other.ok ? "" : other.error, /try again/);
  assert.equal((await saveSourceNote(deps().deps, "l", "r", "   ")).ok, false);
});

import { computerTasks, type ComputerTaskInput } from "./computer-readiness-policy";
const device = (over: Partial<ComputerTaskInput> = {}): ComputerTaskInput => ({ status: "online", processingEnabled: true,
  config: { version: 3, appliedVersion: 3, status: "applied", value: { textProvider: "codex", features: { text: true, transcription: true } } },
  capabilities: { handlers: ["studio.text_run", "studio.video_transcribe"], codex: { authenticated: true, ready: true }, video: { ready: true }, youtubeSearch: { ready: true } },
  research: { ready: true, reason: null }, ...over });
test("every task is ready on a fully set up Mac", () => {
  assert.deepEqual(computerTasks(device()).map(t => t.ready), [true, true, true, true]);
});
test("a stopped, paused or switched-off Mac blocks tasks with the single next step", () => {
  const offline = computerTasks(device({ status: "offline" })).filter(t => !t.ready);
  assert.ok(offline.every(t => t.fix === "Start the companion"));
  const off = computerTasks(device({ processingEnabled: false, capabilities: {} }));
  assert.ok(off.every(t => t.fix === "Turn processing on"));
});
test("setup gaps give a specific fix", () => {
  const tasks = Object.fromEntries(computerTasks(device({ config: { version: 3, appliedVersion: 2, status: "pending", value: { textProvider: "codex", features: { text: true, transcription: false } } },
    capabilities: { handlers: ["studio.text_run", "studio.video_transcribe"], codex: { authenticated: false }, video: { ready: true } }, research: { ready: false, reason: "Paused" } })).map(t => [t.id, t]));
  assert.equal(tasks.transcribe.fix, "Open Setup");
  assert.match(tasks.assistant.detail, /apply/);
  assert.equal(tasks.related.fix, "Install Google Chrome");
  assert.equal(tasks.research.detail, "Paused");
});
