import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { jobSpec } from "./contract";

/** External work is a ledger observation, never a worker claim or execution grant. */
export const externalCommand = z.object({
  threadId: z.string().uuid(),
  revision: z.number().int().positive().optional(),
  spec: jobSpec.optional(),
  status: z.enum(["working", "blocked", "review", "done", "failed"]),
  note: z.string().trim().min(1).max(6000),
  evidence: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
}).strict().superRefine((v, ctx) => {
  if (!v.revision && !v.spec) ctx.addIssue({ code: "custom", message: "Registration requires scope" });
  if (["review", "done"].includes(v.status) && !v.evidence.length) ctx.addIssue({ code: "custom", message: "Results require evidence" });
});
export type ExternalCommand = z.infer<typeof externalCommand>;
export function externalId(threadId: string) { return `external-t3:${threadId}`; }
export async function trackExternal(tx: Prisma.TransactionClient, input: ExternalCommand) {
  const id = externalId(input.threadId);
  const existing = await tx.buildJob.findUnique({ where: { id } });
  if (existing && (input.revision !== existing.revision || !existing.state.startsWith("external-"))) throw new Error("External tracking revision conflict");
  if (!existing && input.revision) throw new Error("External tracking record missing");
  if (existing && input.spec) throw new Error("Scope is immutable; register separate work for a new scope");
  const at = new Date().toISOString();
  const old = (existing?.checkpoint ?? {}) as { external?: { history?: unknown[] } };
  const checkpoint = { external: { threadId: input.threadId, status: input.status, note: input.note, evidence: input.evidence,
    at, history: [...(old.external?.history ?? []), { at, status: input.status, note: input.note, evidence: input.evidence }].slice(-50) },
    t3: { threadId: input.threadId }, nextStep: input.note };
  const data = { state: `external-${input.status}`, checkpoint: checkpoint as Prisma.InputJsonValue };
  const job = existing
    ? await tx.buildJob.update({ where: { id }, data: { ...data, revision: { increment: 1 } } })
    : await tx.buildJob.create({ data: { id, key: id, ...data, spec: input.spec as Prisma.InputJsonValue } });
  return { id, revision: job.revision, state: job.state, link: `/admin/platform/build#${id}` };
}
