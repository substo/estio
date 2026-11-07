/**
 * Conversations and the work they start, client-safe (no imports). A conversation's Start creates one Build task per
 * plan item with the key `talk-<conversation id>-<plan hash>-<item>` (see talk.ts), which links work back to its
 * conversation; `checkpoint.talkId` says the same. Archive state lives on the plan JSON (`plan.archived`), so no
 * new column: a conversation without a plan gets an empty one to carry it.
 */
export type TalkArchive = { at: string; by: "owner" | "auto"; reason: string };
export type PlanLike = { runId: string; items: unknown[]; started: string[]; at: string; archived?: TalkArchive; reopened?: string };
type JobLike = { id: string; key: string; state: string; checkpoint: unknown };

const keyPattern = /^talk-(.+)-[0-9a-f]{8}-\d+$/;
/** The conversation a task came from, or null. */
export function talkIdOfJob(job: Pick<JobLike, "key" | "checkpoint">): string | null {
  const fromCheckpoint = (job.checkpoint as { talkId?: unknown } | null)?.talkId;
  return typeof fromCheckpoint === "string" ? fromCheckpoint : keyPattern.exec(job.key)?.[1] ?? null;
}
/** Tasks a conversation started, in plan order (only those present in the list). */
export function jobsOfTalk<J extends JobLike>(talk: { id: string; plan: PlanLike | null }, jobs: J[]): J[] {
  const started = talk.plan?.started ?? [];
  const byKey = new Map(jobs.map(j => [j.key, j]));
  const listed = started.map(k => byKey.get(k)).filter((j): j is J => !!j);
  return [...listed, ...jobs.filter(j => !started.includes(j.key) && talkIdOfJob(j) === talk.id)];
}

const finished = (j: JobLike) => {
  const merge = (j.checkpoint as { merge?: { state?: string } } | null)?.merge?.state;
  return ["done", "external-done", "revoked"].includes(j.state) && !["queued", "merging", "resolving"].includes(merge ?? "");
};
/**
 * A conversation archives itself when its whole plan was started and every task it started is finished: done (accepted
 * or merged) or dropped, with at least one done and no merge in flight. Not while the agent is replying or asking, and
 * not again after the owner reopened it, until a new plan is started.
 */
export function autoArchive(talk: { state: string; plan: PlanLike | null }, jobs: JobLike[], now = new Date()): TalkArchive | null {
  const plan = talk.plan;
  if (talk.state === "archived" || ["queued", "thinking", "waiting"].includes(talk.state)) return null;
  if (!plan || !plan.items.length || plan.started.length < plan.items.length || plan.reopened) return null;
  const work = plan.started.map(k => jobs.find(j => j.key === k));
  if (work.some(j => !j) || !work.every(j => finished(j!)) || !work.some(j => j!.state !== "revoked")) return null;
  const done = work.filter(j => j!.state !== "revoked").length;
  return { at: now.toISOString(), by: "auto", reason: done === 1 && work.length === 1 ? "Its task is done." : `All ${done} tasks it started are done.` };
}
/** The plan JSON with an archive record (an empty plan when there was none). */
export function archivedPlan(plan: PlanLike | null, archived: TalkArchive): PlanLike {
  const { reopened: _reopened, ...rest } = plan ?? { runId: "", items: [], started: [], at: archived.at };
  return { ...rest, archived };
}
/** Reopening clears the archive and stops auto-archiving until a new plan is started. */
export function reopenedPlan(plan: PlanLike | null, now = new Date()): PlanLike | null {
  if (!plan) return null;
  const { archived: _archived, ...rest } = plan;
  return { ...rest, reopened: now.toISOString() };
}
/** Plain words for where a conversation stands. */
export function talkWords(talk: { state: string; plan: PlanLike | null; error?: string | null }) {
  if (talk.state === "archived") return talk.plan?.archived ? `Archived: ${talk.plan.archived.by === "auto" ? talk.plan.archived.reason : "you closed it."}` : "Archived.";
  if (talk.state === "queued") return "Sending to the Mac…";
  if (talk.state === "thinking") return "Thinking…";
  if (talk.state === "waiting") return "Asking you something in T3.";
  if (talk.state === "error") return talk.error ?? "Something went wrong.";
  const plan = talk.plan;
  if (plan?.items.length && plan.started.length < plan.items.length) return "Plan ready to start.";
  if (plan?.items.length) return "Work started.";
  return "Your turn.";
}
