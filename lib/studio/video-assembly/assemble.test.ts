import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assembleVideo } from "./assemble";
import { parseScript } from "./script";
import { projectEnvFile, parseEnvFile, resolveSpeech, synthesizeFish, synthesizeSpeech } from "./tts";

test("script paragraphs become beats and directions attach to the next beat", () => {
  const beats = parseScript("# Title\n\n[show the dashboard]\n\nWelcome to Estio.\nIt is simple.\n\n(cut to phone)\n\nThanks!");
  assert.deepEqual(beats, [
    { index: 1, narration: "Welcome to Estio. It is simple.", direction: "show the dashboard" },
    { index: 2, narration: "Thanks!", direction: "cut to phone" },
  ]);
});

test("speech request uses eleven_v3 and the key header only", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const audio = await synthesizeSpeech({ text: "[excited] Hello", apiKey: "k", fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(Buffer.alloc(2000)); }) as typeof fetch });
  assert.equal(audio.length, 2000);
  assert.match(seen!.url, /text-to-speech\/21m00Tcm4TlvDq8ikWAM\?output_format=mp3/);
  assert.equal(JSON.parse(String(seen!.init.body)).model_id, "eleven_v3");
  await assert.rejects(synthesizeSpeech({ text: "x", apiKey: "k", voiceId: "../bad", fetchImpl: fetch }), /invalid_voice_id/);
});

test("assembly voices each beat, creates the project and runs the agent with substo only", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mov"), "x"); await writeFile(join(clips, "notes.txt"), "x");
    const calls: { command: string; args: string[]; input?: string }[] = [];
  const result = await assembleVideo({ script: "One.\n\nTwo.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: true, music: true,
    speak: { provider: "fish", label: "Fish", speak: async () => Buffer.alloc(2000) }, run: async r => { calls.push(r); return { stdout: r.command === "ffprobe" ? "2.0" : "done", stderr: "" }; } });
  assert.deepEqual(result.timings, [0, 2.35]);
  assert.deepEqual(result.voiceFiles, ["voice-01.mp3", "voice-02.mp3"]);
  assert.deepEqual((await readdir(project)).sort(), ["a.mov", "voice-01.mp3", "voice-02.mp3"]);
  const agent = calls.find(c => c.command === "claude")!;
  assert.ok(calls.some(c => c.command === "substo"));
  assert.ok(agent.args.includes("Bash(substo:*),Read"));
  assert.match(agent.input!, /voice-02\.mp3/);
  assert.match(agent.input!, /place at 2.35s/);
  assert.match(agent.input!, /music bed/);
});

test("dry run makes no project and no spend", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  await writeFile(join(clips, "a.mp4"), "x");
  const result = await assembleVideo({ script: "Hi.", clipsDir: clips, projectDir: project, editorDocs: "/d", voiceover: true, dryRun: true, run: async () => { throw new Error("no"); }, speak: { provider: "fish", label: "x", speak: async () => { throw new Error("no"); } } });
  assert.equal(result.beats, 1);
});

test("fish request uses the bearer key, model header and reference_id", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const audio = await synthesizeFish({ text: "[laugh] Hi", apiKey: "fk", voiceId: "abcdef123456", fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(Buffer.alloc(2000)); }) as typeof fetch });
  assert.equal(audio.length, 2000);
  assert.equal(seen!.url, "https://api.fish.audio/v1/tts");
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer fk"); assert.equal(h.model, "s2-pro");
  const body = JSON.parse(String(seen!.init.body)); assert.equal(body.reference_id, "abcdef123456"); assert.equal(body.format, "mp3");
  await assert.rejects(synthesizeFish({ text: "x", apiKey: "k", voiceId: "../x", fetchImpl: fetch }), /invalid_voice_id/);
});

test("keys file parses values, skips comments and empties; engine choice follows keys", async () => {
  assert.deepEqual(parseEnvFile("# c\nFISH_API_KEY=abc\nFISH_VOICE_ID=\nELEVENLABS_API_KEY=\"q\"\n"), { FISH_API_KEY: "abc", ELEVENLABS_API_KEY: "q" });
  const dir = await mkdtemp(join(tmpdir(), "keys-")); const file = join(dir, "k.env");
  await writeFile(file, "FISH_API_KEY=fk\nELEVENLABS_API_KEY=ek\n");
  assert.equal((await resolveSpeech({}, file))?.provider, "fish");
  await writeFile(file, "STUDIO_TTS_PROVIDER=elevenlabs\nFISH_API_KEY=fk\nELEVENLABS_API_KEY=ek\n");
  assert.equal((await resolveSpeech({}, file))?.provider, "elevenlabs");
  await writeFile(file, "STUDIO_TTS_PROVIDER=fish\n");
  assert.equal(await resolveSpeech({}, file), null);
});

test("keys come from the original project's .env, from any worktree", () => {
  assert.equal(projectEnvFile(join(__dirname), {}).endsWith("/Estio/.env"), true);
  assert.equal(projectEnvFile(__dirname, { STUDIO_ENV_FILE: "/x/.env" }), "/x/.env");
});
