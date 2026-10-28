"use server";
import { revalidatePath } from "next/cache";
import { enqueueStudioWorkerCheck, studioJobAction } from "@/lib/studio/jobs";
import { StudioRestError } from "@/lib/studio/rest";

type State = { error?: string; saved?: string };

export async function jobAction(locationId: string, jobId: string, action: "retry" | "cancel", _previous: State): Promise<State> {
  try { await studioJobAction(locationId, jobId, action); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { error: "This job already changed. Reload to see its current state." };
    return { error: "Could not update this job. Check your access and try again." };
  }
  revalidatePath(`/studio/jobs`);
  return { saved: action === "retry" ? "Queued again." : "Cancelled." };
}

export async function workerCheckAction(locationId: string, _previous: State): Promise<State> {
  try { await enqueueStudioWorkerCheck(locationId); }
  catch { return { error: "Could not queue a worker check. Try again." }; }
  revalidatePath(`/studio/jobs`);
  return { saved: "Worker check queued. It should finish within a few seconds if the worker is online." };
}
