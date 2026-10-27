#!/usr/bin/env tsx
import { studioReadinessRequired } from "../lib/studio/readiness";
import { readStudioRelease, runtimeStudioReadiness } from "../lib/studio/readiness-runtime";
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--mode=required", "--mode=dependencies", "--mode=worker"].includes(args[0])) throw new Error("invalid_arguments");
  if (args[0] === "--mode=required") { process.exitCode = studioReadinessRequired() ? 0 : 2; return; }
  const mode = args[0] === "--mode=worker" ? "worker" : "dependencies";
  const result = await runtimeStudioReadiness(mode, await readStudioRelease(), process.env.STUDIO_WORKER_INSTANCE, process.env.STUDIO_WORKER_STARTED_AFTER ? Number(process.env.STUDIO_WORKER_STARTED_AFTER) : undefined);
  console.log(JSON.stringify({ service: "studio-readiness", mode, ...result }));
  if (result.ready && result.degraded) {
    console.error([
      "", "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
      "!!! STUDIO DEGRADED: the Studio database provider (Supabase) has restricted",
      "!!! or paused the project. Studio pages show 'temporarily unavailable'.",
      "!!! The rest of the app deploys. Lift the restriction to restore Studio.",
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", "",
    ].join("\n"));
  }
  // 3 = ready to deploy, but Studio is degraded by a provider restriction.
  process.exitCode = !result.ready ? 1 : result.degraded ? 3 : 0;
}
main().catch(() => { console.error(JSON.stringify({ service: "studio-readiness", ready: false, error: "readiness_unconfirmed" })); process.exitCode = 1; });
