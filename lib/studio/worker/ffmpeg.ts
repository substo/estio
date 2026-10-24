import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { StudioJobError } from "./handlers";

function run(command: string, args: string[], signal: AbortSignal, maxOutput = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", chunk => { if (out.length < maxOutput) out += chunk; });
    child.stderr.on("data", chunk => { if (err.length < 8192) err += chunk; });
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => reject(new StudioJobError("media_tool_unavailable", "The server could not start its media tools.", true, 600)));
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return reject(new StudioJobError("job_interrupted", "The job was interrupted and will retry.", true));
      // The media input may be unreadable or have no audio track; ffmpeg's text could include the signed URL, so it is not reported.
      code === 0 ? resolve(out) : reject(new StudioJobError("media_unreadable", "The uploaded file could not be read as audio or video.", false));
    });
  });
}

/** Duration and whether the file has an audio track, read over HTTPS from R2. */
export async function probeMedia(url: string, signal: AbortSignal) {
  const json = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", url], signal)) as
    { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  return { durationSeconds: Number(json.format?.duration ?? NaN), hasAudio: Boolean(json.streams?.some(s => s.codec_type === "audio")) };
}

/**
 * Stream the source from R2 and write only small mono 16 kHz Opus chunks
 * (~1.8 MB per 10 minutes), keeping both disk use and each OpenAI request small.
 */
export async function extractAudioChunks(url: string, directory: string, chunkSeconds: number, signal: AbortSignal) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", url, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k",
    "-f", "segment", "-segment_time", String(chunkSeconds), "-reset_timestamps", "1", path.join(directory, "chunk-%05d.ogg")], signal);
  return (await readdir(directory)).filter(name => /^chunk-\d{5}\.ogg$/.test(name)).sort().map(name => path.join(directory, name));
}
