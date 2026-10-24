import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const helper = path.resolve("scripts/studio-deploy-readiness.sh");
async function scenario(mode: string, withPrior = true) {
 const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-deploy-test-")));
 try {
  const target = path.join(root, "target"), active = path.join(root, "active"), bin = path.join(root, "bin"), log = path.join(root, "calls");
  await Promise.all([mkdir(path.join(target, "node_modules/.bin"), { recursive: true }), mkdir(path.join(target, "scripts"), { recursive: true }), mkdir(path.join(active, "scripts"), { recursive: true }), mkdir(bin)]);
  await copyFile(path.resolve("scripts/studio-worker-restore.sh"), path.join(target, "scripts/studio-worker-restore.sh"));
  if (withPrior) await writeFile(path.join(active, "scripts/studio-worker.ts"), "// fixture only");
  await writeFile(path.join(active, ".env"), "STUDIO_TEST_ACTIVE_ENV=restored\n");
  const script = (code: string) => `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); const log=x=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(x)+'\\n');\n${code}\n`;
  await writeFile(path.join(target, "node_modules/.bin/tsx"), script(`
   const mode=process.argv.at(-1);log({command:mode,cwd:process.cwd(),instance:process.env.STUDIO_WORKER_INSTANCE,startedAfter:process.env.STUDIO_WORKER_STARTED_AFTER});
   if(mode==='--mode=required')process.exit(process.env.STUDIO_TEST_MODE==='dormant'?2:0);
   if(mode==='--mode=dependencies')process.exit(process.env.STUDIO_TEST_MODE==='dependencies_fail'?1:0);
   process.exit(process.env.STUDIO_TEST_MODE==='worker_fail'?1:0);
  `), { mode: 0o755 });
  await writeFile(path.join(bin, "pm2"), script(`
   const args=process.argv.slice(2);log({command:'pm2',args,instance:process.env.STUDIO_WORKER_INSTANCE,candidate:process.env.STUDIO_TEST_CANDIDATE_ENV,active:process.env.STUDIO_TEST_ACTIVE_ENV});
   if(args[0]==='jlist')console.log(JSON.stringify([{name:'test-studio-worker',pm2_env:{status:'online',pm_uptime:123456}}]));
  `), { mode: 0o755 });
  await writeFile(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const status = await new Promise<number>(resolve => execFile("bash", [helper, target, active, "test-studio-worker"], {
   timeout: 60000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUDIO_TEST_MODE: mode, STUDIO_TEST_LOG: log, STUDIO_TEST_CANDIDATE_ENV: "candidate-only" },
  }, error => resolve(error ? Number((error as NodeJS.ErrnoException).code) || 1 : 0)));
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  return { status, calls, target, active };
 } finally { await rm(root, { recursive: true, force: true }); }
}
test("dormant and dependency-failed preflight never touch PM2", async () => {
 for (const mode of ["dormant", "dependencies_fail"]) {
  const r = await scenario(mode); assert.equal(r.status, mode === "dormant" ? 0 : 1); assert.ok(r.calls.every(c => c.command !== "pm2"));
 }
});
test("PM2 online alone cannot pass; wrong/unconfirmed worker restores prior release and returns failure", async () => {
 const r = await scenario("worker_fail"); assert.equal(r.status, 1);
 assert.ok(r.calls.filter(c => c.command === "--mode=worker").length >= 1);
 assert.ok(r.calls.filter(c => c.command === "--mode=worker").length <= 6);
 const starts = r.calls.filter(c => c.command === "pm2" && c.args[0] === "start"); assert.equal(starts.length, 2);
 assert.ok(starts[0].args.includes(r.target)); assert.ok(starts[1].args.includes(r.active));
 assert.notEqual(starts[0].instance, starts[1].instance);
 assert.equal(starts[0].candidate, "candidate-only"); assert.equal(starts[1].candidate, undefined); assert.equal(starts[1].active, "restored");
});
test("healthy target uses an exact new instance and passes before symlink/traffic cutover", async () => {
 const r = await scenario("ready"); assert.equal(r.status, 0);
 const start = r.calls.find(c => c.command === "pm2" && c.args[0] === "start"); const probe = r.calls.find(c => c.command === "--mode=worker");
 assert.ok(start.instance); assert.equal(start.instance, probe.instance); assert.equal(probe.startedAfter, "123456"); assert.equal(probe.cwd, r.target);
 assert.ok(r.calls.findIndex(c => c.command === "--mode=dependencies") < r.calls.findIndex(c => c.command === "pm2"));
 const deploy = await readFile("deploy-local-build.sh", "utf8");
 assert.ok(deploy.indexOf('bash "\\$TARGET_DIR/scripts/studio-deploy-readiness.sh"') < deploy.indexOf('ln -sfn "\\$TARGET_DIR" "\\$SYMLINK_PATH"'));
 assert.ok(!deploy.includes("Studio worker is not online; Studio jobs will wait"));
});
test("first activation failure leaves no Studio worker running and restores nothing", async () => {
 const r = await scenario("worker_fail", false); assert.equal(r.status, 1);
 const pm2 = r.calls.filter(c => c.command === "pm2");
 assert.equal(pm2.filter(c => c.args[0] === "start").length, 1);
 assert.equal(pm2.at(-1).args[0], "delete");
});
test("post-switch soak rollback also rolls the Studio worker back with the web release", async () => {
 const deploy = await readFile("deploy-local-build.sh", "utf8");
 const soak = deploy.indexOf("Post-switch soak failed. Rolling back traffic.");
 const restore = deploy.indexOf('scripts/studio-worker-restore.sh" "\\$ACTIVE_DIR" "\\$TARGET_DIR"');
 assert.ok(soak > 0 && restore > soak && restore < deploy.indexOf("Rollback complete (previous upstream port"));
});
