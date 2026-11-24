import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript } from "./video-assembly/script";
import { audioHash, beatAudio, blockAudioStatus, blocksDoc, blocksToScript, insertBlockAfter, moveBlock, moveBlockTo, parseScriptBlocks, reconcileBlocks, removeBlock, scriptToBlocks, setBlockAudio,
  setBlockText, setBlockType, splitBlock, type ScriptBlock } from "./script-blocks";

const counter = () => { let n = 0; return () => `b${++n}`; };
const SCRIPT = "# Intro\n\n[open on the dashboard]\n\nWelcome to Estio.\nIt is simple.\n\n(cut to phone)\n\nThanks!\n\n# ---\n\n## Outro";

test("plain script becomes blocks without losing a line", () => {
  const blocks = scriptToBlocks(SCRIPT, counter());
  assert.deepEqual(blocks.map(b => [b.type, b.text]), [["heading", "Intro"], ["visual", "open on the dashboard"], ["narration", "Welcome to Estio.\nIt is simple."], ["visual", "cut to phone"], ["narration", "Thanks!"], ["break", ""], ["heading", "Outro"]]);
  assert.equal(blocks[6].level, 2);
});

test("blocks -> script -> blocks is stable, and Make video still sees the same beats", () => {
  const blocks = scriptToBlocks(SCRIPT, counter());
  const script = blocksToScript(blocks);
  assert.deepEqual(scriptToBlocks(script, counter()).map(({ type, text, level }) => ({ type, text, level })), blocks.map(({ type, text, level }) => ({ type, text, level })));
  const beats = parseScript(script);
  assert.deepEqual(beats.map(b => [b.narration, b.direction]), [["Welcome to Estio. It is simple.", "open on the dashboard"], ["Thanks!", "cut to phone"]]);
});

test("a blank line inside narration cannot split one block into two beats", () => {
  const script = blocksToScript([{ id: "a", type: "narration", text: "One.\n\nTwo." }]);
  assert.equal(parseScript(script).length, 1);
});

test("audio status: none, fresh, then stale after a text or voice change", () => {
  const voice = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  let blocks: ScriptBlock[] = [{ id: "a", type: "narration", text: "Hello there." }, { id: "h", type: "heading", text: "T" }];
  assert.equal(blockAudioStatus(blocks[0], voice), "none"); assert.equal(blockAudioStatus(blocks[1], voice), null);
  blocks = setBlockAudio(blocks, "a", { hash: audioHash(voice, "Hello there."), uploadId: "33333333-3333-4333-8333-333333333333", voiceId: voice, at: "2026-11-24T00:00:00Z" });
  assert.equal(blockAudioStatus(blocks[0], voice), "fresh");
  assert.equal(blockAudioStatus(blocks[0], other), "stale");
  assert.equal(blockAudioStatus(setBlockText(blocks, "a", "Hello, there.")[0], voice), "stale");
  assert.equal(blockAudioStatus(setBlockText(blocks, "a", "Hello   there. ")[0], voice), "fresh", "whitespace alone does not invalidate audio");
  assert.equal(blockAudioStatus(setBlockType(blocks, "a", "visual")[0], voice), null);
});

test("reorder, insert, split, remove", () => {
  const b = scriptToBlocks("A\n\nB\n\nC", counter());
  assert.deepEqual(moveBlock(b, "b3", -1).map(x => x.text), ["A", "C", "B"]);
  assert.deepEqual(moveBlock(b, "b1", -1).map(x => x.text), ["A", "B", "C"]);
  assert.deepEqual(moveBlockTo(b, "b1", 2).map(x => x.text), ["B", "C", "A"]);
  assert.deepEqual(insertBlockAfter(b, "b1", "visual", "n", "x").map(x => x.id), ["b1", "n", "b2", "b3"]);
  assert.deepEqual(insertBlockAfter(b, null, "heading", "n")[0].level, 1);
  const split = splitBlock([{ id: "a", type: "narration", text: "Hello world" }], "a", 5, "z");
  assert.deepEqual(split.map(x => x.text), ["Hello", " world"]);
  assert.deepEqual(removeBlock(b, "b2").map(x => x.text), ["A", "C"]);
});

test("stored documents are validated and bounded", () => {
  assert.equal(parseScriptBlocks({ version: 2, blocks: [] }), null);
  assert.equal(parseScriptBlocks({ version: 1, blocks: [{ id: "a", type: "narration", text: "x" }, { id: "a", type: "narration", text: "y" }] }), null, "duplicate id");
  assert.equal(parseScriptBlocks({ version: 1, blocks: [{ id: "a", type: "evil", text: "x" }] }), null);
  assert.equal(parseScriptBlocks({ version: 1, blocks: [{ id: "a", type: "narration", text: "x", audio: { hash: "nothex", uploadId: "u", voiceId: "v", at: "t" } }] }), null);
  const ok = parseScriptBlocks({ version: 1, blocks: [{ id: "a", type: "narration", text: "x", extra: 1 }] });
  assert.deepEqual(ok, blocksDoc([{ id: "a", type: "narration", text: "x" }]));
});

test("a script changed elsewhere re-derives blocks and keeps audio for unchanged narration", () => {
  const voice = "11111111-1111-4111-8111-111111111111";
  const audio = { hash: audioHash(voice, "Keep me."), uploadId: "33333333-3333-4333-8333-333333333333", voiceId: voice, at: "t" };
  const stored = blocksDoc([{ id: "a", type: "narration", text: "Keep me.", audio }, { id: "b", type: "narration", text: "Old line." }]);
  assert.equal(reconcileBlocks({ script: blocksToScript(stored.blocks), scriptBlocks: stored }, counter())[0].id, "a", "in sync: blocks used as stored");
  const next = reconcileBlocks({ script: "Keep me.\n\nBrand new.", scriptBlocks: stored }, counter());
  assert.deepEqual(next.map(b => [b.text, Boolean(b.audio)]), [["Keep me.", true], ["Brand new.", false]]);
  assert.deepEqual(reconcileBlocks({ script: "Only text." }, counter()).map(b => b.text), ["Only text."]);
});

test("beat n maps to the n-th narration block and only fresh audio is reused", () => {
  const voice = "11111111-1111-4111-8111-111111111111";
  let blocks = scriptToBlocks("[v]\n\nOne.\n\nTwo.\n\nThree.", counter());
  const upload = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
  const nar = blocks.filter(b => b.type === "narration");
  blocks = setBlockAudio(blocks, nar[0].id, { hash: audioHash(voice, "One."), uploadId: upload(1), voiceId: voice, at: "t" });
  blocks = setBlockAudio(blocks, nar[2].id, { hash: audioHash(voice, "Old three."), uploadId: upload(3), voiceId: voice, at: "t" });
  assert.deepEqual([...beatAudio(blocks, voice)], [[1, upload(1)]]);
});
