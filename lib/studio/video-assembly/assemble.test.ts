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
  assert.match(brief, /FOOTAGE NEEDED: <the beat's visual note in at most 8 words>/);
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

test("source quotes trim the selected private upload, leave room in the narration timeline, and keep original sound", async () => {
  const asset = "10000000-0000-4000-8000-000000000001";
  const clips = await mkdtemp(join(tmpdir(), "clip-quote-")), project = await mkdtemp(join(tmpdir(), "proj-quote-"));
  await writeFile(join(clips, "interview.mp4"), "video");
  const cue = `[Source clip: ${JSON.stringify({ asset, start: 1.25, end: 3.5, credit: "Guest · interview" })}]`;
  const calls: Array<{ command: string; args: string[]; input?: string }> = [];
  const result = await assembleVideo({
    script: `Before.\n\n${cue}\n\nAfter.`, clipsDir: clips, footageNames: new Map([[asset, "interview.mp4"]]),
    projectDir: project, editorDocs: "/docs", voiceover: true, speak: { label: "test", speak: async () => Buffer.alloc(10) },
    run: async call => {
      calls.push(call);
      return { stdout: call.command === "ffprobe" ? call.args.at(-1)?.endsWith(".mp3") ? "2" : "12" : "", stderr: "" };
    },
  });
  const ffmpeg = calls.find(call => call.command === "ffmpeg")!;
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf("-ss") + 1], "1.25");
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf("-t") + 1], "2.25");
  assert.ok(ffmpeg.args.includes("0:a:0?"));
  assert.deepEqual(result.timings, [0, 4.6]);
  assert.deepEqual(result.clips, []);
  assert.match(result.brief, /before spoken beat 2 · on-screen credit "Guest · interview"/);
  assert.match(result.brief, /unmuted, without overlapping narration/);
  await assert.rejects(assembleVideo({
    script: `Before.\n\n${cue}`, clipsDir: clips, projectDir: project, editorDocs: "/docs", dryRun: true,
  }), /uploaded source clip.*unavailable/);
});

test("filmed shots are matched to their beats, re-shot beats use only the newest take, and WebM takes are converted", async () => {
  const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
  for (const f of ["Shot 01 take 1.mp4", "Shot 01 take 2.mp4", "Shot 02 take 1.webm", "broll.mov"]) await writeFile(join(clips, f), "x");
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const result = await assembleVideo({ script: "[wide, at my desk]\n\nOne.\n\nTwo.", clipsDir: clips, projectDir: project, editorDocs: "/docs", voiceover: false,
    run: async r => { calls.push(r); if (r.command === "ffmpeg") await writeFile(r.args[r.args.length - 1], "mp4"); return { stdout: "done", stderr: "" }; } });
  assert.ok(!result.clips.includes("Shot 01 take 1.mp4"));
  assert.ok(result.clips.includes("Shot 02 take 1.mp4"));
  assert.ok(calls.some(c => c.command === "ffmpeg"));
  assert.match(result.brief, /1\. "One\."  \[visual: wide, at my desk\]  \[filmed footage for this beat: Shot 01 take 2\.mp4\]/);
  assert.match(result.brief, /2\. "Two\." {2}\[filmed footage for this beat: Shot 02 take 1\.mp4\]/);
});

test("different editing and motion models run two passes; the same model runs one, and the result says what ran", async () => {
  const run = async (opts: { model?: string; motionModel?: string; motion?: { style: "clean" | "minimal" } }) => {
    const clips = await mkdtemp(join(tmpdir(), "clips-")), project = await mkdtemp(join(tmpdir(), "proj-"));
    await writeFile(join(clips, "a.mov"), "x");
    const agents: { args: string[]; input?: string }[] = [];
    const result = await assembleVideo({ script: "One.", clipsDir: clips, projectDir: project, editorDocs: "/docs", ...opts,
      run: async r => { if (r.command === "claude") agents.push(r); return { stdout: "done", stderr: "" }; } });
    return { agents, result };
  };
  const two = await run({ model: "claude-sonnet-5-5", motionModel: "claude-opus-5-5", motion: { style: "clean" } });
  assert.equal(two.agents.length, 2);
  assert.deepEqual(two.agents.map(a => a.args[a.args.indexOf("--model") + 1]), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.match(two.agents[0].input!, /separate pass/);
  assert.match(two.agents[1].input!, /Plain-background check FIRST/);
  assert.deepEqual(two.result.ran, { edit: "claude-sonnet-5-5", motion: "claude-opus-5-5" });
  const one = await run({ model: "claude-sonnet-5-5", motionModel: "claude-sonnet-5-5", motion: { style: "clean" } });
  assert.equal(one.agents.length, 1);
  assert.deepEqual(one.result.ran, { edit: "claude-sonnet-5-5", motion: "claude-sonnet-5-5" });
  const defaults = await run({});
  assert.equal(defaults.agents.length, 1);
  assert.ok(!defaults.agents[0].args.includes("--model"));
  const minimal = await run({ model: "a", motionModel: "b", motion: { style: "minimal" } });
  assert.equal(minimal.agents.length, 1);
});
