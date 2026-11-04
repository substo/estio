import { createHash } from "node:crypto";
import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { experienceFor } from "./experience";
import { describeUrl, watchId } from "./watch";
import { validateDeliveryPath } from "./delivery";
import { screenDraft, screenInstruction, undescribed } from "./contract";
import { playbookNames, playbookText, type PlaybookEdits } from "./playbook";
import { assessDifficulty, autoApprovable, autoApprovePolicy, catalogSpec, proposalDraft, edgeSpec, id, jobSpec, nodeSpec, profilesSpec, selectProfile, validLease, canRevoke } from "./contract";

export class BuildConflict extends Error {}
export function requireCondition(ok: unknown, message: string): asserts ok { if (!ok) throw new BuildConflict(message); }
function canonical(v: unknown): string { return JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, JSON.parse(canonical(x))])) : v); }
const checkpointSpec = z.record(z.unknown()).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 64000, "Checkpoint exceeds 64KB; keep full artifacts on worker");
export const json = (value: unknown) => value as Prisma.InputJsonValue;
// All Build mutations share one DB lock, including pause and approval. No Atlas table is accessed.
export async function mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741903211)`;
    await tx.buildControl.upsert({ where: { id: "build" }, create: { id: "build" }, update: {} });
    return fn(tx);
  }, { timeout: 30000 });
}
function summarizeCheckpoint(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, any>;
  return { reason: v.reason, nextStep: v.nextStep, t3: v.t3, feedback: v.feedback, auto: v.auto, localCheckpoint: v.localCheckpoint, delivery: v.delivery, evidence: v.evidence, reviewedDiffDigest: v.reviewedDiffDigest, result: v.result ? { status: v.result.status, text: String(v.result.text ?? "").slice(0, 2000), usage: v.result.usage, needsAnswer: v.result.needsAnswer === true } : undefined, independentReview: v.independentReview ? { status: v.independentReview.status, text: String(v.independentReview.text ?? "").slice(0, 2000) } : undefined };
}
export async function snapshot() {
  const [control, nodes, edges, jobs] = await Promise.all([
    db.buildControl.findUnique({ where: { id: "build" } }),
    db.buildNode.findMany({ orderBy: { id: "asc" } }), db.buildEdge.findMany(),
    db.buildJob.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  // Lease tokens are only delivered to authenticated workers, never the browser.
  // Guidance documents are listed here and fetched one at a time (see guidanceDoc).
  const { docs, ...worker } = (control?.worker ?? {}) as { docs?: { files?: { path: string; text: string }[]; at?: string } };
  const listed = control && { ...control, worker: { ...worker, docs: { at: docs?.at, files: (docs?.files ?? []).map(f => ({ path: f.path, size: f.text.length })) } } };
  return { control: listed, nodes, edges, jobs: jobs.map(({ leaseToken, ...job }) => ({ ...job, checkpoint: summarizeCheckpoint(job.checkpoint) })), execution: "Inspection available. Subscription CLI review and isolated delivery require explicit Mac worker opt-in. No merge or deploy" };
}
export async function guidanceDoc(path: string) {
  const control = await db.buildControl.findUnique({ where: { id: "build" } });
  const file = ((control?.worker as { docs?: { files?: { path: string; text: string }[] } } | undefined)?.docs?.files ?? []).find(f => f.path === path);
  if (!file) throw new BuildConflict("Document not reported by the Mac");
  return file;
}
export const operatorCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("playbook"), name: z.enum(playbookNames), text: z.string().trim().min(20).max(8000).optional(), reset: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("pause"), paused: z.boolean() }).strict(),
  z.object({ action: z.literal("daily"), enabled: z.boolean(), profileId: id }).strict(),
  z.object({ action: z.literal("recheck"), bucket: id, evidence: z.string().min(10).max(2000) }).strict(),
  z.object({ action: z.literal("profiles"), revision: z.number().int(), profiles: profilesSpec }).strict(),
  z.object({ action: z.literal("node"), id, revision: z.number().int(), spec: nodeSpec }).strict(),
  z.object({ action: z.literal("edge"), edge: edgeSpec }).strict(),
  z.object({ action: z.literal("propose"), key: id, spec: jobSpec }).strict(),
  z.object({ action: z.literal("approve"), id, revision: z.number().int() }).strict(),
  z.object({ action: z.literal("revise"), id, revision: z.number().int(), spec: jobSpec }).strict(),
  z.object({ action: z.literal("revoke"), id, revision: z.number().int() }).strict(),
  z.object({ action: z.literal("accept"), id, revision: z.number().int(), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("redo"), id, revision: z.number().int(), note: z.string().trim().min(3).max(2000) }).strict(),
  z.object({ action: z.literal("resume"), id, revision: z.number().int(), stoppedEvidence: z.string().trim().min(10).max(2000) }).strict(),
  z.object({ action: z.literal("draft"), id, revision: z.number().int(), decision: z.enum(["confirm", "discard"]) }).strict(),
  z.object({ action: z.literal("auto-approve"), mode: z.enum(["off", "record", "on"]) }).strict(),
  z.object({ action: z.literal("watch"), url: z.string().url().max(400), note: z.string().trim().max(1000).optional(), screenIds: z.array(id).max(20) }).strict(),
  z.object({ action: z.literal("watch-update"), id, status: z.enum(["watching", "adopted", "rejected"]).optional(), seen: z.literal(true).optional() }).strict(),
]);
export async function operator(input: z.infer<typeof operatorCommand>, actor: string) {
  return mutate(async tx => {
    const control = (await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } }));
    switch (input.action) {
      case "daily": {
        const profile = profilesSpec.parse(control.profiles).find(p => p.id === input.profileId);
        requireCondition(!input.enabled || (profile?.enabled && profile.taskTypes.includes("review") && profile.tools.includes("git-read")), "Choose an enabled read-only review profile");
        const meta = control.worker as { daily?: { lastRunDate?: string; lastNodeId?: string } };
        return tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, daily: { enabled: input.enabled, actor, profileId: input.profileId, grantId: randomUUID(), policyRevision: control.revision, lastRunDate: meta.daily?.lastRunDate ?? null, lastNodeId: meta.daily?.lastNodeId ?? null } }) } });
      }
      case "recheck": {
        const meta = control.worker as { quotaBuckets?: Record<string, unknown> };
        const buckets = { ...meta.quotaBuckets }; delete buckets[input.bucket];
        return tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, quotaBuckets: buckets, capacityRecheck: { actor, evidence: input.evidence, at: new Date().toISOString() } }) } });
      }
      case "playbook": {
        // One level of undo: the text it replaced is kept as previous.
        const meta = control.worker as { playbook?: PlaybookEdits };
        const edits = { ...meta.playbook };
        requireCondition(input.reset || input.text, "Write the new text or reset to the default");
        if (input.reset) delete edits[input.name];
        else edits[input.name] = { text: input.text!, at: new Date().toISOString(), previous: playbookText(meta.playbook, input.name) };
        return tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, playbook: edits }) } });
      }
      case "pause": return tx.buildControl.update({ where: { id: "build" }, data: { paused: input.paused } });
      case "profiles": {
        requireCondition(control.revision === input.revision, "Profile policy changed; reload");
        const catalog = catalogSpec.safeParse((control.worker as { catalog?: unknown }).catalog);
        const missing = input.profiles.filter(p => p.enabled && !(catalog.success && catalog.data.some(c => c.provider === p.provider && c.model === p.model)));
        requireCondition(!missing.length, `Not in the Mac worker's T3 catalog: ${missing.map(p => p.model).join(", ")}. Start the worker and reload`);
        return tx.buildControl.update({ where: { id: "build" }, data: { profiles: json(input.profiles), revision: { increment: 1 } } });
      }
      case "node": {
        const old = await tx.buildNode.findUnique({ where: { id: input.id } });
        requireCondition((old?.revision ?? 0) === input.revision, "Node changed; reload");
        // An owner rename is kept; scanner derivation never overwrites it.
        if (old && nodeSpec.parse(old.spec).name !== input.spec.name) input.spec = { ...input.spec, naming: "owner" };
        return tx.buildNode.upsert({ where: { id: input.id }, create: { id: input.id, spec: json(input.spec) }, update: { spec: json(input.spec), revision: { increment: 1 } } });
      }
      case "draft": {
        const node = await tx.buildNode.findUniqueOrThrow({ where: { id: input.id } });
        requireCondition(node.revision === input.revision, "Screen changed; reload");
        const { draft, ...spec } = nodeSpec.parse(node.spec);
        requireCondition(draft, "No draft on this screen");
        if (input.decision === "discard") return tx.buildNode.update({ where: { id: node.id }, data: { spec: json(spec), revision: { increment: 1 } } });
        // Confirming makes the draft the screen's description and approved intent, and adds its features under the screen.
        const confirmed = { ...spec, purpose: draft.purpose, journey: draft.journey, intent: draft.purpose, coverage: "confirmed" as const };
        await tx.buildNode.update({ where: { id: node.id }, data: { spec: json(confirmed), revision: { increment: 1 } } });
        for (const f of draft.features) {
          const featureId = `feature-${createHash("sha256").update(`${node.id}:${f.name.toLowerCase()}`).digest("hex").slice(0, 24)}`;
          const feature = nodeSpec.parse({ ...confirmed, name: f.name, purpose: f.purpose, intent: f.purpose, journey: f.journey || "Not described", kind: "feature", observed: `Drafted by review ${draft.from}; confirmed by owner`, freshness: "unknown", coverage: "confirmed", checks: [], evidenceRevision: undefined, naming: "owner", route: confirmed.route });
          await tx.buildNode.upsert({ where: { id: featureId }, create: { id: featureId, spec: json(feature) }, update: {} });
          await tx.buildEdge.upsert({ where: { fromId_toId_kind: { fromId: node.id, toId: featureId, kind: "contains" } }, create: { fromId: node.id, toId: featureId, kind: "contains", evidence: { source: "Owner confirmed draft", revision: confirmed.sourceRevision, coverage: "confirmed" } }, update: {} });
        }
        return { confirmed: node.id, features: draft.features.length };
      }
      case "auto-approve": {
        const meta = control.worker as object;
        return tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, autoApprove: { mode: input.mode, actor, at: new Date().toISOString() } }) } });
      }
      case "watch": {
        const kind = describeUrl(input.url), nodeId = watchId(input.url);
        requireCondition(!(await tx.buildNode.findUnique({ where: { id: nodeId } })), "Already on the watch list");
        requireCondition(await tx.buildNode.count({ where: { id: { in: input.screenIds } } }) === new Set(input.screenIds).size, "Unknown screen");
        const note = input.note || "Added from link; what to take is not decided yet";
        await tx.buildNode.create({ data: { id: nodeId, spec: json(nodeSpec.parse({ name: kind.name, purpose: note, app: "both", product: "shared", kind: "reference", intent: note,
          observed: kind.github ? "Not checked yet; the Mac worker checks GitHub daily" : "One-off link; not automatically checked", journey: "Not applicable", sourceRefs: [input.url],
          sourceRevision: "watch", freshness: "unknown", checks: [], coverage: "unknown", section: "Watch list", area: kind.area, naming: "owner",
          watch: { status: "watching", url: input.url, checkable: !!kind.github } })) } });
        if (input.screenIds.length) await tx.buildEdge.createMany({ data: input.screenIds.map(toId => ({ fromId: nodeId, toId, kind: "inspires", evidence: { source: "Owner link", revision: "watch", coverage: "confirmed" } })), skipDuplicates: true });
        return { id: nodeId };
      }
      case "watch-update": {
        const node = await tx.buildNode.findUniqueOrThrow({ where: { id: input.id } });
        const spec = nodeSpec.parse(node.spec);
        requireCondition(spec.kind === "reference" && spec.watch, "Not a watch-list item");
        const watch = { ...spec.watch, ...(input.status ? { status: input.status } : {}), ...(input.seen ? { seen: spec.watch.latest } : {}) };
        return tx.buildNode.update({ where: { id: node.id }, data: { spec: json({ ...spec, watch }), revision: { increment: 1 } } });
      }
      case "edge": return tx.buildEdge.upsert({ where: { fromId_toId_kind: { fromId: input.edge.fromId, toId: input.edge.toId, kind: input.edge.kind } }, create: { ...input.edge, evidence: json(input.edge.evidence) }, update: { evidence: json(input.edge.evidence) } });
      case "propose": {
        requireCondition(await tx.buildNode.count({ where: { id: { in: input.spec.nodeIds } } }) === new Set(input.spec.nodeIds).size, "Unknown affected row");
        input.spec = await routed(tx, control, input.spec);
        const existing = await tx.buildJob.findUnique({ where: { key: input.key } });
        if (existing) { requireCondition(canonical(existing.spec) === canonical(input.spec), "Duplicate key belongs to a different scope"); return existing; }
        return autoDecide(tx, control, await tx.buildJob.create({ data: { key: input.key, spec: json(input.spec) } }));
      }
      default: {
        const job = await tx.buildJob.findUniqueOrThrow({ where: { id: input.id } });
        requireCondition(job.revision === input.revision, "Proposal changed; reload");
        if (input.action === "revise") {
          requireCondition(job.state === "proposed", "Recover to proposal before changing scope");
          input.spec = await routed(tx, control, input.spec);
          return tx.buildJob.update({ where: { id: job.id }, data: { spec: json(input.spec), revision: { increment: 1 }, approval: Prisma.DbNull, attempt: Prisma.DbNull } });
        }
        if (input.action === "resume") {
          requireCondition(["waiting-for-capacity", "blocked-configuration", "blocked-stale-approval", "blocked-lease-expired", "failed", "revoked"].includes(job.state), "Stop active work before recovery");
          return tx.buildJob.update({ where: { id: job.id }, data: { state: "proposed", revision: { increment: 1 }, approval: Prisma.DbNull, leaseToken: null, leaseUntil: null, checkpoint: json({ ...(job.checkpoint as object), recovery: { actor, at: new Date().toISOString(), stoppedEvidence: input.stoppedEvidence } }) } });
        }
        if (input.action === "revoke") {
          requireCondition(canRevoke(job.state), "Writer may still exist; use explicit stopped-writer recovery");
          // A working lease remains fenced until its worker acknowledges stop or expiry is reconciled.
          return tx.buildJob.update({ where: { id: job.id }, data: { state: job.state === "working" ? "stopping" : "revoked", revision: { increment: 1 } } });
        }
        // Owner feedback lives in checkpoint.feedback; the worker sends unsent notes to the same T3 thread.
        const feedback = [...(((job.checkpoint as { feedback?: unknown[] } | null)?.feedback) ?? [])].slice(-19);
        if (input.action === "accept") {
          requireCondition(job.state === "review", "Only reviewed results may be accepted");
          if (input.note) feedback.push({ at: new Date().toISOString(), actor, decision: "accept", note: input.note });
          return tx.buildJob.update({ where: { id: job.id }, data: { state: "done", revision: { increment: 1 }, checkpoint: json({ ...(job.checkpoint as object), feedback }) } });
        }
        if (input.action === "redo") {
          requireCondition(["review", "failed"].includes(job.state), "Only a returned result can be redone");
          const spec = jobSpec.parse(job.spec);
          const profile = selectProfile(profilesSpec.parse(control.profiles), spec, { exhaustedBuckets: Object.keys((control.worker as { quotaBuckets?: object }).quotaBuckets ?? {}) });
          requireCondition(profile, "No enabled approved model can take this redo");
          const nodes = await tx.buildNode.findMany({ where: { id: { in: spec.nodeIds } } });
          feedback.push({ at: new Date().toISOString(), actor, decision: "redo", note: input.note });
          // Redo is a fresh owner approval of the same scope and base, bound to current revisions.
          return tx.buildJob.update({ where: { id: job.id }, data: { state: "approved", revision: { increment: 1 },
            checkpoint: json({ ...(job.checkpoint as object), feedback, reason: undefined, nextStep: "Redo queued with owner feedback" }),
            approval: json({ actor, at: new Date().toISOString(), revision: job.revision + 1, spec, policyRevision: control.revision, profile, redo: true, nodes: nodes.map(n => ({ id: n.id, revision: n.revision })) }) } });
        }
        requireCondition(job.state === "proposed", "Only current proposals can be approved");
        return approveJob(tx, control, job, actor);
      }
    }
  });
}
/** Owner approval of a proposal's exact scope, bound to the current policy and map revisions. */
export async function approveJob(tx: Prisma.TransactionClient, control: { revision: number; profiles: unknown; worker: unknown }, job: { id: string; revision: number; spec: unknown }, actor: string) {
  const spec = jobSpec.parse(job.spec);
  const profile = selectProfile(profilesSpec.parse(control.profiles), spec, { exhaustedBuckets: Object.keys((control.worker as { quotaBuckets?: object }).quotaBuckets ?? {}) });
  requireCondition(profile, "No enabled, qualified approved profile");
  const nodes = await tx.buildNode.findMany({ where: { id: { in: spec.nodeIds } } });
  return tx.buildJob.update({ where: { id: job.id }, data: {
    state: "approved", approval: json({ actor, at: new Date().toISOString(), revision: job.revision, spec, policyRevision: control.revision, profile,
      nodes: nodes.map(n => ({ id: n.id, revision: n.revision })) }),
  } });
}

async function contextFor(tx: Prisma.TransactionClient, nodeIds: string[]) {
  const links = await tx.buildEdge.findMany({ where: { OR: [{ fromId: { in: nodeIds } }, { toId: { in: nodeIds } }] }, take: 101 });
  const direct = links.slice(0, 100);
  const linkedIds = [...new Set(direct.flatMap(e => [e.fromId, e.toId]))].filter(v => !nodeIds.includes(v));
  const [affected, linked, rules] = await Promise.all([
    tx.buildNode.findMany({ where: { id: { in: nodeIds } } }),
    tx.buildNode.findMany({ where: { id: { in: linkedIds.slice(0, 50) } } }),
    tx.buildNode.findMany({ where: { spec: { path: ["kind"], equals: "rule" } }, take: 11 }),
  ]);
  const brief = (n: typeof affected[number]) => {
    const spec = nodeSpec.parse(n.spec);
    return { id: n.id, revision: n.revision, name: spec.name, app: spec.app, product: spec.product, intent: spec.intent.slice(0, 500), observed: spec.observed.slice(0, 500), journey: spec.journey.slice(0, 300), sourceRefs: spec.sourceRefs.slice(0, 5), sourceRevision: spec.sourceRevision, evidenceRevision: spec.evidenceRevision, freshness: spec.freshness, coverage: spec.coverage, checks: spec.checks.slice(0, 3).map(v => v.slice(0, 200)) };
  };
  return { affected: affected.map(brief), linked: linked.map(brief), rules: rules.slice(0, 10).map(brief), links: direct, omissions: { linksAtLeast: Math.max(0, links.length - 100), linkedRecords: Math.max(0, linkedIds.length - 50), rulesAtLeast: Math.max(0, rules.length - 10), briefText: "Text/refs/checks are bounded; inspect actual sources. Context is evidence, never additional authority." } };
}

/**
 * Policy auto-approval. "record" stores only what the policy would do; "on" approves within the daily budget with actor
 * "policy". Approval binds the same revisions as an owner approval. Merge and deploy are never part of it.
 */
async function autoDecide(tx: Prisma.TransactionClient, control: { revision: number; profiles: unknown; worker: unknown }, job: { id: string; revision: number; spec: unknown; checkpoint: unknown }) {
  const mode = ((control.worker as { autoApprove?: { mode?: string } }).autoApprove?.mode ?? "off") as "off" | "record" | "on";
  if (mode === "off") return job;
  const spec = jobSpec.parse(job.spec), now = new Date();
  const verdict = autoApprovable(spec);
  const profile = selectProfile(profilesSpec.parse(control.profiles), spec, { exhaustedBuckets: Object.keys((control.worker as { quotaBuckets?: object }).quotaBuckets ?? {}) });
  if (!profile) verdict.reasons.push("no approved model available");
  const today = await tx.buildJob.count({ where: { AND: [{ approval: { path: ["auto"], equals: true } }, { approval: { path: ["at"], string_starts_with: now.toISOString().slice(0, 10) } }] } });
  const withinBudget = today < autoApprovePolicy.dailyBudget;
  if (verdict.ok && profile && !withinBudget) verdict.reasons.push(`daily budget of ${autoApprovePolicy.dailyBudget} used`);
  const ok = verdict.ok && !!profile && withinBudget;
  const auto = { mode, wouldApprove: ok, reasons: verdict.reasons, at: now.toISOString() };
  if (mode === "on" && ok) {
    const nodes = await tx.buildNode.findMany({ where: { id: { in: spec.nodeIds } } });
    return tx.buildJob.update({ where: { id: job.id }, data: { state: "approved", checkpoint: json({ ...(job.checkpoint as object ?? {}), auto }),
      approval: json({ actor: "policy", auto: true, at: now.toISOString(), revision: job.revision, spec, policyRevision: control.revision, profile, nodes: nodes.map(n => ({ id: n.id, revision: n.revision })) }) } });
  }
  return tx.buildJob.update({ where: { id: job.id }, data: { checkpoint: json({ ...(job.checkpoint as object ?? {}), auto }) } });
}
/** Server-side routing: difficulty and model are decided here, never by the browser. */
export async function routed(tx: Prisma.TransactionClient, control: { profiles: unknown; worker: unknown }, spec: import("./contract").JobSpec) {
  const dependents = await tx.buildEdge.count({ where: { toId: { in: spec.nodeIds }, kind: { not: "inspires" } } });
  const assessed = { ...spec, ...assessDifficulty(spec, dependents) };
  const profile = selectProfile(profilesSpec.parse(control.profiles), { ...assessed, profileId: "auto" }, { exhaustedBuckets: Object.keys((control.worker as { quotaBuckets?: object }).quotaBuckets ?? {}) });
  return { ...assessed, profileId: profile?.id ?? "auto" };
}
async function admitDaily(tx: Prisma.TransactionClient, control: { revision: number; profiles: unknown; worker: unknown }, now: Date) {
  const meta = control.worker as { head?: string; quotaBuckets?: object; daily?: { enabled: boolean; actor: string; profileId: string; grantId: string; policyRevision: number; lastRunDate?: string; lastNodeId?: string } };
  const grant = meta.daily, day = now.toISOString().slice(0, 10);
  if (!grant?.enabled || grant.policyRevision !== control.revision || grant.lastRunDate === day || !/^[a-f0-9]{40}$/.test(meta.head ?? "")) return;
  const profiles = profilesSpec.parse(control.profiles);
  const profile = selectProfile(profiles, { profileId: grant.profileId, taskType: "review", tools: ["git-read"], quality: 2 } as import("./contract").JobSpec, { exhaustedBuckets: Object.keys(meta.quotaBuckets ?? {}) });
  if (!profile) return;
  const stalePage = { AND: [{ spec: { path: ["kind"], equals: "page" } }, { spec: { path: ["freshness"], not: "verified" } }] };
  const afterCursor = grant.lastNodeId ? await tx.buildNode.findFirst({ where: { ...stalePage, id: { gt: grant.lastNodeId } }, orderBy: { id: "asc" } }) : null;
  // A watched reference that changed since the owner looked takes priority for one of its linked screens.
  const refs = (await tx.buildNode.findMany({ where: { spec: { path: ["kind"], equals: "reference" } }, take: 200 }))
    .map(n => ({ n, spec: nodeSpec.parse(n.spec) })).filter(({ spec }) => spec.watch && spec.watch.status === "watching" && spec.watch.latest && spec.watch.latest !== spec.watch.seen && spec.watch.queued !== spec.watch.latest);
  let changedRef: (typeof refs)[number] | undefined, linkedScreen: Awaited<ReturnType<typeof tx.buildNode.findFirst>> = null;
  for (const ref of refs) {
    const edge = await tx.buildEdge.findFirst({ where: { fromId: ref.n.id, kind: "inspires" } });
    linkedScreen = edge ? await tx.buildNode.findUnique({ where: { id: edge.toId } }) : null;
    if (linkedScreen && nodeSpec.parse(linkedScreen.spec).kind === "page") { changedRef = ref; break; }
  }
  // Screens nobody has described yet go first (no draft waiting), so the experience map fills in; then stale rotation.
  const blank = changedRef ? [] : (await tx.buildNode.findMany({ where: { AND: [{ spec: { path: ["kind"], equals: "page" } }, { spec: { path: ["purpose"], equals: undescribed } }] }, orderBy: { id: "asc" }, take: 500 }))
    .filter(n => !nodeSpec.parse(n.spec).draft);
  const fresh = blank.find(n => !grant.lastNodeId || n.id > grant.lastNodeId) ?? blank[0] ?? null;
  const node = changedRef ? linkedScreen : fresh ?? afterCursor ?? await tx.buildNode.findFirst({ where: stalePage, orderBy: { id: "asc" } });
  if (!node) return;
  const brief = nodeSpec.parse(node.spec);
  const inspiration = changedRef ? ` Watch list: "${changedRef.spec.name}" changed (${changedRef.spec.observed.slice(0, 300)}). Owner note: ${changedRef.spec.intent.slice(0, 300)}. Say what, if anything, this screen should adopt.` : "";
  if (changedRef) await tx.buildNode.update({ where: { id: changedRef.n.id }, data: { spec: json({ ...changedRef.spec, watch: { ...changedRef.spec.watch!, queued: changedRef.spec.watch!.latest } }), revision: { increment: 1 } } });
  const spec = jobSpec.parse({ title: `Daily ${changedRef ? "watch-list" : "page"} review: ${brief.name}`, outcome: `Return up to three concise evidence-backed improvements and a smallest-change plan. Do not edit or approve implementation.${inspiration} ${screenInstruction}`.slice(0, 4000), reason: "Owner's standing daily read-only review grant", scope: brief.sourceRefs, nodeIds: [node.id], acceptance: ["Inspect approved intent, observed source and direct dependencies", "Return evidence, freshness gaps, risk and a bounded recommendation; no writes"], baseRevision: meta.head, endpoint: "review", taskType: "review", profileId: grant.profileId, quality: 2, tools: ["git-read"], owner: "estio-build" });
  await tx.buildJob.upsert({ where: { key: `daily-${day}` }, create: { key: `daily-${day}`, state: "approved", spec: json(spec), approval: json({ actor: grant.actor, at: now.toISOString(), revision: 1, spec, profile, policyRevision: control.revision, standingGrantId: grant.grantId, nodes: [{ id: node.id, revision: node.revision }] }) }, update: {} });
  await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, daily: { ...grant, lastRunDate: day, lastNodeId: changedRef ? grant.lastNodeId : node.id } }) } });
}
function standingCurrent(control: { worker: unknown }, approval: unknown) {
  const approved = approval as { standingGrantId?: string } | null;
  const grant = (control.worker as { daily?: { enabled: boolean; grantId: string } }).daily;
  return !approved?.standingGrantId || (grant?.enabled && grant.grantId === approved.standingGrantId);
}

export const workerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("poll"), workerId: id, catalog: catalogSpec.optional() }).strict(),
  z.object({ action: z.literal("docs"), workerId: id, files: z.array(z.object({ path: z.string().regex(/^[a-zA-Z0-9._/-]{1,200}$/), text: z.string().max(60000) }).strict()).max(20) }).strict(),
  z.object({ action: z.literal("watch-report"), workerId: id, results: z.array(z.object({ id, latest: z.string().max(200).optional(), summary: z.string().max(600) }).strict()).max(20) }).strict(),
  z.object({ action: z.literal("claim"), workerId: id, review: z.boolean().optional(), implementation: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("heartbeat"), workerId: id, id, token: z.string().uuid(), checkpoint: checkpointSpec }).strict(),
  z.object({ action: z.literal("complete"), workerId: id, id, token: z.string().uuid(), checkpoint: checkpointSpec, outcome: z.enum(["review", "waiting-for-capacity", "failed", "stopped"]), stopped: z.literal(true) }).strict(),
]);
export async function worker(input: z.infer<typeof workerCommand>) {
  return mutate(async tx => {
    const now = new Date();
    const control = await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } });
    await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...(control.worker as object), id: input.workerId, lastSeenAt: now.toISOString(), execution: "inspection / opt-in T3 threads", quota: "unknown" }) } });
    // Expiry is not evidence the old writer stopped. Never automatically retry these jobs.
    await tx.buildJob.updateMany({ where: { state: { in: ["working", "stopping"] }, leaseUntil: { lte: now } }, data: { state: "blocked-lease-expired" } });
    if (input.action === "poll" && input.catalog) await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...(control.worker as object), id: input.workerId, lastSeenAt: now.toISOString(), execution: "inspection / opt-in T3 threads", quota: "unknown", catalog: input.catalog, catalogAt: now.toISOString() }) } });
    if (input.action === "docs") {
      const meta = (await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } })).worker as object;
      await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, docs: { at: now.toISOString(), files: input.files } }) } });
      return { ok: true };
    }
    if (input.action === "watch-report") {
      for (const r of input.results) {
        const node = await tx.buildNode.findUnique({ where: { id: r.id } });
        const spec = node ? nodeSpec.safeParse(node.spec) : null;
        if (!node || !spec?.success || !spec.data.watch?.checkable) continue;
        const w = spec.data.watch, latest = r.latest ?? w.latest;
        // The first successful check is the baseline, so only later changes are flagged.
        const watch = { ...w, latest, seen: w.seen ?? latest, checkedAt: now.toISOString() };
        await tx.buildNode.update({ where: { id: node.id }, data: { spec: json({ ...spec.data, observed: r.summary, watch }), revision: { increment: 1 } } });
      }
      return { ok: true };
    }
    if (input.action === "poll") {
      // References due a daily check: plain GitHub API calls on the Mac, no model.
      const refs = await tx.buildNode.findMany({ where: { spec: { path: ["kind"], equals: "reference" } }, take: 200 });
      const dayAgo = now.getTime() - 24 * 3600_000;
      const watch = refs.map(n => ({ id: n.id, w: nodeSpec.parse(n.spec).watch })).filter(({ w }) => w?.checkable && w.status === "watching" && (!w.checkedAt || Date.parse(w.checkedAt) < dayAgo)).slice(0, 10).map(({ id, w }) => ({ id, url: w!.url }));
      return { paused: control.paused, execution: "inspect-only", policyRevision: control.revision, watch };
    }
    if (input.action === "claim") {
      if (control.paused || await tx.buildJob.count({ where: { state: { in: ["working", "stopping", "blocked-lease-expired"] } } })) return { job: null };
      if (input.review) await admitDaily(tx, control, now);
      const jobs = await tx.buildJob.findMany({ where: { state: "approved" }, orderBy: { createdAt: "asc" }, take: 100 });
      for (const job of jobs) {
        const spec = jobSpec.parse(job.spec);
        const approval = job.approval as { revision: number; policyRevision: number; nodes: { id: string; revision: number }[] } | null;
        const nodes = await tx.buildNode.findMany({ where: { id: { in: spec.nodeIds } } });
        if (!approval || !standingCurrent(control, approval) || approval.revision !== job.revision || approval.policyRevision !== control.revision || approval.nodes.some(n => !nodes.some(current => current.id === n.id && current.revision === n.revision))) {
          await tx.buildJob.update({ where: { id: job.id }, data: { state: "blocked-stale-approval" } }); continue;
        }
        const profiles = profilesSpec.parse(control.profiles);
        const prior = job.attempt as { nextProfileId?: string; exhaustedBuckets?: string[]; count?: number; history?: unknown[] } | null;
        const exhausted = Object.keys((control.worker as { quotaBuckets?: object }).quotaBuckets ?? {});
        const profile = prior?.nextProfileId ? profiles.find(p => p.id === prior.nextProfileId && !exhausted.includes(p.quotaBucket)) : selectProfile(profiles, spec, { exhaustedBuckets: exhausted });
        if (!profile || (spec.taskType !== "inspect" && !((spec.taskType === "review" && input.review && spec.tools.every(t => t === "git-read")) || (spec.taskType === "implementation" && input.implementation && spec.tools.includes("code-write"))))) {
          await tx.buildJob.update({ where: { id: job.id }, data: { state: profile ? "blocked-configuration" : "waiting-for-capacity", checkpoint: { reason: profile ? "Worker lacks this execution capability; implementation writes disabled" : "No eligible approved profile", stopped: true } } }); continue;
        }
        const claimed = await tx.buildJob.update({ where: { id: job.id }, data: {
          state: "working", workerId: input.workerId, leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + 60000),
          attempt: json({ profile, policyRevision: control.revision, startedAt: now.toISOString(), routingReason: prior?.nextProfileId ? "approved fallback after confirmed stopped writer" : "approved primary", quota: "unknown", count: (prior?.count ?? 0) + 1, exhaustedBuckets: prior?.exhaustedBuckets ?? [], history: prior?.history ?? [] }),
        } });
        const edits = (control.worker as { playbook?: PlaybookEdits }).playbook;
        return { job: { ...claimed, context: await contextFor(tx, spec.nodeIds) }, playbook: { task: playbookText(edits, "task"), review: playbookText(edits, "review") } };
      }
      return { job: null };
    }
    const job = await tx.buildJob.findUniqueOrThrow({ where: { id: input.id } });
    if (input.action === "heartbeat" && job.state === "stopping" && job.leaseToken === input.token && job.workerId === input.workerId && job.leaseUntil && job.leaseUntil > now) return { stop: true, reason: "Approval revoked; preserve work and acknowledge stopped" };
    // stopping is allowed solely for a stopped acknowledgement, not an evidence completion.
    const stoppedAck = input.action === "complete" && input.outcome === "stopped" && job.state === "stopping";
    requireCondition(validLease({ ...job, state: stoppedAck ? "working" : job.state }, input.token, input.workerId, now), "Lease stale, duplicate, revoked or owned by another worker");
    if (input.action === "heartbeat") {
      if (control.paused || !standingCurrent(control, job.approval)) return { stop: true, reason: "Operator paused" };
      const approval = job.approval as { policyRevision: number; nodes: { id: string; revision: number }[] };
      const currentNodes = await tx.buildNode.findMany({ where: { id: { in: approval.nodes.map(n => n.id) } } });
      if (approval.policyRevision !== control.revision || approval.nodes.some(n => !currentNodes.some(v => v.id === n.id && v.revision === n.revision))) return { stop: true, reason: "Approval superseded; stop and preserve checkpoint" };
      return tx.buildJob.update({ where: { id: job.id }, data: { checkpoint: json(input.checkpoint), leaseUntil: new Date(now.getTime() + 60000) } });
    }
    requireCondition(!control.paused || input.outcome === "stopped", "Paused: stop and preserve checkpoint");
    if (input.outcome === "review") {
      const approval = job.approval as { policyRevision: number; nodes: { id: string; revision: number }[] };
      const nodes = await tx.buildNode.findMany({ where: { id: { in: approval.nodes.map(n => n.id) } } });
      requireCondition(standingCurrent(control, approval) && approval.policyRevision === control.revision && approval.nodes.every(n => nodes.some(v => v.id === n.id && v.revision === n.revision)), "Approval superseded; preserve result and stop");
    }
    if (input.outcome === "waiting-for-capacity") {
      const attempt = job.attempt as { profile: import("./contract").Profile; exhaustedBuckets: string[]; count: number; history: unknown[] };
      const exhaustedBuckets = [...new Set([...(attempt.exhaustedBuckets ?? []), attempt.profile.quotaBucket])];
      const meta = control.worker as { quotaBuckets?: Record<string, unknown> };
      const buckets = { ...meta.quotaBuckets, [attempt.profile.quotaBucket]: { observedAt: now.toISOString(), reset: "unknown" } };
      await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...meta, quotaBuckets: buckets }) } });
      const candidate = selectProfile(profilesSpec.parse(control.profiles), jobSpec.parse(job.spec), { previous: attempt.profile, stopped: input.stopped, exhaustedBuckets: Object.keys(buckets) });
      const eligible = candidate && attempt.count < attempt.profile.maxAttempts && control.revision === (job.approval as { policyRevision: number }).policyRevision;
      return tx.buildJob.update({ where: { id: job.id }, data: {
        state: eligible ? "approved" : "waiting-for-capacity", leaseToken: null, leaseUntil: null,
        checkpoint: json({ ...input.checkpoint, stopped: true, exhaustedBuckets, reason: eligible ? "Stopped; qualified approved fallback pending" : "No eligible fallback or attempt limit reached; owner action required" }),
        attempt: json({ ...attempt, exhaustedBuckets, nextProfileId: eligible ? candidate.id : null, history: [...(attempt.history ?? []), { profile: attempt.profile, outcome: "capacity", stopped: true, at: now.toISOString() }] }),
      } });
    }
    // A review's screen description is stored as a draft on its screen (no revision bump: it is not intent).
    const draftSpec = jobSpec.parse(job.spec), screen = screenDraft.safeParse(input.checkpoint.screenDraft);
    if (input.outcome === "review" && draftSpec.taskType === "review" && screen.success && draftSpec.nodeIds.length === 1) {
      const node = await tx.buildNode.findUnique({ where: { id: draftSpec.nodeIds[0] } });
      const current = node ? nodeSpec.safeParse(node.spec) : null;
      if (node && current?.success && current.data.kind === "page")
        await tx.buildNode.update({ where: { id: node.id }, data: { spec: json({ ...current.data, draft: { ...screen.data, at: now.toISOString(), from: draftSpec.title.slice(0, 120) } }) } });
    }
    // A completed review's proposals become unapproved, server-routed cards. A daily review is then done: its cards are the output.
    let state: string = input.outcome === "stopped" ? "revoked" : input.outcome;
    const spec = jobSpec.parse(job.spec);
    if (input.outcome === "review" && spec.taskType === "review" && Array.isArray(input.checkpoint.proposals)) {
      const head = (control.worker as { head?: string }).head;
      const created: string[] = []; let rejected = 0;
      for (const [i, raw] of input.checkpoint.proposals.slice(0, 3).entries()) {
        const draft = proposalDraft.safeParse(raw);
        if (!draft.success || draft.data.scope.some(f => { try { validateDeliveryPath(f); return false; } catch { return true; } })) { rejected++; continue; }
        const key = `from-${job.id}-${i}`;
        const proposal = await routed(tx, control, jobSpec.parse({ ...draft.data, reason: `Suggested by review "${spec.title}": ${draft.data.reason}`.slice(0, 4000), nodeIds: spec.nodeIds,
          baseRevision: /^[a-f0-9]{40}$/.test(head ?? "") ? head : spec.baseRevision, endpoint: "review", taskType: "implementation", profileId: "auto", quality: 2, tools: ["git-read", "code-write"], owner: "estio-build" }));
        const card = await tx.buildJob.upsert({ where: { key }, create: { key, spec: json(proposal) }, update: {} });
        if (card.state === "proposed" && !card.checkpoint) await autoDecide(tx, control, card);
        created.push(key);
      }
      input.checkpoint = { ...input.checkpoint, proposalsCreated: created.length, proposalsRejected: rejected + Number(input.checkpoint.proposalsDropped ?? 0),
        nextStep: created.length ? `${created.length} proposal${created.length === 1 ? "" : "s"} added as unapproved cards` : "Review found nothing worth proposing" };
      if ((job.approval as { standingGrantId?: string } | null)?.standingGrantId) state = "done";
    }
    return tx.buildJob.update({ where: { id: job.id }, data: {
      state, checkpoint: json(input.checkpoint), leaseToken: null, leaseUntil: null,
    } });
  });
}

// Deterministic local snapshot reconciliation. Never turns generated descriptions into approved intent.
export async function reconcile(scan: import("./scanner").Scan) {
  const { reverseAffected } = await import("./scanner");
  return mutate(async tx => {
    const old = await tx.buildNode.findMany();
    const oldEdges = await tx.buildEdge.findMany();
    const changed: string[] = [];
    const creates: { id: string; spec: Prisma.InputJsonValue }[] = [];
    const renames: { id: string; patch: object }[] = [];
    const control = await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } });
    await tx.buildControl.update({ where: { id: "build" }, data: { worker: json({ ...(control.worker as object), head: scan.head, scannedAt: new Date().toISOString() }) } });
    const nextEdges = scan.files.flatMap(f => f.imports.map(toId => ({ fromId: f.id, toId })));
    for (const f of scan.files) {
      const previous = old.find(n => n.id === f.id);
      const prior = previous ? nodeSpec.parse(previous.spec) : null;
      const revision = `${scan.head}:${f.hash}`;
      // Screens come from page routes; everything else is a resource (evidence under screens). Owner renames are kept.
      const screen = experienceFor(f.path);
      const derive = !prior || prior.naming === "derived" || prior.name === f.path;
      const derived = derive ? (screen
        ? { name: screen.name, route: screen.route, section: screen.section, area: screen.area, product: screen.product, kind: "page" as const, naming: "derived" as const }
        : { name: f.path, kind: "resource" as const, naming: "derived" as const, product: f.path.includes("studio") ? "studio" as const : prior?.product ?? "shared" as const }) : {};
      const unchanged = prior?.sourceRevision.split(":").at(-1) === f.hash && prior.observed !== "Removed from tracked inventory";
      if (unchanged) {
        // Naming-only refresh: no freshness change and no dependency invalidation.
        if (previous && Object.entries(derived).some(([k, v]) => prior[k as keyof typeof prior] !== v)) renames.push({ id: f.id, patch: derived });
        continue;
      }
      changed.push(f.id);
      const spec = {
        name: f.path, purpose: undescribed, app: "both" as const,
        product: f.path.includes("studio") ? "studio" as const : "shared" as const,
        kind: "resource" as const,
        intent: "Not yet approved; curate this source record", journey: "Not yet inspected", checks: [],
        ...prior, ...derived, observed: `Tracked source; ${f.imports.length} resolved imports. ${f.uncertain ? "Unresolved/external/dynamic dependencies present." : "Static imports resolved; runtime dependencies uninspected."}`,
        sourceRefs: [f.path], sourceRevision: revision, freshness: "stale" as const, coverage: "inferred" as const,
      };
      if (!previous) creates.push({ id: f.id, spec: json(spec) });
      else await tx.buildNode.update({ where: { id: f.id }, data: { spec: json(spec), revision: { increment: 1 } } });
    }
    if (creates.length) await tx.buildNode.createMany({ data: creates });
    // One statement for naming-only refreshes; per-row updates exceed the transaction limit on a full map.
    if (renames.length) await tx.$executeRaw(Prisma.sql`UPDATE "BuildNode" AS n SET "spec" = n."spec" || v.patch, "revision" = n."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP FROM jsonb_to_recordset(${JSON.stringify(renames)}::jsonb) AS v(id text, patch jsonb) WHERE n."id" = v.id`);
    for (const n of old) {
      const spec = nodeSpec.parse(n.spec);
      if (n.id.startsWith("file-") && !scan.files.some(f => f.id === n.id) && spec.observed !== "Removed from tracked inventory") {
        changed.push(n.id);
        await tx.buildNode.update({ where: { id: n.id }, data: { spec: json({ ...spec, observed: "Removed from tracked inventory", freshness: "stale" }), revision: { increment: 1 } } });
      }
    }
    if (!changed.length) return { changed: 0, affected: 0, renamed: renames.length, head: scan.head };
    // Include deleted imports before replacing scanner-owned edges. Curated edges remain.
    const globalChange = scan.files.some(f => changed.includes(f.id) && (/\.css$/.test(f.path) || f.uncertain)) || old.some(n => changed.includes(n.id) && nodeSpec.parse(n.spec).sourceRefs.some(p => /\.css$/.test(p)));
    const affected = globalChange ? new Set([...old.map(n => n.id), ...scan.files.map(f => f.id)]) : reverseAffected(changed, [...oldEdges, ...nextEdges]);
    const invalidated = [...affected].filter(nodeId => !changed.includes(nodeId));
    if (invalidated.length) await tx.$executeRaw(Prisma.sql`UPDATE "BuildNode" SET "spec" = jsonb_set("spec", '{freshness}', '"stale"'::jsonb), "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN (${Prisma.join(invalidated)})`);
    // Only scanner evidence owns these edges, never delete curated relationships.
    const ownedEdgeIds = oldEdges.filter(e => (e.evidence as { source?: string }).source === "build-static-import").map(e => e.id);
    await tx.buildEdge.deleteMany({ where: { id: { in: ownedEdgeIds } } });
    if (nextEdges.length) await tx.buildEdge.createMany({ data: nextEdges.map(e => ({ ...e, kind: "uses", evidence: { source: "build-static-import", revision: scan.head, coverage: "inferred" } })), skipDuplicates: true });
    return { changed: changed.length, affected: affected.size, head: scan.head };
  });
}
