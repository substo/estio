#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { appOrigin, configSchema, loadConfig, saveConfig } from "../lib/studio/companion/config";
import { createDeviceStudioQueue } from "../lib/studio/companion/http-queue";
import { createCompanionDiagnostic } from "../lib/studio/companion/diagnostic";
import { createLocalTextAdapter } from "../lib/studio/companion/providers";
import { runStudioJob, runStudioWorker } from "../lib/studio/worker/runner";

const version = "studio-companion-1";
/** Token never appears in command-line args or logs. A terminal prompt disables echo. */
async function readToken(): Promise<string> {
  if (process.env.STUDIO_DEVICE_TOKEN) {
    const token = process.env.STUDIO_DEVICE_TOKEN.trim(); delete process.env.STUDIO_DEVICE_TOKEN; return token;
  }
  const input = process.stdin;
  if (input.isTTY) {
    process.stderr.write("Device token (hidden): ");
    input.setRawMode(true); input.resume();
    try {
      return await new Promise<string>((resolve, reject) => {
        let value = "";
        const cleanup = () => { input.off("data", onData); input.off("end", onEnd); process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); };
        const onSignal = () => { cleanup(); reject(new Error("token_input_cancelled")); };
        const onEnd = () => { cleanup(); reject(new Error("token_input_closed")); };
        const onData = (data: Buffer) => {
          for (const byte of data) {
            if (byte === 3 || byte === 4) { cleanup(); reject(new Error("token_input_cancelled")); return; }
            if (byte === 13 || byte === 10) { cleanup(); resolve(value.trim()); return; }
            if (byte === 127 || byte === 8) value = value.slice(0, -1);
            else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
            if (value.length > 256) { cleanup(); reject(new Error("token_input_too_long")); return; }
          }
        };
        input.on("data", onData); input.once("end", onEnd); process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
      });
    } finally { input.setRawMode(false); input.pause(); process.stderr.write("\n"); }
  }
  let value = "";
  for await (const chunk of input) { value += chunk.toString(); if (Buffer.byteLength(value) > 1024) throw new Error("token_input_too_long"); }
  return value.trim();
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const flags = new Map<string, string>(); let once = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--once" && !once) { once = true; continue; }
    if (!["--origin", "--name"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid_arguments");
    flags.set(args[i], args[++i]);
  }
  if (command === "setup") {
    if (once || !flags.has("--origin")) throw new Error("setup_requires_origin");
    const origin = appOrigin(flags.get("--origin")!);
    const token = await readToken();
    const config = configSchema.parse({ version: 1, origin, token, name: flags.get("--name") ?? os.hostname(), deviceId: randomUUID() });
    // Authenticate before replacing a working local pairing; never claim jobs during setup.
    const workerId = `mac:${config.deviceId}:setup:${process.pid}`;
    await createDeviceStudioQueue(config, { capabilities: () => ({ platform: os.platform(), arch: os.arch(), version, handlers: ["studio.diagnostic"] }) })
      .heartbeat(workerId, version, new Date());
    await saveConfig(config);
    console.log("Studio companion paired locally. Run: npm run start:studio-companion -- start");
    return;
  }
  if (flags.size || !["start", "readiness"].includes(command) || command === "readiness" && once) throw new Error("invalid_arguments");
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const adapters = { codex: createLocalTextAdapter("codex"), claude: createLocalTextAdapter("claude") };
    const readiness = async () => ({ codex: await adapters.codex.readiness(controller.signal), claude: await adapters.claude.readiness(controller.signal) });
    let providers = await readiness();
    if (command === "readiness") { console.log(JSON.stringify(providers)); return; }
    const config = await loadConfig();
    const instanceId = randomUUID();
    const workerId = `mac:${config.deviceId}:${process.pid}`;
    const capabilities = () => ({ instanceId, platform: os.platform(), arch: os.arch(), version, handlers: ["studio.diagnostic"], ...providers });
    const queue = createDeviceStudioQueue(config, { capabilities });
    const diagnostic = createCompanionDiagnostic(provider => adapters[provider]);
    const handlers = { "studio.diagnostic": (job: Parameters<typeof diagnostic>[0], context: Parameters<typeof diagnostic>[1]) =>
      diagnostic(job, { ...context, signal: AbortSignal.any([context.signal, controller.signal]) }) };
    const report = { instanceId, handlers: Object.keys(handlers) };
    const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
    if (once) {
      const startedAt = new Date();
      await queue.heartbeat(workerId, version, startedAt, { ...report, healthy: true, draining: false });
      try {
        const jobs = await queue.claim(workerId, 1, 120);
        for (const job of jobs) await runStudioJob(job, { queue, handlers, workerId, leaseSeconds: 120, log });
        log({ event: "companion_once_complete", claimed: jobs.length });
      } finally { await queue.heartbeat(workerId, version, startedAt, { ...report, healthy: false, draining: true }); }
    } else {
      // Refresh safe metadata, never claim text workflows from native CLI readiness alone.
      let refreshing = false;
      const refresh = setInterval(() => { if (!refreshing && !controller.signal.aborted) {
        refreshing = true; void readiness().then(value => { providers = value; }).finally(() => { refreshing = false; });
      } }, 300_000);
      try { await runStudioWorker({ queue, handlers, workerId, release: version, report, concurrency: 1, signal: controller.signal, log }); }
      finally { clearInterval(refresh); }
    }
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Studio companion failed. Check setup, native CLI login, app connection and selected model."); process.exitCode = 1; });
}
