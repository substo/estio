import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { catalogModel, hubFolder, modelFit, readDesiredModels, readReportedModels, recommendedModels } from "../local-models";
import { detectModel, ModelManager } from "./model-manager";
import type { ProcessRunner } from "./process";

const qwen = catalogModel("qwen3-tts-0.6b-4bit")!;
async function plant(hub: string, model = qwen, bytes = model.files[0].minBytes, revision = model.revision) {
  const dir = join(hub, hubFolder(model.repo), "snapshots", revision); await mkdir(dir, { recursive: true });
  for (const f of model.files) { const body = Buffer.alloc(1); await writeFile(join(dir, f.path), body); await (await import("node:fs/promises")).truncate(join(dir, f.path), f.path === model.files[0].path ? bytes : f.minBytes); }
}
const setup = async () => { const home = await mkdtemp(join(tmpdir(), "mm-")); return { home, hub: join(home, "hub"), venv: join(home, "venv") }; };

test("an empty or partial cache folder is not installed; a full one is", async () => {
  const { hub } = await setup();
  assert.equal(await detectModel(qwen, hub), null);
  await plant(hub, qwen, 10); assert.equal(await detectModel(qwen, hub), null);
  await plant(hub); assert.equal(await detectModel(qwen, hub), "pinned");
  const other = await setup(); await plant(other.hub, qwen, qwen.files[0].minBytes, "deadbeef"); assert.equal(await detectModel(qwen, other.hub), "other");
});

test("fit: 8 GB Mac is tight for the catalog, tiny disk refuses, recommendations never pick a model that cannot run", () => {
  assert.equal(modelFit(qwen, { memoryGb: 8, freeDiskGb: 100 }).level, "tight");
  assert.equal(modelFit(qwen, { memoryGb: 16, freeDiskGb: 100 }).level, "ok");
  assert.equal(modelFit(qwen, { memoryGb: 4, freeDiskGb: 100 }).level, "no");
  assert.equal(modelFit(qwen, { memoryGb: 16, freeDiskGb: 2 }).level, "no");
  assert.deepEqual(recommendedModels({ memoryGb: 8, freeDiskGb: 50 }, ["voice", "transcription"]), ["qwen3-tts-0.6b-4bit", "parakeet-tdt-0.6b-v3"]);
  assert.deepEqual(recommendedModels({ memoryGb: 4, freeDiskGb: 50 }, ["voice"]), []);
});

test("desired and reported lists only accept catalog ids and bounded fields", () => {
  assert.deepEqual(readDesiredModels(["qwen3-tts-0.6b-4bit"]), ["qwen3-tts-0.6b-4bit"]);
  assert.equal(readDesiredModels(["rm -rf /"]), null); assert.equal(readDesiredModels(["qwen3-tts-0.6b-4bit", "qwen3-tts-0.6b-4bit"]), null);
  assert.deepEqual(readReportedModels([{ id: "qwen3-tts-0.6b-4bit", state: "installing", progress: 140, error: "bad;rm" }, { id: "nope", state: "installed" }]), [{ id: "qwen3-tts-0.6b-4bit", state: "installing", progress: 100 }]);
});

test("install uses fixed argv from the catalog, verifies, records it as managed, and remove deletes only managed models", async () => {
  const { home, hub, venv } = await setup(); const calls: { command: string; args: string[] }[] = [];
  const run: ProcessRunner = async r => { calls.push({ command: r.command, args: r.args }); if (r.args[0] === "-c") await plant(hub); if (r.args[0] === "-m" && r.args[1] === "venv") await mkdir(join(venv, "bin"), { recursive: true }); return { stdout: "", stderr: "" }; };
  const m = new ModelManager({ home, hub, venv, run, pollMs: 10 });
  await m.reconcile(["qwen3-tts-0.6b-4bit"], { memoryGb: 16, freeDiskGb: 50 }, true); await m.idle();
  assert.equal(m.states().find(s => s.id === qwen.id)?.state, "installed"); assert.equal(m.states().find(s => s.id === qwen.id)?.source, "managed");
  assert.deepEqual(calls.map(c => c.args[0]), ["-m", "-m", "-c"]);
  assert.deepEqual(calls.at(-1)!.args.slice(2), [qwen.repo, qwen.revision]);
  assert.match(await readFile(join(home, "Library/Application Support/Estio/StudioCompanion/models.json"), "utf8"), /qwen3-tts-0.6b-4bit/);
  await m.reconcile([], { memoryGb: 16, freeDiskGb: 50 }, true);
  assert.equal(m.states().find(s => s.id === qwen.id)?.state, "absent");
});

test("a model already on the Mac is reported as found and is never removed", async () => {
  const { home, hub, venv } = await setup(); await plant(hub);
  const m = new ModelManager({ home, hub, venv, run: async () => { throw new Error("no process expected"); } });
  await m.reconcile([], { memoryGb: 16, freeDiskGb: 50 }, true);
  assert.deepEqual(m.states().find(s => s.id === qwen.id), { id: qwen.id, state: "installed", source: "found" });
  assert.equal(await m.remove(qwen.id), false); assert.equal(await detectModel(qwen, hub), "pinned");
});

test("refuses a model that cannot fit and waits when downloads are not allowed", async () => {
  const { home, hub, venv } = await setup(); const run: ProcessRunner = async () => { throw new Error("no process expected"); };
  const m = new ModelManager({ home, hub, venv, run });
  await m.reconcile([qwen.id], { memoryGb: 4, freeDiskGb: 50 }, true); assert.equal(m.states().find(s => s.id === qwen.id)?.state, "error");
  await m.reconcile([qwen.id], { memoryGb: 16, freeDiskGb: 50 }, false); assert.match(m.states().find(s => s.id === qwen.id)?.error ?? "", /Waiting/);
});

test("a failed download surfaces a bounded error and leaves nothing marked installed", async () => {
  const { home, hub, venv } = await setup(); await mkdir(join(venv, "bin"), { recursive: true }); await writeFile(join(venv, "bin", "python"), "");
  const m = new ModelManager({ home, hub, venv, pollMs: 10, run: async r => { if (r.args[0] === "-c") throw new Error("network down"); return { stdout: "", stderr: "" }; } });
  await m.reconcile([qwen.id], { memoryGb: 16, freeDiskGb: 50 }, true); await m.idle();
  const s = m.states().find(x => x.id === qwen.id)!; assert.equal(s.state, "error"); assert.equal(m.isInstalled(qwen.id), false);
});
