import { backgroundTalkWhere, freshStarts, startDigest, planKey } from "./talk-policy";
import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { extractPlan, id, jobSpec, profilesSpec, proposalDraft, selectProfile, difficulty, type JobSpec } from "./contract";
import { validateScopeEntry } from "./delivery";
import { addMemory, approveJob, json, mutate, requireCondition, routed, routing } from "./store";
import { extractRemember, memoryHeading, memoryText, type MemoryEntry } from "./memory";
import { ownerDelimiter, talkPrompt, type PlaybookEdits } from "./playbook";
import { archivedPlan, autoArchive, reopenedPlan, type PlanLike, type TalkArchive } from "./conversations";

/**
 * Build conversations. The owner writes on the Build page; the Mac worker relays each turn to one T3 thread and syncs the
 * thread's messages back. The thread is the source of truth, so a conversation continued in T3 shows here too.
 * States: idle (agent replied) · queued (owner message not yet relayed) · thinking (T3 run active) · waiting (T3 asks a
 * question only answerable in T3) · error.
 */
export type TalkMessage = { id: string; role: "owner" | "agent"; text: string; at?: string; sent?: boolean };
export type TalkPlan = { runId: string; items: z.infer<typeof proposalDraft>[]; started: string[]; at: string; archived?: TalkArchive; reopened?: string; approvals?: string[]; executionJobId?: string; historyLimit?: number; historyBaseline?: number; historyMore?: boolean; historyShortened?: boolean };
const maxMessages = 1000, maxText = 20000;
// Talks can't change state while a job transaction holds the global lock, so each talk is locked on its own row.
async function lockTalk(tx: Prisma.TransactionClient, talkId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "BuildTalk" WHERE "id" = ${talkId} FOR UPDATE`;
  requireCondition(rows.length, "Conversation not found");
  return tx.buildTalk.findUniqueOrThrow({ where: { id: talkId } });
}
const messagesOf = (v: unknown) => (Array.isArray(v) ? v : []) as TalkMessage[];
/** Conversation planning reads code and writes nothing; prefer a Hard-level approved model. */
function talkProfile(profiles: unknown, worker: unknown) {
  return selectProfile(profilesSpec.parse(profiles), { taskType: "review", tools: ["git-read"], quality: difficulty.hard, profileId: "auto" } as JobSpec, routing(worker));
}

export const talkOwnerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("talk"), talkId: id.optional(), text: z.string().trim().min(1).max(8000), profileId: id.optional() }).strict(),
  z.object({ action: z.literal("talk-job"), id }).strict(),
  z.object({ action: z.literal("talk-history"), id }).strict(),
  z.object({ action: z.literal("talk-start"), id, runId: z.string().max(200) }).strict(),
  z.object({ action: z.literal("talk-archive"), id }).strict(),
  z.object({ action: z.literal("talk-reopen"), id }).strict(),
]);
export async function talkOwner(input: z.infer<typeof talkOwnerCommand>, actor: string) {
  if (input.action === "talk-job") return mutate(async tx => {
    const job = await tx.buildJob.findUniqueOrThrow({ where: { id: input.id } });
    const checkpoint = job.checkpoint as { t3?: { threadId?: string }; external?: { threadId?: string } } | null;
    const threadId = checkpoint?.t3?.threadId ?? checkpoint?.external?.threadId;
    requireCondition(threadId && /^[a-zA-Z0-9:._-]{1,120}$/.test(threadId), "This task has not opened its execution thread yet");
    const spec = jobSpec.parse(job.spec);
    // A read-only mirror uses the existing relay, never the task dispatcher.
    return tx.buildTalk.upsert({ where: { id: `execution-${job.id}` }, update: { threadId }, create: {
      id: `execution-${job.id}`, title: spec.title, state: "execution", threadId, base: spec.baseRevision,
      messages: json([]), plan: json({ runId: "", items: [], started: [], at: new Date().toISOString(), executionJobId: job.id }),
    } });
  });
  if (input.action === "talk-history") return db.$transaction(async tx => {
    const talk = await lockTalk(tx, input.id);
    requireCondition(talk.state !== "archived", "Reopen this conversation to load more history");
    const plan = talk.plan as TalkPlan | null;
    const limit = Math.min(1000, (plan?.historyLimit ?? 60) + 60);
    return tx.buildTalk.update({ where: { id: talk.id }, data: { plan: json({ runId: "", items: [], started: [], at: new Date().toISOString(), ...plan, historyLimit: limit, historyBaseline: limit }) } });
  });
  if (input.action === "talk") {
    const message: TalkMessage = { id: `o-${Date.now().toString(36)}`, role: "owner", text: input.text, at: new Date().toISOString(), sent: false };
    if (!input.talkId) {
      const control = await db.buildControl.findUnique({ where: { id: "build" } });
      // The owner may pick an allowed model for a new conversation; otherwise Build chooses (Hard level, most allowance left).
      const chosen = input.profileId && control ? profilesSpec.parse(control.profiles).find(p => p.id === input.profileId && p.enabled && p.taskTypes.includes("review")) : undefined;
      requireCondition(!input.profileId || chosen, "That model is no longer allowed");
      const profile = chosen ?? (control && talkProfile(control.profiles, control.worker));
      requireCondition(control && profile, "Allow at least one model first (settings)");
      const head = (control.worker as { head?: string }).head;
      requireCondition(/^[a-f0-9]{40}$/.test(head ?? ""), "The Mac worker has not reported the code yet; wake the Mac and try again");
      return db.buildTalk.create({ data: { title: input.text.split("\n")[0].slice(0, 80), state: "queued", base: head, profile: json(profile), messages: json([message]) } });
    }
    return db.$transaction(async tx => {
      const talk = await lockTalk(tx, input.talkId!);
      requireCondition(!["archived", "execution"].includes(talk.state), "Use task feedback to continue an execution conversation");
      return tx.buildTalk.update({ where: { id: talk.id }, data: { messages: json([...messagesOf(talk.messages), message].slice(-maxMessages)), state: talk.state === "thinking" ? "thinking" : "queued", error: null } });
    });
  }
  // Archiving records when and why on the plan JSON; reopening clears it (see conversations.ts).
  if (input.action === "talk-archive" || input.action === "talk-reopen") return db.$transaction(async tx => {
    const talk = await lockTalk(tx, input.id), plan = talk.plan as PlanLike | null;
    requireCondition(talk.state !== "execution", "Execution conversations stay attached to their task");
    if (input.action === "talk-archive") return tx.buildTalk.update({ where: { id: talk.id }, data: { state: "archived", plan: json(archivedPlan(plan, { at: new Date().toISOString(), by: "owner", reason: "Closed by you." })) } });
    requireCondition(talk.state === "archived", "This conversation is open");
    const reopened = reopenedPlan(plan);
    return tx.buildTalk.update({ where: { id: talk.id }, data: { state: "idle", plan: reopened ? json(reopened) : Prisma.DbNull } });
  });
  // Start = owner approval of the plan's tasks: each becomes an approved Build task with server-decided difficulty and model.
  return mutate(async tx => {
    const talk = await lockTalk(tx, input.id);
    const plan = talk.plan as TalkPlan | null;
    requireCondition(talk.state !== "archived" && talk.state !== "execution" && plan?.items.length && plan.runId === input.runId, "The plan changed or is closed; reload");
    await proposePlan(tx, talk, plan);
    return startPlan(tx, talk, plan, actor);
  });
}

/** Stable proposal identity shared by plan cards and owner approval. */
async function proposePlan(tx: Prisma.TransactionClient, talk: { id: string; title: string; messages: unknown; base?: string | null }, plan: TalkPlan) {
  const control = await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } });
  const head = (control.worker as { head?: string }).head;
  requireCondition(/^[a-f0-9]{40}$/.test(head ?? ""), "The Mac worker has not reported the code yet");
  const nodes = await tx.buildNode.findMany({ select: { id: true, spec: true } });
  const about = /^About "([^"\n]+)" \(feature\):/.exec(messagesOf(talk.messages).find(m => m.role === "owner")?.text ?? talk.title)?.[1];
  const features = nodes.filter(n => { const s = n.spec as { kind?: string; name?: string }; return s.kind === "feature" && s.name === about; });
  for (const [i, item] of plan.items.entries()) {
    const key = planKey(talk.id, plan.runId, i);
    if (await tx.buildJob.findUnique({ where: { key } })) continue;
    item.scope.forEach(validateScopeEntry);
    const nodeIds = nodes.filter(n => { const s = n.spec as { kind?: string; sourceRefs?: string[] }; return (s.kind === "resource" || s.kind === "page") && s.sourceRefs?.some(path => item.scope.some(scope => scope.endsWith("/") ? path.startsWith(scope) : path === scope)); }).map(n => n.id);
    if (features.length === 1) nodeIds.unshift(features[0].id);
    const spec = await routed(tx, control, jobSpec.parse({ ...item, reason: `From your conversation "${talk.title}": ${item.reason}`.slice(0, 4000), nodeIds: [...new Set(nodeIds)].slice(0, 30), baseRevision: talk.base ?? head,
      endpoint: "review", taskType: "implementation", profileId: "auto", quality: difficulty.routine, tools: ["git-read", "code-write"], owner: "estio-build" }));
    await tx.buildJob.upsert({ where: { key }, create: { key, spec: json(spec), checkpoint: json({ talkId: talk.id }) }, update: {} });
  }
}
async function startPlan(tx: Prisma.TransactionClient, talk: { id: string }, plan: TalkPlan, actor: string) {
  const control = await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } });
  const started = [...plan.started];
  for (const [i] of plan.items.entries()) {
    const key = planKey(talk.id, plan.runId, i);
    const job = await tx.buildJob.findUniqueOrThrow({ where: { key } });
    if (job.state === "proposed") await approveJob(tx, control, job, actor);
    if (job.state !== "revoked" && !started.includes(key)) started.push(key);
  }
  if (control.paused) await tx.buildControl.update({ where: { id: "build" }, data: { paused: false } });
  return tx.buildTalk.update({ where: { id: talk.id }, data: { plan: json({ ...plan, started }) } });
}

/**
 * Open conversations, after archiving those whose started work is all finished (autoArchive). Runs when the Build page
 * loads, so it needs no schedule; it is idempotent and only touches conversations that qualify.
 */
export async function talks() {
  const open = await db.buildTalk.findMany({ where: { state: { notIn: ["archived", "execution"] } }, orderBy: { updatedAt: "desc" }, take: 20 });
  const keys = open.flatMap(t => (t.plan as PlanLike | null)?.started ?? []);
  const jobs = keys.length ? await db.buildJob.findMany({ where: { key: { in: keys } }, select: { id: true, key: true, state: true, checkpoint: true } }) : [];
  const settled = new Set<string>();
  for (const t of open) {
    const archived = autoArchive({ state: t.state, plan: t.plan as PlanLike | null }, jobs);
    if (!archived) continue;
    // Only if nothing changed since it was read (a new message or plan wins).
    const r = await db.buildTalk.updateMany({ where: { id: t.id, updatedAt: t.updatedAt, state: t.state }, data: { state: "archived", plan: json(archivedPlan(t.plan as PlanLike, archived)) } });
    if (r.count) settled.add(t.id);
  }
  return open.filter(t => !settled.has(t.id));
}
/** Archived conversations, newest first, without their transcripts (fetched one at a time with talk()). */
export async function pastTalks() {
  return db.buildTalk.findMany({ where: { state: "archived" }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, state: true, threadId: true, plan: true, updatedAt: true } });
}
export async function talk(id: string) {
  return db.buildTalk.findUniqueOrThrow({ where: { id } });
}

const threadMessage = z.object({ role: z.string().max(40), text: z.string().max(maxText), runId: z.string().max(200).optional() });
export const talkWorkerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("talk-poll"), workerId: id }).strict(),
  z.object({ action: z.literal("talk-sent"), workerId: id, id, threadId: z.string().regex(/^[a-zA-Z0-9:._-]{1,120}$/), messageIds: z.array(z.string().max(40)).max(50) }).strict(),
  z.object({ action: z.literal("talk-sync"), workerId: id, id, messages: z.array(threadMessage).max(maxMessages), running: z.boolean(), needsAnswer: z.boolean(), error: z.string().max(500).optional(), base: z.string().regex(/^[a-f0-9]{40}$/).optional(), historyLimit: z.number().int().min(1).max(1000).optional(), historyMore: z.boolean().optional(), historyShortened: z.boolean().optional() }).strict(),
]);
export async function talkWorker(input: z.infer<typeof talkWorkerCommand>) {
  if (input.action === "talk-poll") {
    const [active, background] = await Promise.all([
      db.buildTalk.findMany({ where: { state: { in: ["queued", "thinking"] } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 5 }),
      db.buildTalk.findMany({ where: { OR: [backgroundTalkWhere, { state: "execution", threadId: { not: null } }] }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 5 }),
    ]);
    const open = [...active, ...background];
    const meta = open.length ? (await db.buildControl.findUnique({ where: { id: "build" } }))?.worker as { playbook?: PlaybookEdits; memory?: MemoryEntry[] } | undefined : undefined;
    const memory = memoryText(meta?.memory, 4000);
    return { talks: open.map(t => ({ id: t.id, title: t.title, threadId: t.threadId, base: t.base, profile: t.profile, playbook: talkPrompt(meta?.playbook, memory ? `${memoryHeading}\n${memory}` : ""), delimiter: ownerDelimiter, messageLimit: (t.plan as TalkPlan | null)?.historyLimit ?? 60,
      unsent: (t.state === "execution" ? [] : messagesOf(t.messages)).filter(m => m.role === "owner" && m.sent === false).map(m => ({ id: m.id, text: m.text })) })) };
  }
  return mutate(async tx => {
    const talk = await lockTalk(tx, input.id);
    if (talk.state === "archived") return talk;
    if (talk.state === "execution") {
      requireCondition(input.action === "talk-sync", "Execution mirrors cannot dispatch messages");
      const messages = input.messages.filter(m => m.role === "user" || m.role === "assistant").map((m, i) => ({ id: `t-${i}-${m.runId ?? ""}`, role: m.role === "user" ? "owner" : "agent", text: m.text }));
      return tx.buildTalk.update({ where: { id: talk.id }, data: {
        ...(!input.error ? { messages: json(messages), plan: json({ ...(talk.plan as object), historyMore: input.historyMore, historyShortened: input.historyShortened }) } : {}), error: input.error ?? null,
      } });
    }
    // Decisions the agent marked to remember go into product memory once its run has finished.
    if (input.action === "talk-sync" && !input.running) {
      const last = [...input.messages].reverse().find(m => m.role === "assistant");
      const notes = last ? extractRemember(last.text) : [];
      if (notes.length) await addMemory(tx, notes.map(text => ({ kind: "decision" as const, text })));
    }

    if (input.action === "talk-sent") {
      requireCondition(!talk.threadId || talk.threadId === input.threadId, "Conversation is bound to another thread");
      const messages = messagesOf(talk.messages).map(m => input.messageIds.includes(m.id) ? { ...m, sent: true } : m);
      return tx.buildTalk.update({ where: { id: talk.id }, data: { threadId: input.threadId, messages: json(messages), state: "thinking" } });
    }
    // The thread is the record: rebuild from it, keep page messages not yet relayed, and pick up the latest plan.
    const unsent = messagesOf(talk.messages).filter(m => m.role === "owner" && m.sent === false);
    const fromThread: TalkMessage[] = input.messages.map((m, i) => ({ id: `t-${i}-${m.runId ?? ""}`.slice(0, 120), role: m.role === "user" ? "owner" as const : "agent" as const,
      text: (m.role === "user" && m.text.includes(ownerDelimiter) ? m.text.split(ownerDelimiter).at(-1)! : m.text).trim() })).filter(m => m.text);
    let plan = talk.plan as TalkPlan | null;
    const last = [...input.messages].reverse().find(m => m.role === "assistant");
    if (!input.running && last?.runId && plan?.runId !== last.runId) {
      const found = extractPlan(last.text);
      if (found.found && found.items.length) {
        if (plan) await tx.buildJob.updateMany({ where: { key: { in: plan.items.map((_, i) => planKey(talk.id, plan!.runId, i)) }, state: "proposed" }, data: { state: "revoked" } });
        plan = { runId: last.runId, items: found.items, started: [], at: new Date().toISOString(), historyLimit: plan?.historyLimit, historyBaseline: plan?.historyBaseline };
      }
    }
    if (plan?.items.length) {
      await proposePlan(tx, { ...talk, base: input.base ?? talk.base }, plan);
      const jobs = await tx.buildJob.findMany({ where: { key: { in: plan.items.map((_, i) => planKey(talk.id, plan!.runId, i)) }, state: { notIn: ["proposed", "revoked"] } }, select: { key: true } });
      plan = { ...plan, started: [...new Set([...plan.started, ...jobs.map(j => j.key)])] };
    }
    // Only a new, provenance-bearing user message following the already saved plan may approve it.
    // A plan discovered in this snapshot is deliberately ineligible (no retroactive Start).
    const previous = talk.plan as TalkPlan | null;
    if (plan && !plan.historyBaseline && previous?.runId === plan.runId) {
      for (const m of freshStarts(talk.threadId, plan, input.messages, plan.approvals ?? [])) {
        const provenance = startDigest(talk.threadId, m);
        plan = { ...plan, approvals: [...(plan.approvals ?? []), provenance] };
        const result = await startPlan(tx, talk, plan, `t3:${provenance}`);
        plan = result.plan as TalkPlan;
      }
    }
    // Baseline every observed message, including historical Starts before this plan was saved.
    if (plan) plan = { ...plan, approvals: [...new Set([...(plan.approvals ?? []), ...input.messages.filter(m => m.role === "user").map(m => startDigest(talk.threadId, m))])].slice(-2000) };

    if (plan?.historyBaseline && (input.historyLimit ?? 0) >= plan.historyBaseline) plan = { ...plan, historyBaseline: undefined };
    if (!input.error && (plan || input.historyMore || input.historyShortened)) plan = { runId: "", items: [], started: [], at: new Date().toISOString(), ...plan, historyMore: input.historyMore, historyShortened: input.historyShortened };
    const state = input.error ? "error" : input.needsAnswer ? "waiting" : input.running ? "thinking" : unsent.length ? "queued" : "idle";
    // An error report carries no messages; keep the transcript as it was.
    const messages = input.error && !input.messages.length ? messagesOf(talk.messages) : [...fromThread, ...unsent];
    return tx.buildTalk.update({ where: { id: talk.id }, data: { base: input.base ?? talk.base, messages: json(messages.slice(-maxMessages)), plan: plan ? json(plan) : Prisma.DbNull, state, error: input.error ?? null } });
  });
}
