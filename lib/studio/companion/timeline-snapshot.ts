import { tmpdir } from "node:os";
import { runNativeProcess, type ProcessRunner } from "./process";
import { reduceTimeline, type TimelineSnapshot } from "../workspace/timeline";

/** The deployed server must have migration 20261201130000_studio_workspace_timeline before it accepts `timeline` in a job result.
 * Flip to true once that release is live (same switch pattern as SERVER_HAS_PROJECT_FIELDS in video-assemble.ts). */
export const SERVER_HAS_TIMELINE_FIELD = true;

/** A bounded picture of the kept project's timeline, read from the editor's own CLI. Null on any problem: a missing picture must never fail a finished video. */
export async function snapshotTimeline(projectFile: string, cwd: string, run: ProcessRunner = runNativeProcess, signal?: AbortSignal): Promise<TimelineSnapshot | null> {
  try {
    const { stdout } = await run({ command: "substo", args: ["timeline", "--json", "--project", projectFile], cwd, signal, timeoutMs: 60_000, maxOutputBytes: 8 * 1024 * 1024,
      env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? tmpdir(), PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` } });
    return reduceTimeline((JSON.parse(stdout) as { project?: unknown }).project);
  } catch { return null; }
}
/** The result fragment, present only when the server accepts it and a picture exists. */
export const timelineField = (snapshot: TimelineSnapshot | null) => SERVER_HAS_TIMELINE_FIELD && snapshot ? { timeline: snapshot } : {};
