#!/usr/bin/env tsx
import { createYoutubeDiscoveryHandler, productionYoutubeDiscoveryDeps } from "../lib/studio/worker/youtube-discovery";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { studioReadinessRequired, STUDIO_WORKER_HANDLERS } from "../lib/studio/readiness";
import { readStudioRelease, runtimeStudioReadiness } from "../lib/studio/readiness-runtime";
import { studioJobHandlers } from "../lib/studio/worker/handlers";
import { createStudioR2Store, readStudioR2Config } from "../lib/studio/media-r2";
import { requestStudioRest } from "../lib/studio/rest-client";
import { createTranscribeUploadHandler, productionTranscribeDeps } from "../lib/studio/worker/transcribe-upload";
import { createRestStudioQueue } from "../lib/studio/worker/queue";
import { createIdeaReviewHandler, productionIdeaReviewDeps } from "../lib/studio/worker/idea-review";
import { createScriptBriefHandler, productionScriptBriefDeps } from "../lib/studio/worker/script-brief";
import { createKnowledgeExtractionHandler, productionKnowledgeExtractionDeps } from "../lib/studio/worker/knowledge-extract";
import { runStudioWorker } from "../lib/studio/worker/runner";

// Hosted Studio worker: a pm2 process beside Next.js on Hetzner, so Studio jobs
// run whether or not anyone's Mac is on. Environment comes from the deploy's .env.
const PROVIDER_RETRY_MS = 10 * 60_000;
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), service: "studio-worker", ...event }));

async function main() {
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { log({ event: "shutdown_requested", signal }); controller.abort(); });
  if (!studioReadinessRequired()) {
    // Stay up quietly so pm2 does not restart-loop before Studio is configured.
    log({ event: "studio_not_configured" });
    // A pending promise alone does not keep Node alive; the timer does.
    const keepAlive = setInterval(() => {}, 60_000);
    await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
    clearInterval(keepAlive);
    return;
  }
  const release = await readStudioRelease();
  let readiness = await runtimeStudioReadiness("dependencies");
  // A restricted/paused provider is not a crash: wait quietly (no pm2 restart loop,
  // one small probe per interval) and start working once the project is reachable.
  while (readiness.ready && readiness.degraded && !controller.signal.aborted) {
    log({ event: "studio_provider_restricted_waiting", retryInMs: PROVIDER_RETRY_MS });
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, PROVIDER_RETRY_MS);
      controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (!controller.signal.aborted) readiness = await runtimeStudioReadiness("dependencies");
  }
  if (controller.signal.aborted) return;
  if (!readiness.ready || !release) {
    log({ event: "dependencies_not_ready", checks: readiness.checks, releaseAvailable: Boolean(release) });
    throw new Error("studio_dependencies_not_ready");
  }
  const instanceId = process.env.STUDIO_WORKER_INSTANCE?.trim() || randomUUID();
  const workerId = `${os.hostname().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60)}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  const queue = createRestStudioQueue(config);
  const handlers = { ...studioJobHandlers };
  handlers["studio.idea_review"] = createIdeaReviewHandler(productionIdeaReviewDeps((path, init) => requestStudioRest(config, path, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) })));
  handlers["studio.script_brief"] = createScriptBriefHandler(productionScriptBriefDeps((path, init) => requestStudioRest(config, path, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) })));
  handlers["studio.knowledge_extract"] = createKnowledgeExtractionHandler(productionKnowledgeExtractionDeps((path, init) => requestStudioRest(config, path, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) })));
  handlers["studio.youtube_discovery"] = createYoutubeDiscoveryHandler(productionYoutubeDiscoveryDeps((path, init) => requestStudioRest(config, path, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) })));
  const r2 = readStudioR2Config();
  // Startup preflight has already required the dedicated R2/media dependencies.
  if (r2) {
    const store = createStudioR2Store(r2);
    handlers["studio.transcribe_upload"] = createTranscribeUploadHandler(productionTranscribeDeps({
      rest: (path, init) => requestStudioRest(config, path, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) }),
      presignWorkerRead: key => store.presignWorkerRead(key) }));
  }
  if (STUDIO_WORKER_HANDLERS.some(kind => !handlers[kind])) throw new Error("missing_worker_handler");
  log({ event: "worker_started", workerId, handlers: Object.keys(handlers) });
  await runStudioWorker({ queue, handlers, workerId, release, report: { instanceId, handlers: Object.keys(handlers) },
    concurrency: Number(process.env.STUDIO_WORKER_CONCURRENCY) || 2, signal: controller.signal, log });
  log({ event: "worker_stopped", workerId });
}

main().catch(error => { log({ event: "worker_crashed", error: error instanceof Error ? error.name : "unknown" }); process.exitCode = 1; });
