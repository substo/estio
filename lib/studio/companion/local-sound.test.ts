import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalSoundMaker, soundSeconds } from "./local-sound";

const tools = async () => ({ report: {} as never, paths: { ffmpeg: "/bin/ffmpeg", python: "/venv/python" }, home: "/h" });
test("the bed is sized to the script and clamped", () => {
  assert.equal(soundSeconds(0), 30);
  assert.equal(soundSeconds(250), 106);
  assert.equal(soundSeconds(100000), 180);
});
test("music runs the synth then ffmpeg with fixed argv and no shell", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const make = createLocalSoundMaker({ tools, scriptsDir: "/s", run: async r => { calls.push({ command: r.command, args: r.args }); return { stdout: "", stderr: "" } as never; } });
  assert.equal(await make("music", 61.4, "/out/music-bed.mp3"), true);
  assert.equal(calls[0].command, "/venv/python");
  assert.deepEqual(calls[0].args.slice(0, 1), ["-I"]);
  assert.equal(calls[0].args[1], "/s/synth-sound.py");
  assert.equal(calls[0].args[2], "music");
  assert.equal(calls[0].args[4], "61");
  assert.equal(calls[1].command, "/bin/ffmpeg");
  assert.ok(calls[1].args.includes("/out/music-bed.mp3"));
});
test("the whoosh takes no length", async () => {
  const calls: string[][] = [];
  const make = createLocalSoundMaker({ tools, scriptsDir: "/s", run: async r => { calls.push(r.args); return { stdout: "", stderr: "" } as never; } });
  await make("sfx", 99, "/out/whoosh.mp3");
  assert.deepEqual(calls[0].slice(2, 3), ["sfx"]);
  assert.equal(calls[0].length, 4);
});
test("a failure or missing ffmpeg gives false, never a throw", async () => {
  const bad = createLocalSoundMaker({ tools, scriptsDir: "/s", run: async () => { throw new Error("boom"); } });
  assert.equal(await bad("music", 40, "/o.mp3"), false);
  const none = createLocalSoundMaker({ tools: async () => ({ report: {} as never, paths: {}, home: "/h" }), scriptsDir: "/s" });
  assert.equal(await none("sfx", 1, "/o.mp3"), false);
});
