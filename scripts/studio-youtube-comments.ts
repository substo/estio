import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { classifyBrowserError, findChrome, youtubeBrowserProfile } from "../lib/studio/companion/youtube-search";
import { collectYoutubeComments } from "../lib/studio/companion/youtube-comments";
import { canonicalYoutubeVideo } from "../lib/studio/video-transcription-policy";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "confirm-permission": { type: "boolean" }, output: { type: "string" }, limit: { type: "string" },
    "keep-order": { type: "boolean" }, "headless": { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("Usage: npx tsx scripts/studio-youtube-comments.ts --confirm-permission --output DIR [--limit ROWS] [--keep-order] [--headless] VIDEO_URL...");
    return;
  }
  const videos = positionals.map(canonicalYoutubeVideo);
  if (!values["confirm-permission"] || !values.output || !videos.length || videos.some(video => !video)) {
    throw new Error("Pass --confirm-permission, an --output directory, and one or more authorized YouTube video URLs.");
  }
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (values.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error("--limit must be a positive whole number.");
  const chrome = await findChrome();
  if (!chrome) throw new Error("Google Chrome was not found. Studio uses the Chrome executable on this Mac.");
  const output = resolve(values.output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const profile = youtubeBrowserProfile();
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome, headless: values.headless ?? false, viewport: { width: 1280, height: 900 },
    timeout: 20_000, handleSIGINT: false,
  }).catch(error => {
    throw new Error(`The Studio Chrome profile could not open (${classifyBrowserError(error)}). Close other windows using that profile and retry.`);
  });
  const page = context.pages()[0] ?? await context.newPage();
  let cancelled = false;
  const interrupt = () => { cancelled = true; void page.close().catch(() => {}); };
  process.once("SIGINT", interrupt);
  try {
    const unique = new Map(videos.flatMap(video => video ? [[video.videoId, video] as const] : []));
    for (const video of unique.values()) {
      if (cancelled) break;
      const path = join(output, `youtube-${video.videoId}.json`);
      try {
        console.error(`${video.videoId}: opening comments`);
        await page.goto(video.url + "&hl=en", { waitUntil: "domcontentloaded", timeout: 25_000 });
        const result = await collectYoutubeComments(page, video.videoId, limit,
          size => console.error(`${video.videoId}: ${size} rows`), !values["keep-order"]);
        if (result.comments.length) {
          await writeFile(path, JSON.stringify({ source: video.url, collected_at: new Date().toISOString(), ...result }, null, 2) + "\n",
            { flag: "wx", mode: 0o600 });
        }
        console.log(`${video.videoId}: ${result.comments.length} rows · ${result.status}${result.reason ? ` · ${result.reason}` : ""}`);
        if (result.status === "interrupted" || result.status === "unavailable") process.exitCode = 1;
      } catch (error) {
        console.error(`${video.videoId}: ${error instanceof Error && "code" in error && error.code === "EEXIST" ? "Output already exists." : `Collection failed (${classifyBrowserError(error)}).`}`);
        process.exitCode = 1;
      }
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    await context.close();
    if (cancelled) process.exitCode = 130;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Could not collect YouTube comments.");
  process.exitCode = 1;
});
