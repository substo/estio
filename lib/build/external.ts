import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { id, jobSpec } from "./contract";
import { keepStory, makeStory, storyInput, type StoryInput } from "./story";

/** External work is a ledger observation, never a worker claim or execution grant. */
export const externalCommand = z.object({
  threadId: z.string().uuid(),
  // Optional: several pieces of work reported from one T3 thread each get their own record.
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,59}$/).optional(),
  revision: z.number().int().positive().optional(),
  spec: jobSpec.optional(),
  status: z.enum(["working", "blocked", "review", "done", "failed"]),
  note: z.string().trim().min(1).max(6000),
  evidence: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  // Plain-language story shown first on the Progress card; omitted keeps the current one.
  story: storyInput.optional(),
}).strict().superRefine((v, ctx) => {
  if (!v.revision && !v.spec) ctx.addIssue({ code: "custom", message: "Registration requires scope" });
  if (["review", "done"].includes(v.status) && !v.evidence.length) ctx.addIssue({ code: "custom", message: "Results require evidence" });
});
export type ExternalCommand = z.infer<typeof externalCommand>;
export function externalId(threadId: string, key?: string) { return `external-t3:${threadId}${key ? `:${key}` : ""}`; }
export async function trackExternal(tx: Prisma.TransactionClient, input: ExternalCommand) {
  const id = externalId(input.threadId, input.key);
  const existing = await tx.buildJob.findUnique({ where: { id } });
  if (existing && (input.revision !== existing.revision || !existing.state.startsWith("external-"))) throw new Error("External tracking revision conflict");
  if (!existing && input.revision) throw new Error("External tracking record missing");
  if (existing && input.spec) throw new Error("Scope is immutable; register separate work for a new scope");
  const at = new Date().toISOString();
  const old = (existing?.checkpoint ?? {}) as { external?: { history?: unknown[] } };
  const checkpoint = keepStory(old, { ...(input.story ? { story: makeStory(input.story, "worker") } : {}), external: { threadId: input.threadId, status: input.status, note: input.note, evidence: input.evidence,
    at, history: [...(old.external?.history ?? []), { at, status: input.status, note: input.note, evidence: input.evidence }].slice(-50) },
    t3: { threadId: input.threadId }, nextStep: input.note });
  const data = { state: `external-${input.status}`, checkpoint: checkpoint as Prisma.InputJsonValue };
  const job = existing
    ? await tx.buildJob.update({ where: { id }, data: { ...data, revision: { increment: 1 } } })
    : await tx.buildJob.create({ data: { id, key: id, ...data, spec: input.spec as Prisma.InputJsonValue } });
  return { id, revision: job.revision, state: job.state, link: `/admin/platform/build#${id}` };
}

/** Sets or replaces the story of any Build record (external or not). A story is description, not scope: no revision bump. */
export const storyCommand = z.object({ action: z.literal("story"), id, story: storyInput }).strict();
export async function setStory(tx: Prisma.TransactionClient, jobId: string, story: StoryInput, by: "owner" | "worker") {
  const job = await tx.buildJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Build record not found");
  const written = makeStory(story, by);
  await tx.buildJob.update({ where: { id: jobId }, data: { checkpoint: { ...((job.checkpoint ?? {}) as object), story: written } as Prisma.InputJsonValue } });
  return { id: jobId, story: written, link: `/admin/platform/build#${jobId}` };
}
