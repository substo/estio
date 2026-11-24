import { snapshotTimeline, timelineField } from "./timeline-snapshot";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { agentEnv, agentSummary, runEditingAgent } from "../video-assembly/agent";
import { buildEditBrief } from "../video-assembly/brief";
import { runNativeProcess, type ProcessRunner } from "./process";
import { latestExport, saveExport, type ExportApi, type ExportLease } from "./video-assemble";
import { projectFolderName, type ProjectStore } from "./video-projects";

const editPayload = z.object({
  recordId: z.string().uuid(), instruction: z.string().trim().min(1).max(1000), title: z.string().max(200).default("video"),
  history: z.array(z.object({ instruction: z.string().max(300), reply: z.string().max(300).default("") }).passthrough()).max(6).default([]),
}).passthrough();
const openPayload = z.object({ recordId: z.string().uuid() }).passthrough();
const missing = () => new StudioJobError("project_missing", "This Mac no longer has the project for this piece. Make the video again to start a new one.", false);

export interface VideoLoopDeps {
  enabled: () => boolean; tools: (signal: AbortSignal) => Promise<{ ready: boolean; missing: string[] }>;
  projects: ProjectStore; editorDocs: string; model?: string; run?: ProcessRunner;
}
async function gate(deps: VideoLoopDeps, signal: AbortSignal) {
  if (!deps.enabled()) throw new StudioJobError("local_policy", "Turn on Mac processing in Setup and keep it On.", true, 300);
  const tools = await deps.tools(signal);
  if (!tools.ready) throw new StudioJobError("video_assembly_tools_missing", `This Mac is missing ${tools.missing.join(", ")}. Install it, then try again.`, true, 600);
}

/** One owner request against the kept project: the restricted agent edits it, it is exported again and saved as the next version. The project path comes from this Mac's own state, never from the job. */
export function createVideoEditHandler(deps: VideoLoopDeps & { api: ExportApi }): StudioJobHandler {
  return async (job, context) => {
    const parsed = editPayload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This edit request is invalid.", false);
    const p = parsed.data;
    await gate(deps, context.signal);
    const project = await deps.projects.get(p.recordId);
    if (!project) throw missing();
    const lease: ExportLease = { jobId: job.id, workerId: context.workerId, leaseToken: job.lease_token };
    const startedAt = Date.now();
    let output: string;
    try {
      output = await runEditingAgent({ cwd: project.dir, editorDocs: deps.editorDocs, model: deps.model, run: deps.run, signal: context.signal,
        brief: buildEditBrief({ editorDocs: deps.editorDocs, projectFile: project.file, instruction: p.instruction, history: p.history, orientation: /\bportrait|vertical|9:16\b/i.test(p.instruction) ? "portrait" : "landscape" }) });
    } catch (error) {
      if (context.signal.aborted) throw error;
      throw new StudioJobError("video_edit_failed", "The Mac could not finish this change. It was not retried.", false);
    }
    const exported = await latestExport(project.dir, startedAt);
    // No new export means the agent could not (or chose not to) change anything: its own words are the answer, not a failure.
    if (!exported) return { assembly: { summary: agentSummary(output) || "Nothing was changed.", projectKept: true, projectName: projectFolderName(p.title, p.recordId) } };
    const uploadId = await saveExport(deps.api, lease, exported, context.signal);
    await deps.projects.set(p.recordId, { dir: project.dir, file: project.file }).catch(() => {});
    const timeline = await snapshotTimeline(project.file, project.dir, deps.run, context.signal);
    return { assembly: { exportName: exported.name.slice(0, 200), bytes: exported.size, uploadId, exportSaved: true, ...timelineField(timeline), projectKept: true, projectName: projectFolderName(p.title, p.recordId), summary: agentSummary(output) } };
  };
}

/** Open the kept project in Substo Video. Fixed argv; the path is looked up here, never taken from the job. */
export function createOpenEditorHandler(deps: Pick<VideoLoopDeps, "enabled" | "tools" | "projects" | "run">): StudioJobHandler {
  return async (job, context) => {
    const parsed = openPayload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This request is invalid.", false);
    await gate(deps as VideoLoopDeps, context.signal);
    const project = await deps.projects.get(parsed.data.recordId);
    if (!project) throw missing();
    try {
      await (deps.run ?? runNativeProcess)({ command: "substo", args: ["app", project.file], cwd: project.dir, env: { ...agentEnv(), PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` }, signal: context.signal, timeoutMs: 60_000, maxOutputBytes: 16 * 1024 });
    } catch (error) {
      if (context.signal.aborted) throw error;
      throw new StudioJobError("editor_open_failed", "Substo Video could not be opened on this Mac. Open it from Applications.", false);
    }
    return { editor: { opened: true, projectName: project.dir.split("/").at(-1)!.slice(0, 200) } };
  };
}
