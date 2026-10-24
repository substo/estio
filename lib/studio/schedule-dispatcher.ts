import { queryPath } from "./rest-client";
import { authorizeEstioSchedule, type ScheduleRest } from "./schedule-authority";
export interface DueSchedule {
  workspace_id: string; schedule_id: string; actor_brand: "estio" | "substo";
  authorized_by: string; activation_token: string; next_run_at: string;
}
/** Bounded sweeps rely on transactional SQL fences, including concurrent hosts. */
export async function dispatchDueStudioSchedules(deps: { rest: ScheduleRest; authorizeEstio?: (candidate: DueSchedule) => Promise<boolean>; now?: Date }) {
  const candidates = await deps.rest<DueSchedule[]>(queryPath("studio_schedule_recurring", {
    select: "workspace_id,schedule_id,actor_brand,authorized_by,activation_token,next_run_at", enabled: "eq.true",
    next_run_at: `lte.${(deps.now ?? new Date()).toISOString()}`, order: "next_run_at.asc,workspace_id.asc,schedule_id.asc", limit: "25" }));
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + 45_000;
  let examined = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    examined++;
    try {
      const authorized = candidate.actor_brand === "substo" || await (deps.authorizeEstio
        ? deps.authorizeEstio(candidate) : authorizeEstioSchedule(deps.rest, candidate.workspace_id, candidate.authorized_by));
      const result = await deps.rest<{ outcome: string }>("rpc/studio_dispatch_schedule", { method: "POST", body: JSON.stringify({
        p_workspace_id: candidate.workspace_id, p_schedule_id: candidate.schedule_id, p_activation_token: candidate.activation_token,
        p_due_at: candidate.next_run_at, p_estio_authorized: authorized }) });
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    } catch {
      // An authority/storage outage is not proof of revocation. Leave due and
      // let the next sweep retry; a lost committed response is fenced by SQL.
      outcomes.unconfirmed = (outcomes.unconfirmed ?? 0) + 1;
    }
  }
  return { examined, outcomes };
}
