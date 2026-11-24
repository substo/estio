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

import { modelFilter, MODEL_MAX_SECONDS } from "./local-sound";
test("a model-made bed loops to the video length only when it is shorter, and fades its tail", () => {
  assert.match(modelFilter("music", 200, MODEL_MAX_SECONDS), /^aloop=loop=-1:size=2147483647,atrim=0:200,afade=t=out:st=198:d=2,loudnorm/);
  assert.doesNotMatch(modelFilter("music", 60, 60), /aloop/);
  assert.match(modelFilter("music", 60, 60), /afade=t=out:st=58:d=2/);
  assert.equal(modelFilter("sfx", 1.5, 1.5), "loudnorm=I=-20:TP=-2");
});

test("an installed model makes the sound with a fixed command; a model that fails falls back to the synth", async () => {
  const calls: { command: string; args: string[] }[] = [];
  let failModel = false;
  const run = async (spec: { command: string; args: string[] }) => { calls.push(spec); if (failModel && spec.args.includes("mlx_audio.music.generate")) throw new Error("oom"); return { stdout: "", stderr: "", code: 0 } as never; };
  const make = createLocalSoundMaker({ tools, scriptsDir: "/scripts", run: run as never, model: async role => role === "music" ? "mlx-community/stable-audio-3-small-music" : null, modelPython: "/venv/tts/bin/python" });
  assert.equal(await make("music", 90, "/out/music.mp3"), true);
  assert.equal(calls[0].command, "/venv/tts/bin/python");
  assert.deepEqual(calls[0].args.slice(0, 5), ["-m", "mlx_audio.music.generate", "--model", "mlx-community/stable-audio-3-small-music", "--caption"]);
  assert.ok(calls[0].args.includes("90"));
  calls.length = 0; failModel = true;
  assert.equal(await make("music", 90, "/out/music.mp3"), true);
  assert.ok(calls.some(c => c.args.some(a => a.endsWith("synth-sound.py"))));
  calls.length = 0;
  assert.equal(await make("sfx", 1, "/out/whoosh.mp3"), true);   // no sfx model installed: synth
  assert.ok(calls.every(c => !c.args.includes("mlx_audio.music.generate")));
});
