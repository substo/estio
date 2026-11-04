import { z } from "zod";
import { isAllowedRequestOrigin } from "../auth/request-origin-policy";

const text = z.string().trim().min(1).max(4000);
export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/);
export const nodeSpec = z.object({
  name: text, purpose: text, app: z.enum(["estio", "substo", "both"]),
  // Experience map (see experience.ts): where users meet this record. naming "owner" stops derivation overwriting renames.
  route: z.string().max(400).optional(), section: z.string().max(80).optional(), area: z.string().max(80).optional(), naming: z.enum(["derived", "owner"]).optional(),
  // Watch-list references only: latest = last checked release/commit, seen = what the owner has looked at.
  // Model-drafted description awaiting owner confirmation. Never approved intent until confirmed.
  draft: z.object({ purpose: z.string().max(500), journey: z.string().max(1000), features: z.array(z.object({ name: z.string().max(120), purpose: z.string().max(500), journey: z.string().max(500) }).strict()).max(5), at: z.string().max(40), from: z.string().max(120) }).strict().optional(),
  watch: z.object({ status: z.enum(["watching", "adopted", "rejected"]), url: z.string().url().max(400), checkable: z.boolean(), latest: z.string().max(200).optional(), seen: z.string().max(200).optional(), checkedAt: z.string().max(40).optional(), queued: z.string().max(200).optional() }).strict().optional(),
  product: z.enum(["crm", "studio", "shared"]), kind: z.enum(["page", "feature", "resource", "rule", "reference"]),
  intent: text, observed: text, journey: text, sourceRefs: z.array(text).max(40),
  sourceRevision: text, integratedRevision: text.optional(), deployedRevision: text.optional(),
  freshness: z.enum(["unknown", "stale", "verified"]), evidenceRevision: text.optional(),
  checks: z.array(text).max(30), coverage: z.enum(["unknown", "inferred", "confirmed"]),
}).strict().superRefine((v, ctx) => {
  if (v.freshness === "verified" && (v.evidenceRevision !== v.sourceRevision || !v.checks.length))
    ctx.addIssue({ code: "custom", message: "Verified evidence must match source revision and include checks" });
});
export const edgeSpec = z.object({ fromId: id, toId: id, kind: z.enum(["contains", "uses", "reads", "writes", "governed-by", "verified-by", "inspires"]), evidence: z.object({ source: text, revision: text, coverage: z.enum(["unknown", "inferred", "confirmed", "stale"]) }).strict() }).strict();

// Models come from the T3 catalog the Mac worker reports (see catalogEntry); the server checks enabled profiles against it.
// Effort is not settable through the T3 CLI, so T3-executed threads run at T3's per-model default.
const optionValues: Record<string, (string | boolean)[]> = { reasoningEffort: ["low", "medium", "high", "xhigh", "max", "ultra"], serviceTier: ["default", "priority"], effort: ["low", "medium", "high", "xhigh", "max"], fastMode: [false] };
export const catalogEntry = z.object({ provider: id, model: id, name: z.string().trim().min(1).max(120) }).strict();
export const catalogSpec = z.array(catalogEntry).max(200);
/** quality is the difficulty tier: 2 = Routine, 3 = Hard. */
export const difficulty = { routine: 2, hard: 3 } as const;
export const profileSpec = z.object({
  id, enabled: z.boolean(), provider: id, account: id,
  billing: z.literal("subscription"), model: id, options: z.record(z.union([z.string(), z.boolean()])),
  quotaBucket: id, taskTypes: z.array(z.enum(["inspect", "implementation", "review"])).min(1).max(3),
  tools: z.array(z.enum(["git-read", "code-write", "test"])).min(1).max(3),
  dataScope: z.literal("estio-repository"), quality: z.number().int().min(1).max(3),
  concurrency: z.literal(1), maxAttempts: z.number().int().min(1).max(3),
  fallbacks: z.array(id).max(5),
}).strict().superRefine((v, ctx) => {
  for (const [k, value] of Object.entries(v.options))
    if (!optionValues[k]?.includes(value)) ctx.addIssue({ code: "custom", message: `Unsupported setting ${k}` });
});
export const profilesSpec = z.array(profileSpec).max(20).superRefine((v, ctx) => {
  if (new Set(v.map(p => p.id)).size !== v.length || v.some(p => p.fallbacks.some(f => f === p.id || !v.some(q => q.id === f))))
    ctx.addIssue({ code: "custom", message: "Profiles need unique IDs and existing, distinct fallback IDs" });
});
export const jobSpec = z.object({
  title: text, outcome: text, reason: text, scope: z.array(text).min(1).max(30),
  nodeIds: z.array(id).min(1).max(30), acceptance: z.array(text).min(1).max(20),
  baseRevision: z.string().regex(/^[a-f0-9]{40}$/), endpoint: z.literal("review"),
  taskType: z.enum(["inspect", "implementation", "review"]), profileId: id,
  quality: z.number().int().min(1).max(3), routing: text.optional(), tools: z.array(z.enum(["git-read", "code-write", "test"])).min(1).max(3),
  owner: z.literal("estio-build"),
}).strict();
export type Profile = z.infer<typeof profileSpec>;
export type JobSpec = z.infer<typeof jobSpec>;
// Areas where a wrong change is costly: schema/migrations, auth, API routes, the factory itself, scripts and deploy.
const sensitive = /^(?:prisma\/|lib\/auth|app\/api\/|middleware\.|lib\/build\/|scripts\/|deploy)|\.sql$/;
/**
 * The system, not the owner, decides difficulty: deterministic and zero-token. Hard when an implementation is broad,
 * touches sensitive areas, has many dependents in the product map or many acceptance criteria; large reviews are Hard.
 */
export function assessDifficulty(spec: Pick<JobSpec, "taskType" | "scope" | "acceptance">, dependents: number) {
  if (spec.taskType === "inspect") return { quality: difficulty.routine, routing: "Routine: repository inspection, no model call" };
  const reasons: string[] = [];
  if (spec.scope.length > (spec.taskType === "review" ? 10 : 4)) reasons.push(`${spec.scope.length} files`);
  const hit = spec.scope.find(f => sensitive.test(f));
  if (hit && spec.taskType === "implementation") reasons.push(`touches ${hit}`);
  if (dependents > 20 && spec.taskType === "implementation") reasons.push(`${dependents} dependent links`);
  if (spec.acceptance.length > 5) reasons.push(`${spec.acceptance.length} acceptance criteria`);
  return reasons.length ? { quality: difficulty.hard, routing: `Hard: ${reasons.join(", ")}` } : { quality: difficulty.routine, routing: `Routine: ${spec.scope.length} file${spec.scope.length === 1 ? "" : "s"}, no sensitive area` };
}
/**
 * Picks an enabled approved profile, preferring the job's assessed difficulty and then any other approved level, so work
 * runs whenever something approved can do it. Within a level the proposal's profile goes first, then approved-list order.
 * A capacity fallback needs a confirmed-stopped writer and a different quota bucket than the previous attempt.
 */
export function selectProfile(profiles: Profile[], job: JobSpec, options: { previous?: Profile; stopped?: boolean; exhaustedBuckets?: string[] } = {}) {
  if (options.previous && !options.stopped) return null;
  const ordered = [...profiles.filter(p => p.id === job.profileId), ...profiles.filter(p => p.id !== job.profileId)];
  const eligible = (p: Profile) => p.enabled && p.taskTypes.includes(job.taskType) && job.tools.every(t => p.tools.includes(t)) &&
    !options.exhaustedBuckets?.includes(p.quotaBucket) && (!options.previous || (p.id !== options.previous.id && p.quotaBucket !== options.previous.quotaBucket));
  return ordered.find(p => eligible(p) && p.quality === job.quality) ?? ordered.find(eligible) ?? null;
}
export function canRevoke(state: string) { return ["proposed", "approved", "review", "working", "waiting-for-capacity", "blocked-configuration", "blocked-stale-approval", "failed"].includes(state); }
export function validLease(job: { state: string; leaseToken: string | null; workerId: string | null; leaseUntil: Date | null }, token: string, workerId: string, now: Date) {
  return job.state === "working" && job.leaseToken === token && job.workerId === workerId && !!job.leaseUntil && job.leaseUntil > now;
}
export function sameOrigin(request: Request) {
  return !!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "cross-site" && isAllowedRequestOrigin({ origin: request.headers.get("origin"), requestOrigin: new URL(request.url).origin, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://estio.co", host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") });
}

// Review → proposals. Reviews end with a fenced json block {"proposals":[...]}; drafts are data, never approval.
export const proposalDraft = z.object({
  title: z.string().trim().min(3).max(200), outcome: z.string().trim().min(3).max(2000), reason: z.string().trim().min(3).max(2000),
  scope: z.array(z.string().trim().min(1).max(400)).min(1).max(10), acceptance: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
}).strip();
export type ProposalDraft = z.infer<typeof proposalDraft>;
export const proposalInstruction = 'Finish with a fenced ```json block shaped {"proposals":[{"title","outcome","reason","scope":["repo-relative files to change"],"acceptance":["checkable criteria"]}]} holding 0 to 3 evidence-backed, smallest-change proposals (an empty list if nothing is worth doing). They become unapproved Build cards.';
/** Last fenced json block with a proposals array; invalid items are dropped and counted. */
export function extractProposals(text: string): { proposals: ProposalDraft[]; dropped: number } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const block of blocks.reverse()) {
    try {
      const value = JSON.parse(block[1]) as { proposals?: unknown };
      if (!Array.isArray(value?.proposals)) continue;
      const valid = value.proposals.slice(0, 20).flatMap(p => { const r = proposalDraft.safeParse(p); return r.success ? [r.data] : []; });
      return { proposals: valid.slice(0, 3), dropped: value.proposals.length - Math.min(valid.length, 3) };
    } catch { /* try an earlier block */ }
  }
  return { proposals: [], dropped: 0 };
}

// Policy auto-approval: deterministic and deliberately narrow. Record-only first ("would approve"), widened by the owner.
export const autoApprovePolicy = { maxFiles: 3, maxAcceptance: 5, dailyBudget: 3 } as const;
export type AutoMode = "off" | "record" | "on";
export function autoApprovable(spec: JobSpec): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (spec.taskType !== "implementation") reasons.push("only implementation work is auto-approved");
  if (spec.quality !== difficulty.routine) reasons.push("assessed Hard");
  if (spec.scope.length > autoApprovePolicy.maxFiles) reasons.push(`more than ${autoApprovePolicy.maxFiles} files`);
  const hit = spec.scope.find(f => sensitive.test(f));
  if (hit) reasons.push(`touches ${hit}`);
  if (spec.acceptance.length > autoApprovePolicy.maxAcceptance) reasons.push(`more than ${autoApprovePolicy.maxAcceptance} acceptance criteria`);
  return { ok: !reasons.length, reasons };
}

// Screen description drafts ride along in the same review block as proposals: no extra model turn.
export const screenDraft = z.object({
  purpose: z.string().trim().min(3).max(500), journey: z.string().trim().min(3).max(1000),
  features: z.array(z.object({ name: z.string().trim().min(2).max(120), purpose: z.string().trim().min(3).max(500), journey: z.string().trim().max(500).default("") }).strip()).max(5).default([]),
}).strip();
export const screenInstruction = 'Also put a "screen" object in that same json block: {"purpose":"what this screen is for, in plain user language","journey":"what a user does here, step by step","features":[{"name","purpose","journey"}]} with up to 5 features. Describe the experience, not code.';
export const undescribed = "Source inventory; purpose needs owner curation";
export function extractScreen(text: string) {
  for (const block of [...text.matchAll(/```json\s*([\s\S]*?)```/g)].reverse()) {
    try { const r = screenDraft.safeParse((JSON.parse(block[1]) as { screen?: unknown }).screen); if (r.success) return r.data; } catch { /* earlier block */ }
  }
  return null;
}
