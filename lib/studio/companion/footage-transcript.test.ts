import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createFootageTranscriber, transcriptLines } from "./footage-transcript";
import type { VideoTools } from "./video-tools";

const tools = (model: "downloaded" | undefined): VideoTools => ({ report: { ready: true, missing: [], tools: { model } } as never, paths: { python: "/py", ffmpeg: "/ff" }, home: "/h" });
test("returns null when the speech model is not installed, never calls a process", async () => {
  const t = createFootageTranscriber({ tools: async () => tools(undefined), scriptsDir: "/s", run: async () => { throw new Error("no"); } });
  assert.equal(await t("/f.mp4"), null);
});
test("extracts audio, runs the local script, and keeps only valid bounded segments", async () => {
  const calls: string[] = [];
  const t = createFootageTranscriber({ tools: async () => tools("downloaded"), scriptsDir: "/s", run: async r => {
    calls.push(r.command);
    if (r.command === "/py") await writeFile(join(r.cwd, "t.json"), JSON.stringify({ segments: [{ start: 1.234, end: 2.5, text: " Hi " }, { start: 3, end: 2, text: "bad" }, { start: 0, end: 1, text: "  " }] }));
    return { stdout: "", stderr: "" };
  } });
  assert.deepEqual(await t("/f.mp4"), [{ start: 1.23, end: 2.5, text: "Hi" }]);
  assert.deepEqual(calls, ["/ff", "/py"]);
});
test("transcript lines are time-coded and truncated", () => {
  assert.equal(transcriptLines([{ start: 0, end: 1, text: "a" }]), "0.0-1.0 a\n");
  assert.match(transcriptLines(Array.from({ length: 50 }, (_, i) => ({ start: i, end: i + 1, text: "x".repeat(40) })), 200), /truncated/);
});
