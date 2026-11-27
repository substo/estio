#!/usr/bin/env tsx
import { createCodexFrameDrawer } from "../lib/studio/companion/codex-image";
import { createCharacterSheetHandler } from "../lib/studio/companion/character-sheet";
import { createLocalSoundMaker } from "../lib/studio/companion/local-sound";
import { catalogModel } from "../lib/studio/local-models";
import { createSubscriptionTextRunHandler } from "../lib/studio/companion/text-run";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appOrigin } from "../lib/studio/companion/config";
import { createDeviceStudioQueue, deviceFailureDetails, postCommandStatus, type ProviderCommand } from "../lib/studio/companion/http-queue";
import { createCompanionDiagnostic } from "../lib/studio/companion/diagnostic";
import { createLocalTextAdapter, type LocalProvider } from "../lib/studio/companion/providers";
import { TEXT_ROUTE_VERSION, type ReportLocalRoute } from "../lib/studio/companion/route";
import { discover, discoverPowerAndDisk, type Discovery } from "../lib/studio/companion/discovery";
import { loadCredentials } from "../lib/studio/companion/keychain";
import { pairDevice, type PairingDeps } from "../lib/studio/companion/pairing";
import { DeviceSettings, localGate } from "../lib/studio/companion/settings";
import { executeProviderCommand } from "../lib/studio/companion/commands";
import { runStudioJob, runStudioWorker } from "../lib/studio/worker/runner";
import type { StudioQueue } from "../lib/studio/worker/queue";
import type { StudioJobHandler } from "../lib/studio/worker/handlers";

import { createCapacityTracker } from "../lib/studio/companion/capacity";
import { readNativeUsage } from "../lib/studio/companion/native-usage";
import { nativeSubscriptionBlocked, nativeSubscriptionReady } from "../lib/studio/subscription-readiness";
import { createLibrarySummaryHandler } from "../lib/studio/companion/library-summary";
import { createOnboardingResearchHandler } from "../lib/studio/companion/onboarding-research";
import { DEVICE_BLOCK_REASONS } from "../lib/studio/devices-policy";
import { discoverVideoTools, type VideoTools } from "../lib/studio/companion/video-tools";
import { createFootageTranscriber } from "../lib/studio/companion/footage-transcript";
import { createVideoTranscribeHandler } from "../lib/studio/companion/video-transcribe";
import { createVideoDeviceApi } from "../lib/studio/companion/video-api";
import { fileURLToPath } from "node:url";
import { createExportApi, createVideoAssembleHandler } from "../lib/studio/companion/video-assemble";
import { createOpenEditorHandler, createVideoEditHandler } from "../lib/studio/companion/video-loop";
import { createProjectStore, projectsRoot } from "../lib/studio/companion/video-projects";
import { discoverAssemblyTools, type AssemblyTools } from "../lib/studio/companion/video-assemble-tools";
import { assembleVideo } from "../lib/studio/video-assembly/assemble";
import { localCloneReady, localTtsReady, synthesizeLocal, synthesizeLocalClone } from "../lib/studio/video-assembly/tts";
import { ensureVoiceReference } from "../lib/studio/companion/voice-profiles";
import { createVoicePreviewHandler } from "../lib/studio/companion/voice-preview";
import { detectModel, hubDirectory, ModelManager, modelVenv } from "../lib/studio/companion/model-manager";
import { createPlaywrightYoutubeBrowser, createYoutubeSearchHandler, findChrome, openYoutubeLogin, youtubeBrowserProfile } from "../lib/studio/companion/youtube-search";
import { CompanionMetrics, featureForStudioJob } from "../lib/studio/companion/metrics";

const version = "studio-companion-17";
const rediscoverMs = 10 * 60_000;
const usage = "Usage: npm run start:studio-companion -- pair --origin <https origin> [--name 'My Mac'] | start [--once] | readiness | youtube-login\nRun in the background: bash scripts/studio-companion-launchagent.sh install";
const messages: Record<string, string> = {
  youtube_browser_missing: "Google Chrome was not found on this Mac. Install it, then run youtube-login again.",
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
  if (command === "youtube-login") { await openYoutubeLogin(); return; }
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
    // Capability reports carry the advisory model lists (Codex app-server `model/list`, Claude curated); job checks skip them.
    const readiness = async () => ({ codex: await adapters.codex.readiness(controller.signal, { listModels: true }), claude: await adapters.claude.readiness(controller.signal, { listModels: true }) });
    let [providers, discovery, videoTools]: [Awaited<ReturnType<typeof readiness>>, Discovery, VideoTools] = await Promise.all([readiness(), discover(), discoverVideoTools()]);
    if (command === "readiness") { console.log(JSON.stringify({ ...providers, ...discovery, video: videoTools.report })); return; }
    const { config, credentials, migrated } = await loadCredentials().catch(error => {
      throw error instanceof Error && error.message === "keychain_write_failed" ? error : new Error("not_paired"); });
    const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
    let pulse: () => void = () => {};
    const metrics = new CompanionMetrics({ file: join(os.homedir(), "Library", "Logs", "Estio", "studio-metrics.jsonl"), onChange: () => pulse() });
    await metrics.load();
    const reportRoute: ReportLocalRoute = (jobId, { provider, model, firstLocalStep, switchReason }) => log({
      event: "local_text_route", jobId, provider, model: model ?? "native-default", firstLocalStep, switchReason,
    });
    if (migrated) log({ event: "device_token_moved_to_keychain" });
    const instanceId = randomUUID();
    const workerId = `mac:${config.deviceId}:${process.pid}`;
    const settings = new DeviceSettings();
    const tracker = createCapacityTracker(() => readNativeUsage(undefined, controller.signal));
    const usageNow = async () => tracker.snapshot();
    void tracker.usage();
    let chromePath: string | null = await findChrome();
    let youtubeSignedIn: boolean | undefined;
    const gate = () => localGate({ state: settings.state, config: settings.config, power: discovery.hardware.power, freeDiskGb: discovery.hardware.freeDiskGb });
    const nativeRetryAt = () => ({ codex: adapters.codex.quotaRetryAt?.(), claude: adapters.claude.quotaRetryAt?.() });
    // The existing SQL flag means this CLI is eligible to attempt work. A percentage remains optional telemetry.
    const capacity = () => {
      const retry = nativeRetryAt();
      return {
        codex: nativeSubscriptionReady("codex", providers.codex) && !nativeSubscriptionBlocked(tracker.snapshot(), "codex", retry.codex),
        claude: nativeSubscriptionReady("claude", providers.claude) && !nativeSubscriptionBlocked(tracker.snapshot(), "claude", retry.claude),
      };
    };
    // On-device models the owner chose in Settings -> Local models: detect, install, remove, report. One download at a time.
    const models = new ModelManager({ onChange: () => pulse() });
    const reconcileModels = async () => {
      if (controller.signal.aborted || settings.appliedVersion === 0) return;
      const hw = discovery.hardware;
      await models.reconcile(settings.config.models ?? [], { memoryGb: hw.memoryGb, freeDiskGb: hw.freeDiskGb }, settings.config.resources.allowOnBattery || hw.power.source === "ac")
        .catch(() => log({ event: "model_reconcile_failed" }));
    };
    await models.refresh().catch(() => {});
    const capabilities = () => ({ instanceId, modelStates: models.states(), platform: os.platform(), arch: os.arch(), version, metrics: metrics.summary(), knowledgeOutlineVersion: 2, knowledgeCurationVersion: 1, stagedCreationVersion: 1, studioAgentVersion: 4, videoTemplateVersion: 1, sourceAssistVersion: 1, textRouteVersion: TEXT_ROUTE_VERSION, deviceAiRouteVersion: 1, handlers: ["studio.diagnostic", "studio.library_summary", "studio.onboarding_research", "studio.text_run", "studio.video_transcribe", "studio.youtube_search", "studio.video_assemble", "studio.character_sheet"], videoAssembly: { ready: assemblyReady(), missing: assembly.missing, sourceClips: 1 }, voicePreview: { ready: previewReady() }, characterSheet: { ready: sheetReady() }, transcribeUpload: { ready: Boolean(videoTools.paths.python && videoTools.paths.ffmpeg && videoTools.report.tools.model === "downloaded") }, youtubeSearch: { ready: youtubeReady(), signedIn: youtubeSignedIn, rank: researchReady() }, ...providers, ...discovery, video: videoTools.report,
      nativeSubscriptionVersion: 1, nativeRetryAt: nativeRetryAt(), capacity: capacity(), usage: tracker.snapshot(), processingBlocked: gate().reasons.filter(reason => reason in DEVICE_BLOCK_REASONS) });
    const researchReady = () => gate().processing && Object.values(capacity()).some(Boolean);
    /** Character sheets are drawn with the Codex CLI on this Mac's ChatGPT login: installed, signed in, and the gate allows processing. */
    const sheetReady = () => gate().processing && providers.codex.ready && providers.codex.authenticated;

    const youtubeReady = () => (chromePath !== null || researchReady()) && gate().processing;
    let assembly: AssemblyTools = { ready: false, missing: ["substo", "ffprobe", "Claude sign-in"] };
    const refreshAssembly = async () => { assembly = await discoverAssemblyTools(providers.claude.ready && providers.claude.authenticated, undefined, controller.signal); };
    await refreshAssembly();
    let localVoiceInstalled = false;
    const refreshLocalVoice = async () => { localVoiceInstalled = (await localTtsReady().catch(() => false)) || (await localCloneReady().catch(() => false)); };
    await refreshLocalVoice();
    const previewReady = () => localVoiceInstalled && gate().processing;
    setInterval(() => { if (!controller.signal.aborted) { void refreshAssembly(); void refreshLocalVoice(); } }, 60_000).unref();
    const assemblyReady = () => assembly.ready && gate().processing;
    const videoReady = () => settings.config.features.transcription && gate().processing && videoTools.report.ready;

    // Provider login/logout commands arrive with heartbeats; one at a time per provider.
    const handled = new Set<string>(); const active = new Map<LocalProvider, Promise<void>>();
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
    const inner = createDeviceStudioQueue(credentials, { capabilities, textReady: () => settings.config.features.text && gate().processing, summaryReady: () => settings.config.features.text && gate().processing, researchReady: () => gate().processing, videoReady, youtubeReady, assembleReady: assemblyReady, previewReady, sheetReady, configAck: () => settings.pendingAck,
      onHeartbeat: (state, sentAck) => {
        if (settings.update(state, sentAck)) { log({ event: "config_applied", version: settings.appliedVersion, status: settings.pendingAck?.status }); pulse(); void reconcileModels(); }
        if (state && !once) for (const cmd of state.commands) runCommand(cmd);
      } });
    const sendHeartbeat: StudioQueue["heartbeat"] = async (...args) => {
      try { await inner.heartbeat(...args); }
      catch (error) {
        log({ event: "device_heartbeat_failure", ...deviceFailureDetails(error) });
        throw error;
      }
    };
    let last: Parameters<StudioQueue["heartbeat"]> | undefined; let pulsing = false;
    pulse = () => { if (!last || pulsing) return; pulsing = true; void sendHeartbeat(...last).catch(() => {}).finally(() => { pulsing = false; }); };
    let lastReasons = "";
    const queue: StudioQueue = { ...inner,
      heartbeat: (...args) => { last = args; return sendHeartbeat(...args); },
      claim: async (id, limit, leaseSeconds) => {
        // Local policy before claiming. Processing kinds are only requested (summaryReady/researchReady) when gate.processing allows.
        const current = gate();
        const reasons = current.reasons.join(",");
        if (reasons !== lastReasons) { lastReasons = reasons; log({ event: "local_gate", diagnostics: current.diagnostics, processing: current.processing, reasons: current.reasons }); }
        return current.diagnostics ? inner.claim(id, limit, leaseSeconds) : [];
      } };
    const diagnostic = createCompanionDiagnostic(provider => adapters[provider]);
    const summary = createLibrarySummaryHandler({ adapter: p => adapters[p], enabled: () => settings.config.features.text && gate().processing, usage: usageNow, config: () => settings.config, deviceId: config.deviceId, reportRoute });
    // Research needs processing On (its grant), not the text-feature setup; web search is enabled only inside this handler.
    const research = createOnboardingResearchHandler({ adapter: p => adapters[p], enabled: () => gate().processing, usage: usageNow, deviceId: config.deviceId, reportRoute });
    const withShutdown = (handler: StudioJobHandler): StudioJobHandler => (job, context) => handler(job, { ...context, signal: AbortSignal.any([context.signal, controller.signal]) });
    const textRun = createSubscriptionTextRunHandler({ adapter: p => adapters[p], usage: usageNow, enabled: () => gate().processing, config: () => settings.config, configVersion: () => settings.appliedVersion });
    const video = createVideoTranscribeHandler({ cacheDir: join(os.homedir(), "Library", "Application Support", "Estio", "StudioCompanion", "youtube-cache"), tools: async () => { videoTools = await discoverVideoTools(); return videoTools; }, api: createVideoDeviceApi(credentials), enabled: () => gate().processing, config: () => settings.config,
      adapter: p => adapters[p], usage: usageNow, deviceId: config.deviceId, reportRoute, scriptsDir: fileURLToPath(new URL("./studio-video", import.meta.url)) });
    const youtubeSearchInner = createYoutubeSearchHandler({ deviceId: config.deviceId, enabled: () => gate().processing, models: { adapter: p => adapters[p], usage: usageNow, config: () => settings.config }, browser: async () => {
      chromePath = await findChrome();
      return chromePath ? createPlaywrightYoutubeBrowser({ executablePath: chromePath, profileDir: youtubeBrowserProfile() }) : null;
    } });
    const youtubeSearch: StudioJobHandler = async (job, context) => {
      const result = await youtubeSearchInner(job, context) as { signedIn?: boolean };
      youtubeSignedIn = result.signedIn; return result;
    };
    const projects = createProjectStore();
    const referenceTranscriber = createFootageTranscriber({ tools: async () => { videoTools = await discoverVideoTools(); return videoTools; }, scriptsDir: fileURLToPath(new URL("./studio-video", import.meta.url)) });
    const transcribeReference = async (wavPath: string, signal?: AbortSignal) => { const lines = await referenceTranscriber(wavPath, signal); return lines && lines.length ? lines.map(l => l.text).join(" ") : null; };
    const videoAssemble = createVideoAssembleHandler({ drawFrame: createCodexFrameDrawer(), makeSound: createLocalSoundMaker({ modelPython: join(modelVenv(), "bin", "python"), model: async role => { const m = catalogModel(role === "music" ? "stable-audio-3-small-music" : "stable-audio-3-small-sfx"); return m && await detectModel(m, hubDirectory()) ? m.repo : null; }, tools: async () => { videoTools = await discoverVideoTools(); return videoTools; }, scriptsDir: fileURLToPath(new URL("./studio-video", import.meta.url)) }), transcribeFootage: createFootageTranscriber({ tools: async () => { videoTools = await discoverVideoTools(); return videoTools; }, scriptsDir: fileURLToPath(new URL("./studio-video", import.meta.url)) }), enabled: () => gate().processing, tools: async signal => { await refreshAssembly(); return assembly; }, localSpeechReady: () => localTtsReady(), localCloneReady: () => localCloneReady(), reference: (ref, signal) => ensureVoiceReference(ref, { signal, transcribe: transcribeReference }), api: createExportApi(credentials),
      workRoot: join(os.homedir(), "Library", "Application Support", "Estio", "StudioCompanion", "video-assembly"), projectsRoot: projectsRoot(), projects, editorDocs: fileURLToPath(new URL("../video-editor/docs", import.meta.url)), assemble: assembleVideo });
    const loopDeps = { enabled: () => gate().processing, tools: async () => { await refreshAssembly(); return assembly; }, projects, editorDocs: fileURLToPath(new URL("../video-editor/docs", import.meta.url)) };
    const videoEdit = createVideoEditHandler({ ...loopDeps, api: createExportApi(credentials) });
    const openEditor = createOpenEditorHandler(loopDeps);
    const voicePreview = createVoicePreviewHandler({ enabled: () => gate().processing, ready: async speaker => speaker.startsWith("clone-") ? localCloneReady() : localTtsReady(), reference: (ref, signal) => ensureVoiceReference(ref, { signal, transcribe: transcribeReference }),
      synth: (speaker, text, signal, reference) => reference ? synthesizeLocalClone({ text, refAudio: reference.audio, refText: reference.text, signal }) : synthesizeLocal({ text, voice: speaker, signal }) });
    const characterSheet = createCharacterSheetHandler({ enabled: () => gate().processing, ready: sheetReady, draw: createCodexFrameDrawer(), transcribe: createFootageTranscriber({ tools: async () => { videoTools = await discoverVideoTools(); return videoTools; }, scriptsDir: fileURLToPath(new URL("./studio-video", import.meta.url)) }) });
    const rawHandlers: Record<string, StudioJobHandler> = { "studio.character_sheet": withShutdown(characterSheet), "studio.voice_preview": withShutdown(voicePreview), "studio.video_assemble": withShutdown(videoAssemble), "studio.video_edit": withShutdown(videoEdit), "studio.open_editor": withShutdown(openEditor), "studio.video_transcribe": withShutdown(video), "studio.youtube_search": withShutdown(youtubeSearch), "studio.text_run": withShutdown(textRun), "studio.library_summary": summary, "studio.onboarding_research": withShutdown(research), "studio.diagnostic": withShutdown(diagnostic) };
    const handlers = Object.fromEntries(Object.entries(rawHandlers).map(([kind, handler]) => [kind, metrics.wrap(featureForStudioJob, handler)]));
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
      refreshing = true; void Promise.all([readiness(), discover(), discoverVideoTools(), findChrome()]).then(([p, d, v, c]) => { providers = p; discovery = d; videoTools = v; chromePath = c; }).catch(() => {}).finally(() => { refreshing = false; });
    } }, rediscoverMs);
    const modelTick = setInterval(() => { void reconcileModels(); }, 60_000);
    const quick = setInterval(() => { if (!refreshing) void Promise.all([discoverPowerAndDisk().then(v => { discovery = { ...discovery, hardware: { ...discovery.hardware, ...v } }; }), tracker.usage(), metrics.refreshMemory()]).then(() => pulse()).catch(() => {}); }, 60_000);
    try { await runStudioWorker({ queue, handlers, workerId, release: version, report, concurrency: 1,
      // Sign-in commands ride on heartbeats, so they stay at 30s; an idle Mac claims at most once a minute.
      heartbeatMs: 30_000, idlePollMaxMs: 60_000, signal: controller.signal, log }); }
    finally { clearInterval(refresh); clearInterval(quick); clearInterval(modelTick); await Promise.allSettled(active.values()); }
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof Error ? error.message : "";
    console.error(messages[code] ?? "Studio companion failed. Check pairing, native CLI login and the app connection.");
    process.exitCode = 1;
  });
}
