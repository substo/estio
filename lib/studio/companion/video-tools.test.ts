import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverVideoTools, videoProcessEnvironment, PARAKEET_MODEL } from "./video-tools";

test("discovery reports versions only, requires the isolated venv for Parakeet, and checks the offline model cache", async () => {
  const home = await mkdtemp(join(tmpdir(), "studio-tools-"));
  const bin = join(home, "venv", "bin"); await mkdir(bin, { recursive: true });
  for (const name of ["yt-dlp", "python"]) { await writeFile(join(bin, name), "#!/bin/sh\n"); await chmod(join(bin, name), 0o755); }
  const calls: string[] = [];
  const run = async (r: { command: string; args: string[] }) => {
    calls.push(`${r.command} ${r.args.join(" ")}`);
    if (r.command.endsWith("yt-dlp")) return { stdout: "2026.11.01\n", stderr: "" };
    if (r.command.endsWith("python") && r.args[0] === "--version") return { stdout: "Python 3.11.3", stderr: "" };
    if (r.command.endsWith("python")) return { stdout: "0.3.4\n", stderr: "" };
    return { stdout: "tool 1.2.3", stderr: "" };
  };
  const first = await discoverVideoTools(run, home);
  assert.equal(first.report.tools.ytDlp, "2026.11.01"); assert.equal(first.report.tools.parakeet, "0.3.4"); assert.equal(first.report.tools.python, "3.11.3");
  assert.equal(first.report.tools.model, undefined); assert.equal(first.report.ready, false); assert.ok(first.report.missing.includes("model"));
  assert.ok(JSON.stringify(first.report).indexOf(home) === -1, "no filesystem paths are reported");
  assert.ok(calls.some(c => c.includes("-I -c import importlib.metadata")), "Parakeet probe is isolated mode");
  await mkdir(join(home, "hf-cache", "hub", `models--${PARAKEET_MODEL.replace("/", "--")}`, "snapshots", "abc"), { recursive: true });
  const second = await discoverVideoTools(run, home);
  assert.equal(second.report.tools.model, "downloaded");
  const env = videoProcessEnvironment(second);
  assert.equal(env.HF_HUB_OFFLINE, "1"); assert.equal(env.HF_HOME, join(home, "hf-cache"));
});

test("a failing probe means the tool is reported missing, never installed or assumed", async () => {
  const home = await mkdtemp(join(tmpdir(), "studio-tools-"));
  const out = await discoverVideoTools(async () => { throw new Error("nope"); }, home);
  assert.equal(out.report.ready, false); assert.equal(out.report.tools.ytDlp, undefined); assert.equal(out.report.tools.python, undefined);
});
