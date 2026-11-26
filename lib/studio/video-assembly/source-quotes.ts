import { join } from "node:path";
import type { ProcessRunner } from "../companion/process";
import type { TimedSourceQuote } from "./script";

export type PreparedSourceQuote = { file: string; beforeBeat: number; seconds: number; credit: string };
export async function prepareSourceQuotes(options: {
  quotes: readonly TimedSourceQuote[]; names?: ReadonlyMap<string, string>; files: ReadonlySet<string>;
  clipsDir: string; projectDir: string; run: ProcessRunner; signal?: AbortSignal; dryRun?: boolean;
}) {
  const quotes: PreparedSourceQuote[] = [];
  const quotedFiles = new Set<string>();
  for (const [index, quote] of options.quotes.entries()) {
    const name = options.names?.get(quote.asset);
    if (!name || !options.files.has(name) || !/\.(?:mp4|mov|m4v|mkv|webm)$/i.test(name)) {
      throw new Error(`The uploaded source clip for “${quote.credit}” is unavailable. Edit the source clip block and choose an uploaded video.`);
    }
    const file = `studio-quote-${quote.asset}-${index + 1}.mp4`;
    if (options.files.has(file)) throw new Error("Rename the upload that conflicts with the reserved source clip filename.");
    const input = join(options.clipsDir, name);
    const env = { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin` };
    const seconds = Number((quote.end - quote.start).toFixed(3));
    if (!options.dryRun) {
      const probe = await options.run({ command: "ffprobe", args: ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input],
        cwd: options.clipsDir, timeoutMs: 30_000, maxOutputBytes: 1024, signal: options.signal, env });
      const duration = Number(probe.stdout.trim());
      if (!Number.isFinite(duration) || quote.end > duration) throw new Error(`The source clip for “${quote.credit}” ends beyond the uploaded video.`);
      // Accurate seek and re-encode so the cut is independent of keyframe positions. Preserve the original audio when present.
      await options.run({ command: "ffmpeg", args: ["-nostdin", "-v", "error", "-y", "-ss", String(quote.start), "-i", input, "-t", String(seconds),
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(options.projectDir, file)],
        cwd: options.projectDir, timeoutMs: 180_000, maxOutputBytes: 8192, signal: options.signal, env });
    }
    quotedFiles.add(name);
    quotes.push({ file, beforeBeat: quote.beforeBeat, seconds, credit: quote.credit });
  }
  return { quotes, quotedFiles };
}
