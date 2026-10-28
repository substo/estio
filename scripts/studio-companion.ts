#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { appOrigin } from "../lib/studio/companion/config";
import { createDeviceStudioQueue, postCommandStatus, type ProviderCommand } from "../lib/studio/companion/http-queue";
import { createCompanionDiagnostic } from "../lib/studio/companion/diagnostic";
import { createLocalTextAdapter, type LocalProvider } from "../lib/studio/companion/providers";
import { discover, discoverPowerAndDisk, type Discovery } from "../lib/studio/companion/discovery";
import { loadCredentials } from "../lib/studio/companion/keychain";
import { pairDevice, type PairingDeps } from "../lib/studio/companion/pairing";
import { DeviceSettings, localGate } from "../lib/studio/companion/settings";
import { executeProviderCommand } from "../lib/studio/companion/commands";
import { runStudioJob, runStudioWorker } from "../lib/studio/worker/runner";
import type { StudioQueue } from "../lib/studio/worker/queue";

const version = "studio-companion-2";
const rediscoverMs = 10 * 60_000;
const usage = "Usage: npm run start:studio-companion -- pair --origin <https origin> [--name 'My Mac'] | start [--once] | readiness";
const messages: Record<string, string> = {
  setup_replaced: "`setup` with a pasted device token was replaced by browser pairing. Run: npm run start:studio-companion -- pair --origin <https origin> --name 'My Mac'",
  invalid_arguments: usage, invalid_app_origin: "Use the app's https origin, for example --origin https://substo.com",
  pairing_denied: "Pairing was denied in the browser.", pairing_expired: "The pairing code expired. Run pair again.",
  pairing_consumed: "This pairing was already used. Run pair again.", invalid_pairing_url: "The app returned an unexpected approval link. Pairing stopped.",
  device_pair_start_failed: "Could not start pairing. Check the origin and your connection.",
  keychain_write_failed: "Could not save the device key to macOS Keychain.",
  not_paired: "This Mac is not paired yet. Run: npm run start:studio-companion -- pair --origin <https origin> --name 'My Mac'",
};

function parseArgs(args: string[]) {
  const flags = new Map<string, string>(); let once = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--once" && !once) { once = true; continue; }
    if (!["--origin", "--name"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid_arguments");
    flags.set(args[i], args[++i]);
  }
  return { flags, once };
}
export async function main(argv = process.argv.slice(2), deps: { pairing?: PairingDeps } = {}) {
  const [command, ...rest] = argv;
  if (command === "setup") throw new Error("setup_replaced");
  const { flags, once } = parseArgs(rest);
  if (command === "pair") {
    if (once || !flags.has("--origin")) throw new Error("invalid_arguments");
    await pairDevice({ origin: appOrigin(flags.get("--origin")!), name: flags.get("--name") ?? os.hostname().replace(/\.local$/, ""), platform: os.platform() }, deps.pairing);
    return;
  }
  if (flags.size || !["start", "readiness"].includes(command) || command === "readiness" && once) throw new Error("invalid_arguments");
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const adapters = { codex: createLocalTextAdapter("codex"), claude: createLocalTextAdapter("claude") };
    const readiness = async () => ({ codex: await adapters.codex.readiness(controller.signal), claude: await adapters.claude.readiness(controller.signal) });
    let [providers, discovery]: [Awaited<ReturnType<typeof readiness>>, Discovery] = await Promise.all([readiness(), discover()]);
    if (command === "readiness") { console.log(JSON.stringify({ ...providers, ...discovery })); return; }
    const { config, credentials, migrated } = await loadCredentials().catch(error => {
      throw error instanceof Error && error.message === "keychain_write_failed" ? error : new Error("not_paired"); });
    const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
    if (migrated) log({ event: "device_token_moved_to_keychain" });
    const instanceId = randomUUID();
    const workerId = `mac:${config.deviceId}:${process.pid}`;
    const settings = new DeviceSettings();
    const capabilities = () => ({ instanceId, platform: os.platform(), arch: os.arch(), version, handlers: ["studio.diagnostic"], ...providers, ...discovery });

    // Provider login/logout commands arrive with heartbeats; one at a time per provider.
    const handled = new Set<string>(); const active = new Map<LocalProvider, Promise<void>>();
    let pulse: () => void = () => {};
    const runCommand = (cmd: ProviderCommand) => {
      if (handled.has(cmd.id) || active.has(cmd.provider) || controller.signal.aborted) return;
      handled.add(cmd.id);
      log({ event: "provider_command_started", kind: cmd.kind, provider: cmd.provider });
      const task = executeProviderCommand(cmd, { signal: controller.signal, readiness: provider => adapters[provider].readiness(),
        post: status => postCommandStatus(credentials, workerId, status) })
        .then(async status => { log({ event: "provider_command_finished", kind: cmd.kind, provider: cmd.provider, status });
          providers = await readiness(); pulse(); })
        .catch(() => log({ event: "provider_command_failed", provider: cmd.provider }))
        .finally(() => active.delete(cmd.provider));
      active.set(cmd.provider, task);
    };
    const inner = createDeviceStudioQueue(credentials, { capabilities, configAck: () => settings.pendingAck,
      onHeartbeat: (state, sentAck) => {
        if (settings.update(state, sentAck)) { log({ event: "config_applied", version: settings.appliedVersion, status: settings.pendingAck?.status }); pulse(); }
        if (state && !once) for (const cmd of state.commands) runCommand(cmd);
      } });
    let last: Parameters<StudioQueue["heartbeat"]> | undefined; let pulsing = false;
    pulse = () => { if (!last || pulsing) return; pulsing = true; void inner.heartbeat(...last).catch(() => {}).finally(() => { pulsing = false; }); };
    let lastReasons = "";
    const queue: StudioQueue = { ...inner,
      heartbeat: (...args) => { last = args; return inner.heartbeat(...args); },
      claim: async (id, limit, leaseSeconds) => {
        // Local policy before claiming. Only diagnostics are registered; future processing kinds must also require gate.processing.
        const gate = localGate({ state: settings.state, config: settings.config, power: discovery.hardware.power, freeDiskGb: discovery.hardware.freeDiskGb });
        const reasons = gate.reasons.join(",");
        if (reasons !== lastReasons) { lastReasons = reasons; log({ event: "local_gate", diagnostics: gate.diagnostics, processing: gate.processing, reasons: gate.reasons }); }
        return gate.diagnostics ? inner.claim(id, limit, leaseSeconds) : [];
      } };
    const diagnostic = createCompanionDiagnostic(provider => adapters[provider]);
    const handlers = { "studio.diagnostic": (job: Parameters<typeof diagnostic>[0], context: Parameters<typeof diagnostic>[1]) =>
      diagnostic(job, { ...context, signal: AbortSignal.any([context.signal, controller.signal]) }) };
    const report = { instanceId, handlers: Object.keys(handlers) };
    if (once) {
      const startedAt = new Date();
      await queue.heartbeat(workerId, version, startedAt, { ...report, healthy: true, draining: false });
      try {
        const jobs = await queue.claim(workerId, 1, 120);
        for (const job of jobs) await runStudioJob(job, { queue, handlers, workerId, leaseSeconds: 120, log });
        log({ event: "companion_once_complete", claimed: jobs.length });
      } finally { await queue.heartbeat(workerId, version, startedAt, { ...report, healthy: false, draining: true }); }
      return;
    }
    // Rediscover hardware/runtimes/models/CLI login every 10 minutes; power and disk every minute for local gating.
    let refreshing = false;
    const refresh = setInterval(() => { if (!refreshing && !controller.signal.aborted) {
      refreshing = true; void Promise.all([readiness(), discover()]).then(([p, d]) => { providers = p; discovery = d; }).catch(() => {}).finally(() => { refreshing = false; });
    } }, rediscoverMs);
    const quick = setInterval(() => { if (!refreshing) void discoverPowerAndDisk().then(v => { discovery = { ...discovery, hardware: { ...discovery.hardware, ...v } }; }).catch(() => {}); }, 60_000);
    try { await runStudioWorker({ queue, handlers, workerId, release: version, report, concurrency: 1,
      // Sign-in commands ride on heartbeats, so they stay at 30s; an idle Mac claims at most once a minute.
      heartbeatMs: 30_000, idlePollMaxMs: 60_000, signal: controller.signal, log }); }
    finally { clearInterval(refresh); clearInterval(quick); await Promise.allSettled(active.values()); }
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof Error ? error.message : "";
    console.error(messages[code] ?? "Studio companion failed. Check pairing, native CLI login and the app connection.");
    process.exitCode = 1;
  });
}
