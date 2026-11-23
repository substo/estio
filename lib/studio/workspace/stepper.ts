import type { NarrationView, VideoAssemblyView } from "../video-assembly-policy";
export type StepState = "done" | "active" | "pending" | "failed";
export interface Step { key: "narration" | "queued" | "editing" | "saved"; label: string; state: StepState; detail: string | null }
/** One honest progress line for the player: what is happening, from the narration run and the job's own status. */
export function jobStepper(input: { narration: NarrationView | null; assembly: VideoAssemblyView | null }): Step[] | null {
  const n = input.narration, a = input.assembly;
  const narrating = n?.status === "running";
  const recent = (iso: string | undefined) => !iso || Date.now() - new Date(iso).getTime() < 6 * 3600_000;
  if (!narrating && !(a && (a.status === "queued" || a.status === "running" || (a.status === "failed" && recent(a.createdAt)))) && n?.status !== "failed") return null;
  const steps: Step[] = [];
  if (n && recent(n.createdAt)) steps.push({ key: "narration", label: "Narration", state: n.status === "done" ? "done" : n.status === "failed" ? "failed" : "active", detail: n.status === "running" ? `${n.done} of ${n.total} voiced` : n.status === "failed" ? n.message : null });
  const failed = a?.status === "failed" || n?.status === "failed";
  const queued = !a || a.status === "queued", running = a?.status === "running";
  steps.push({ key: "queued", label: "Queued on your Mac", state: narrating || (!a && n?.status !== "failed") ? "pending" : queued ? "active" : "done", detail: null });
  steps.push({ key: "editing", label: "Editing", state: running ? "active" : a?.status === "succeeded" ? "done" : failed && a ? "failed" : "pending", detail: failed && a ? a.message : null });
  steps.push({ key: "saved", label: "Saved here", state: a?.status === "succeeded" ? "done" : "pending", detail: null });
  return steps;
}
