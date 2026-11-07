/** Operator recovery of a returned result, without another model turn. Preview by default. */
import db from "../lib/db";
import { verifyDelivery } from "../lib/build/delivery";
import { showThread } from "../lib/build/t3";
import { describeChanges } from "../lib/build/review";
import { json, mutate, requireCondition } from "../lib/build/store";
import { jobSpec } from "../lib/build/contract";
import path from "node:path";
async function main() {
  const args = process.argv.slice(2), jobId = args.find(a => !a.startsWith("--"));
  requireCondition(jobId && args.every(a => a === jobId || a === "--apply"), "Usage: build-recheck.ts JOB_ID [--apply]");
  const job = await db.buildJob.findUniqueOrThrow({ where: { id: jobId } });
  requireCondition(job.state === "failed", "Only a failed preserved result can be rechecked");
  const checkpoint = job.checkpoint as Record<string, any>, thread = checkpoint?.t3;
  requireCondition(thread?.threadId && thread?.worktreePath && thread?.branch, "No preserved T3 worktree");
  requireCondition(checkpoint.result?.status === "completed" && checkpoint.result?.stopped === true, "Implementation did not return a completed stopped result");
  const checkout = path.resolve(process.env.BUILD_CHECKOUT ?? process.cwd());
  const show = await showThread(process.env.BUILD_T3_CLI ?? path.join(process.env.HOME!, ".t3/bin/t3"), checkout, thread.threadId);
  requireCondition(show.thread?.status === "completed" && !show.thread.activeRunId && !show.thread.pendingRequestCount, "T3 is not completed or still needs input");
  const input = { checkout, root: process.env.BUILD_DELIVERY_ROOT ?? path.join(process.env.BUILD_CHECKPOINT_DIR ?? path.join(process.env.HOME!, ".estio-build"), "delivery"), jobId, spec: jobSpec.parse(job.spec), worktree: { cwd: thread.worktreePath, branch: thread.branch }, cwd: thread.worktreePath };
  const evidence = await verifyDelivery(input);
  requireCondition(evidence.ok, evidence.errors.join("; "));
  const review = await describeChanges(input.cwd, evidence.files);
  if (!args.includes("--apply")) { console.log(JSON.stringify({ apply: false, id: jobId, from: job.state, to: "review", files: evidence.files, diffDigest: evidence.diffDigest, expectedRows: 1 })); return; }
  await mutate(async tx => {
    const current = await tx.buildJob.findUniqueOrThrow({ where: { id: jobId } });
    requireCondition(current.state === job.state && current.updatedAt.getTime() === job.updatedAt.getTime(), "Task changed since verification");
    const fresh = await verifyDelivery(input);
    requireCondition(fresh.ok && fresh.diffDigest === evidence.diffDigest, "Worktree changed during verification");
    await tx.buildJob.update({ where: { id: jobId }, data: { state: "review", checkpoint: json({ ...checkpoint, evidence, review, reason: null, nextStep: "Review the preserved implementation; merge only after acceptance", rechecked: { at: new Date().toISOString(), previousState: job.state, previousEvidence: checkpoint.evidence, previousReason: checkpoint.reason } }) } });
  });
  console.log(JSON.stringify({ applied: true, id: jobId, state: "review" }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
