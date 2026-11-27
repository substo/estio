import { open, rm, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { StudioJobError } from "../worker/handlers";
import { CompanionProcessError, nativeLoginEnvironment, runNativeProcess, type ProcessRunner } from "./process";

/**
 * Draws one storyboard frame with the Codex CLI's built-in image tool (gpt-image), on this Mac, with the owner's own ChatGPT login.
 * It is included in their ChatGPT subscription (each picture uses about 38,000 tokens of its Codex allowance), so nothing is billed
 * to a pay-as-you-go account and no API key is involved. The creator's photo is attached as the reference so the same person
 * appears in the new scene. Anything that goes wrong returns false: the caller keeps the plain placeholder.
 */
export type FrameDrawer = (request: { prompt: string; references: string[]; out: string; signal?: AbortSignal; /** Replaces the default opening sentence (frames edit one photo; sheets are built from several). */ intro?: string }) => Promise<boolean>;

const MAX_BYTES = 12 * 1024 * 1024, MIN_BYTES = 8 * 1024;
/** A real picture: PNG or JPEG magic bytes and a plausible size. */
async function looksLikeImage(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info || info.size < MIN_BYTES || info.size > MAX_BYTES) return false;
  const handle = await open(file, "r");
  try { const head = Buffer.alloc(4); await handle.read(head, 0, 4, 0); return (head[0] === 0x89 && head.toString("latin1", 1, 4) === "PNG") || (head[0] === 0xff && head[1] === 0xd8); }
  finally { await handle.close(); }
}

export function createCodexFrameDrawer(deps: { run?: ProcessRunner; command?: string; timeoutMs?: number } = {}): FrameDrawer {
  const run = deps.run ?? runNativeProcess, command = deps.command ?? "codex";
  return async ({ prompt, references, out, signal, intro }) => {
    const cwd = dirname(out), name = basename(out);
    await rm(out, { force: true });
    const text = `${intro ?? "Use $imagegen to edit the attached reference photo into one new image."} ${prompt} Save the final image as ./${name} in the current directory. Print only the file name.`;
    // "--" ends the attachment list so the prompt is not read as another image file.
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral", "-C", cwd, ...references.flatMap(r => ["-i", r]), "--", text];
    try {
      await run({ subscriptionGeneration: "codex", command, args, cwd, env: nativeLoginEnvironment(), signal, timeoutMs: deps.timeoutMs ?? 5 * 60_000, maxOutputBytes: 256 * 1024 });
    } catch (error) {
      if (signal?.aborted) throw error;
      // The subscription's own limit is the one failure worth naming: retrying cannot help until it resets.
      if (error instanceof CompanionProcessError && /usage limit/i.test(error.stderr)) throw new StudioJobError("agent_rate_limited", "Your ChatGPT subscription hit its usage limit, so no pictures could be drawn. Try again after it resets.", false);
      return false;
    }
    if (await looksLikeImage(out)) return true;
    await rm(out, { force: true });
    return false;
  };
}
