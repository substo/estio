import { createHash } from "node:crypto";
import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { extractPlan, id, jobSpec, profilesSpec, proposalDraft, selectProfile, difficulty, type JobSpec } from "./contract";
import { validateDeliveryPath } from "./delivery";
import { approveJob, json, mutate, requireCondition, routed } from "./store";
import { ownerDelimiter, talkPrompt, type PlaybookEdits } from "./playbook";

/**
 * Build conversations. The owner writes on the Build page; the Mac worker relays each turn to one T3 thread and syncs the
 * thread's messages back. The thread is the source of truth, so a conversation continued in T3 shows here too.
 * States: idle (agent replied) · queued (owner message not yet relayed) · thinking (T3 run active) · waiting (T3 asks a
 * question only answerable in T3) · error.
 */
export type TalkMessage = { id: string; role: "owner" | "agent"; text: string; at?: string; sent?: boolean };
export type TalkPlan = { runId: string; items: z.infer<typeof proposalDraft>[]; started: string[]; at: string };
const maxMessages = 80, maxText = 20000;
// Talks can't change state while a job transaction holds the global lock, so each talk is locked on its own row.
async function lockTalk(tx: Prisma.TransactionClient, talkId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "BuildTalk" WHERE "id" = ${talkId} FOR UPDATE`;
  requireCondition(rows.length, "Conversation not found");
  return tx.buildTalk.findUniqueOrThrow({ where: { id: talkId } });
}
const messagesOf = (v: unknown) => (Array.isArray(v) ? v : []) as TalkMessage[];
/** Conversation planning reads code and writes nothing; prefer a Hard-level approved model. */
function talkProfile(profiles: unknown, worker: unknown) {
  return selectProfile(profilesSpec.parse(profiles), { taskType: "review", tools: ["git-read"], quality: difficulty.hard, profileId: "auto" } as JobSpec,
    { exhaustedBuckets: Object.keys((worker as { quotaBuckets?: object }).quotaBuckets ?? {}) });
}

export const talkOwnerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("talk"), talkId: id.optional(), text: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ action: z.literal("talk-start"), id, runId: z.string().max(200) }).strict(),
  z.object({ action: z.literal("talk-archive"), id }).strict(),
]);
export async function talkOwner(input: z.infer<typeof talkOwnerCommand>, actor: string) {
  if (input.action === "talk") {
    const message: TalkMessage = { id: `o-${Date.now().toString(36)}`, role: "owner", text: input.text, at: new Date().toISOString(), sent: false };
    if (!input.talkId) {
      const control = await db.buildControl.findUnique({ where: { id: "build" } });
      const profile = control && talkProfile(control.profiles, control.worker);
      requireCondition(profile, "Allow at least one model first (settings)");
      const head = (control.worker as { head?: string }).head;
      requireCondition(/^[a-f0-9]{40}$/.test(head ?? ""), "The Mac worker has not reported the code yet; wake the Mac and try again");
      return db.buildTalk.create({ data: { title: input.text.split("\n")[0].slice(0, 80), state: "queued", base: head, profile: json(profile), messages: json([message]) } });
    }
    return db.$transaction(async tx => {
      const talk = await lockTalk(tx, input.talkId!);
      requireCondition(talk.state !== "archived", "This conversation is archived");
      return tx.buildTalk.update({ where: { id: talk.id }, data: { messages: json([...messagesOf(talk.messages), message].slice(-maxMessages)), state: talk.state === "thinking" ? "thinking" : "queued", error: null } });
    });
  }
  if (input.action === "talk-archive") return db.buildTalk.update({ where: { id: input.id }, data: { state: "archived" } });
  // Start = owner approval of the plan's tasks: each becomes an approved Build task with server-decided difficulty and model.
  return mutate(async tx => {
    const talk = await lockTalk(tx, input.id);
    const plan = talk.plan as TalkPlan | null;
    requireCondition(plan && plan.runId === input.runId, "The plan changed; reload");
    const control = await tx.buildControl.findUniqueOrThrow({ where: { id: "build" } });
    const head = (control.worker as { head?: string }).head;
    requireCondition(/^[a-f0-9]{40}$/.test(head ?? ""), "The Mac worker has not reported the code yet");
    const started = [...plan.started];
    for (const [i, item] of plan.items.entries()) {
      const key = `talk-${talk.id}-${createHash("sha256").update(plan.runId).digest("hex").slice(0, 8)}-${i}`;
      if (started.includes(key)) continue;
      item.scope.forEach(f => validateDeliveryPath(f));
      // Tie the task to mapped files it changes; new files have no map record yet.
      const fileIds = item.scope.map(p => `file-${createHash("sha256").update(p).digest("hex").slice(0, 24)}`);
      const nodeIds = (await tx.buildNode.findMany({ where: { id: { in: fileIds } }, select: { id: true } })).map(n => n.id);
      const spec = await routed(tx, control, jobSpec.parse({ ...item, reason: `From your conversation "${talk.title}": ${item.reason}`.slice(0, 4000), nodeIds, baseRevision: head,
        endpoint: "review", taskType: "implementation", profileId: "auto", quality: difficulty.routine, tools: ["git-read", "code-write"], owner: "estio-build" }));
      const job = await tx.buildJob.upsert({ where: { key }, create: { key, spec: json(spec), checkpoint: json({ talkId: talk.id }) }, update: {} });
      if (job.state === "proposed") await approveJob(tx, control, job, actor);
      started.push(key);
    }
    // Starting work is an explicit owner decision, so it also resumes a paused queue.
    if (control.paused) await tx.buildControl.update({ where: { id: "build" }, data: { paused: false } });
    return tx.buildTalk.update({ where: { id: talk.id }, data: { plan: json({ ...plan, started }) } });
  });
}

export async function talks() {
  return db.buildTalk.findMany({ where: { state: { not: "archived" } }, orderBy: { updatedAt: "desc" }, take: 20 });
}

const threadMessage = z.object({ role: z.string().max(40), text: z.string().max(maxText), runId: z.string().max(200).optional() });
export const talkWorkerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("talk-poll"), workerId: id }).strict(),
  z.object({ action: z.literal("talk-sent"), workerId: id, id, threadId: z.string().regex(/^[a-zA-Z0-9:._-]{1,120}$/), messageIds: z.array(z.string().max(40)).max(50) }).strict(),
  z.object({ action: z.literal("talk-sync"), workerId: id, id, messages: z.array(threadMessage).max(maxMessages), running: z.boolean(), needsAnswer: z.boolean(), error: z.string().max(500).optional() }).strict(),
]);
export async function talkWorker(input: z.infer<typeof talkWorkerCommand>) {
  if (input.action === "talk-poll") {
    const open = await db.buildTalk.findMany({ where: { state: { in: ["queued", "thinking"] } }, orderBy: { updatedAt: "asc" }, take: 10 });
    const edits = open.length ? ((await db.buildControl.findUnique({ where: { id: "build" } }))?.worker as { playbook?: PlaybookEdits } | undefined)?.playbook : undefined;
    return { talks: open.map(t => ({ id: t.id, title: t.title, threadId: t.threadId, base: t.base, profile: t.profile, playbook: talkPrompt(edits), delimiter: ownerDelimiter,
      unsent: messagesOf(t.messages).filter(m => m.role === "owner" && m.sent === false).map(m => ({ id: m.id, text: m.text })) })) };
  }
  return db.$transaction(async tx => {
    const talk = await lockTalk(tx, input.id);
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
      if (found.found && found.items.length) plan = { runId: last.runId, items: found.items, started: [], at: new Date().toISOString() };
    }
    const state = input.error ? "error" : input.needsAnswer ? "waiting" : input.running ? "thinking" : unsent.length ? "queued" : "idle";
    // An error report carries no messages; keep the transcript as it was.
    const messages = input.error && !input.messages.length ? messagesOf(talk.messages) : [...fromThread, ...unsent];
    return tx.buildTalk.update({ where: { id: talk.id }, data: { messages: json(messages.slice(-maxMessages)), plan: plan ? json(plan) : Prisma.DbNull, state, error: input.error ?? null } });
  });
}
