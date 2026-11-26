import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assembleVideo } from "./assemble";
import { parseScript } from "./script";

test("script paragraphs become beats and directions attach to the next beat", () => {
  const beats = parseScript("# Title\n\n[show the dashboard]\n\nWelcome to Estio.\nIt is simple.\n\n(cut to phone)\n\nThanks!");
  assert.deepEqual(beats, [
    { index: 1, narration: "Welcome to Estio. It is simple.", direction: "show the dashboard" },
    { index: 2, narration: "Thanks!", direction: "cut to phone" },
  ]);
});

test("assembly voices each beat, creates the project and runs the agent with substo only", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "notes.txt"), "x");
  const spoken: string[] = [];
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const result = await assembleVideo({ script: "HOST\nOne.\n\n[Speaker: Maya]\nTwo.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: true, music: true,
    speak: { label: "test", speak: async text => { spoken.push(text); return Buffer.alloc(2000); } }, run: async r => { calls.push(r); return { stdout: r.command === "ffprobe" ? "2.0" : "done", stderr: "" }; } });
  assert.deepEqual(spoken, ["One.", "Two."]);
  assert.deepEqual(result.timings, [0, 2.35]);
  assert.deepEqual(result.voiceFiles, ["voice-01.mp3", "voice-02.mp3"]);
  assert.deepEqual((await readdir(project)).sort(), ["a.mov", "voice-01.mp3", "voice-02.mp3"]);
  const agent = calls.find(c => c.command === "claude")!;
  assert.ok(calls.some(c => c.command === "substo"));
  assert.ok(agent.args.includes("Bash(substo:*),Read,Edit(./batch-*.json),Edit(./graphic-*.html)"));
  assert.match(agent.input!, /speaker: "Maya"; on-screen credit only/);
  assert.match(agent.input!, /voice-02\.mp3/);
  assert.match(agent.input!, /place at 2.35s/);
  assert.match(agent.input!, /music bed/);
});

test("dry run makes no project and no spend", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mp4"), "x");
  const result = await assembleVideo({ script: "Hi.", clipsDir: clips, projectDir: project, editorDocs: "/d", voiceover: true, dryRun: true, run: async () => { throw new Error("no"); }, speak: { label: "x", speak: async () => { throw new Error("no"); } } });
  assert.equal(result.beats, 1);
});

test("pre-rendered narration is copied in beat order and kept out of the footage list", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "narration-001.mp3"), "one"); await writeFile(join(clips, "narration-002.mp3"), "two");
  const result = await assembleVideo({ script: "One.\n\nTwo.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: true,
    voice: { engine: "prerendered", files: ["narration-001.mp3", "narration-002.mp3"] }, run: async r => ({ stdout: r.command === "ffprobe" ? "1.5" : "done", stderr: "" }) });
  assert.deepEqual(result.clips, ["a.mov"]);
  assert.deepEqual((await readdir(project)).sort(), ["a.mov", "voice-01.mp3", "voice-02.mp3"]);
  assert.equal(await readFile(join(project, "voice-02.mp3"), "utf8"), "two");
  await assert.rejects(assembleVideo({ script: "One.\n\nTwo.", clipsDir: clips, projectDir: project, editorDocs: "/d", voiceover: true, voice: { engine: "prerendered", files: ["narration-001.mp3"] }, run: async () => ({ stdout: "", stderr: "" }) }), /does not match the script/);
});

test("voiceover without a chosen voice is refused before any work", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x");
  await assert.rejects(assembleVideo({ script: "One.", clipsDir: clips, projectDir: project, editorDocs: "/d", voiceover: true, run: async () => ({ stdout: "", stderr: "" }) }), /Choose a voice/);
});

test("server-made music and whoosh are kept out of the footage, copied into the project and named in the brief", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "music-bed.mp3"), "m"); await writeFile(join(clips, "whoosh.mp3"), "w");
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const result = await assembleVideo({ script: "One.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: false, music: true, sounds: { music: "music-bed.mp3", sfx: "whoosh.mp3" },
    run: async r => { calls.push(r); return { stdout: "done", stderr: "" }; } });
  assert.deepEqual(result.clips, ["a.mov"]);   // never treated as footage
  assert.deepEqual((await readdir(project)).sort(), ["a.mov", "music-bed.mp3", "whoosh.mp3"]);
  const brief = calls.find(c => c.command === "claude")!.input!;
  assert.match(brief, /Place music-bed\.mp3 .* -31 dB .* 2 s fade out/);
  assert.match(brief, /Use whoosh\.mp3 .* -15 dB/);
  assert.doesNotMatch(brief, /substo assets/);
});

test("without supplied sound files the brief does not promise any, and music off means no music", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x");
  const brief = async (music: boolean) => { const calls: { command: string; input?: string }[] = []; await assembleVideo({ script: "One.", clipsDir: clips, projectDir: await mkdtemp(join(tmpdir(), "proj-")), editorDocs: "/docs", voiceover: false, music, run: async r => { calls.push(r); return { stdout: "done", stderr: "" }; } }); return calls.find(c => c.command === "claude")!.input!; };
  assert.match(await brief(true), /No music bed file was supplied.*add no music/);
  assert.match(await brief(true), /add no effects/);
  assert.match(await brief(false), /Do not add music/);
  void project;
});

test("the storyboard photo is kept out of the footage, copied into the project, and the brief swaps the grey card for it", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "storyboard-avatar.png"), "p");
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const result = await assembleVideo({ script: "One.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: false, avatar: "storyboard-avatar.png", run: async r => { calls.push(r); return { stdout: "done", stderr: "" }; } });
  assert.deepEqual(result.clips, ["a.mov"]);
  assert.deepEqual((await readdir(project)).sort(), ["a.mov", "storyboard-avatar.png"]);
  const brief = calls.find(c => c.command === "claude")!.input!;
  assert.match(brief, /storyboard-avatar\.png/);
  assert.match(brief, /placeMedia/);
  assert.match(brief, /FOOTAGE NEEDED: <the beat's visual note>/);
  assert.doesNotMatch(brief, /solid-colour or title-card clip/);
});

test("an unexpected avatar name is ignored and the plain labelled card is used", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "me.png"), "p");
  const calls: { command: string; args: string[]; input?: string }[] = [];
  await assembleVideo({ script: "One.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: false, avatar: "me.png", run: async r => { calls.push(r); return { stdout: "done", stderr: "" }; } });
  assert.deepEqual((await readdir(project)).sort(), ["a.mov"]);
  assert.match(calls.find(c => c.command === "claude")!.input!, /solid-colour or title-card clip/);
});
