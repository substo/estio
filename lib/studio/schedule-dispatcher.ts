import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { authorizeEstioSchedule, type ScheduleRest } from "./schedule-authority";
export interface DueSchedule {
  location_id: string; schedule_id: string; actor_app: "estio" | "substo";
  authorized_by: string; activation_token: string; next_run_at: string;
}
/** Bounded sweeps rely on transactional SQL fences, including concurrent hosts. */
export async function dispatchDueStudioSchedules(deps: { db: StudioDb; authorizeEstio?: (candidate: DueSchedule) => Promise<boolean>; now?: Date }) {
  const candidates = await deps.db.rows<DueSchedule>(Prisma.sql`select location_id,schedule_id,actor_app,authorized_by,activation_token,next_run_at from studio.studio_schedule_recurring t where enabled = ${true} and next_run_at <= ${(deps.now ?? new Date()).toISOString()}::timestamptz order by next_run_at asc,location_id asc,schedule_id asc limit 25`);
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + 45_000;
  let examined = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    examined++;
    try {
      const authorized = candidate.actor_app === "substo" || await (deps.authorizeEstio
        ? deps.authorizeEstio(candidate) : authorizeEstioSchedule(deps.db, candidate.location_id, candidate.authorized_by));
      const result = await deps.db.call<{ outcome: string }>("studio_dispatch_schedule", {
        p_location_id: candidate.location_id, p_schedule_id: candidate.schedule_id, p_activation_token: candidate.activation_token,
        p_due_at: candidate.next_run_at, p_estio_authorized: authorized });
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    } catch {
      // An authority/storage outage is not proof of revocation. Leave due and
      // let the next sweep retry; a lost committed response is fenced by SQL.
      outcomes.unconfirmed = (outcomes.unconfirmed ?? 0) + 1;
    }
  }
  return { examined, outcomes };
}
