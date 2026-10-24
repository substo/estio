import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
async function cli(script: string, args: string[]) {
 return new Promise<{ status: number; output: string }>(resolve => execFile(process.execPath, ["--import", "tsx", script, ...args], {
  timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: "test", HOME: process.env.HOME },
 }, (error, stdout, stderr) => resolve({ status: error ? 1 : 0, output: stdout + stderr.replace(/\(node:\d+\).*\n/g, "").replace(/\(Use .*\n/g, "") })));
}
test("archive CLI refuses apply/connection flags and only emits safe failure on missing files", async () => {
 for (const args of [["--apply"], ["--database-url", "postgresql://synthetic-secret@must-not-connect.invalid/db"],
  ["--bundle", "/nonexistent/private/path", "--manifest-sha256", "a".repeat(64), "--project-ref", "fixturestudio00000000", "--bucket", "studio-media"]]) {
  const result = await cli("scripts/studio-recovery-verify.ts", args); assert.equal(result.status, 1);
  assert.match(result.output, /"verified":false/); assert.ok(!result.output.includes("synthetic-secret")); assert.ok(!result.output.includes("/nonexistent"));
 }
});
test("offline preflight refuses implicit defaults and unknown mutation flags", async () => {
 for (const args of [[], ["--apply"]]) { const result = await cli("scripts/studio-release-preflight.ts", args); assert.equal(result.status, 1); assert.match(result.output, /"releaseReady":false/); }
});
