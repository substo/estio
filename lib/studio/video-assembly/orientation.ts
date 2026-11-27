import type { ProcessRunner } from "../companion/process";

export interface VideoShape { width: number; height: number }

/** Read only the display dimensions from ffprobe. Phone footage often stores portrait as a rotated landscape stream. */
export function parseVideoShape(value: string): VideoShape | null {
  try {
    const stream = (JSON.parse(value) as { streams?: Array<{ width?: unknown; height?: unknown; tags?: { rotate?: unknown }; side_data_list?: Array<{ rotation?: unknown }> }> }).streams?.[0];
    let width = Number(stream?.width), height = Number(stream?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const rotation = Number(stream?.side_data_list?.find(x => Number.isFinite(Number(x.rotation)))?.rotation ?? stream?.tags?.rotate ?? 0);
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    return { width, height };
  } catch { return null; }
}

/** Explicit vertical is a brief override. Otherwise use the footage, preferring vertical on a split decision. */
export function chooseOutputOrientation(forcePortrait: boolean, shapes: readonly VideoShape[]): "landscape" | "portrait" {
  if (forcePortrait) return "portrait";
  const portrait = shapes.filter(s => s.height > s.width).length;
  const landscape = shapes.filter(s => s.width >= s.height).length;
  if (!portrait && !landscape) return "landscape";
  return portrait >= landscape ? "portrait" : "landscape";
}

/** Probe only downloaded local files. An unreadable clip is ignored; the old landscape default remains when none can be read. */
export async function probeOutputOrientation(files: readonly string[], forcePortrait: boolean, run: ProcessRunner): Promise<"landscape" | "portrait"> {
  if (forcePortrait) return "portrait";
  const shapes = await Promise.all(files.map(file => run({ command: "ffprobe", args: ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", file], cwd: "/", timeoutMs: 30_000, maxOutputBytes: 16 * 1024,
    env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` } }).then(r => parseVideoShape(r.stdout), () => null)));
  return chooseOutputOrientation(false, shapes.filter((shape): shape is VideoShape => shape !== null));
}
