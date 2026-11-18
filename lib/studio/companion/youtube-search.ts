import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { isSignedInTopbar, macSearchPayloadSchema, macSearchResultSchema, parseYoutubeSearchData, youtubeSearchUrl, type MacSearchResult } from "../youtube-mac-search-policy";

const CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
export function youtubeBrowserProfile(home = homedir(), env: NodeJS.ProcessEnv = process.env) {
  return env.STUDIO_YOUTUBE_PROFILE?.trim() || join(home, "Library", "Application Support", "Estio Studio", "youtube-browser");
}
export async function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => Promise<boolean> = async path => { try { await access(path, constants.X_OK); return true; } catch { return false; } }) {
  for (const path of [env.STUDIO_YOUTUBE_CHROME?.trim(), ...CHROME_PATHS]) if (path && await exists(path)) return path;
  return null;
}
export interface YoutubeBrowser { search(query: string, limit: number, signal: AbortSignal): Promise<MacSearchResult> }
export interface YoutubeSearchReport { ready: boolean; signedIn?: boolean }

/** Runs a read-only YouTube search in the Mac's own Chrome profile (headless, signed in if the user did the one-time sign-in). */
export function createPlaywrightYoutubeBrowser(options: { executablePath: string; profileDir: string }): YoutubeBrowser {
  return {
    async search(query, limit, signal) {
      const { chromium } = await import("playwright");
      const context = await chromium.launchPersistentContext(options.profileDir, { executablePath: options.executablePath, headless: true, viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"], timeout: 30_000 });
      const abort = () => { void context.close().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(youtubeSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (/\/sorry\/|accounts\.google\.com/.test(page.url())) throw new StudioJobError("youtube_blocked", "YouTube asked for a check in the Mac's browser. Open YouTube there, finish it, and search again.", false);
        // The EU consent wall blocks results until a choice is made; rejecting is the least-sharing choice.
        if (/consent\.youtube\.com/.test(page.url())) {
          await page.getByRole("button", { name: /reject all/i }).first().click({ timeout: 8_000 }).catch(() => {});
          await page.waitForURL(/youtube\.com\/results/, { timeout: 15_000 }).catch(() => {});
        }
        await page.waitForFunction(() => Boolean((window as unknown as { ytInitialData?: unknown }).ytInitialData), undefined, { timeout: 20_000 });
        const data = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { ytInitialData?: unknown }).ytInitialData ?? null)));
        const videos = parseYoutubeSearchData(data, limit);
        return { videos, signedIn: isSignedInTopbar(data) };
      } finally { signal.removeEventListener("abort", abort); await context.close().catch(() => {}); }
    },
  };
}

export function createYoutubeSearchHandler(deps: { browser: () => Promise<YoutubeBrowser | null>; enabled: () => boolean }): StudioJobHandler {
  return async (job, context) => {
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for the computer's processing settings.", true, 300);
    const payload = macSearchPayloadSchema.parse(job.payload);
    const browser = await deps.browser();
    if (!browser) throw new StudioJobError("youtube_browser_missing", "Install Google Chrome on this Mac to search YouTube from it.", false);
    try {
      return macSearchResultSchema.parse(await browser.search(payload.query, payload.limit, context.signal));
    } catch (error) {
      if (error instanceof StudioJobError) throw error;
      if (context.signal.aborted) throw new StudioJobError("youtube_search_cancelled", "The Mac stopped before finishing this search.", false);
      throw new StudioJobError("youtube_search_failed", "The Mac could not read YouTube results. Check its internet connection and search again.", false);
    }
  };
}

/** One-time sign-in: opens the Mac's normal Chrome (no automation flags, so Google allows it) on the same profile the searches use. */
export async function openYoutubeLogin(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chrome = await findChrome(env);
  if (!chrome) throw new Error("youtube_browser_missing");
  const profile = youtubeBrowserProfile(home, env);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  spawn(chrome, [`--user-data-dir=${profile}`, "--no-first-run", "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"], { detached: true, stdio: "ignore" }).unref();
  console.log("Chrome opened on the Studio YouTube profile. Sign in to YouTube, then quit Chrome (Cmd+Q) so searches can use the saved sign-in.");
}
