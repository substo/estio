import { createHash } from "node:crypto";
/**
 * Watch list: external inspiration (repos, apps, videos, features) linked to the screens it could improve. GitHub
 * repositories are checked daily for new releases/commits with plain API calls (no model). Other links are one-off.
 */
export type WatchKind = { name: string; area: "GitHub" | "Video" | "Web"; github?: { owner: string; repo: string } };
export function describeUrl(raw: string): WatchKind {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Use an https link");
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "github.com" && parts.length >= 2 && /^[\w.-]+$/.test(parts[0]) && /^[\w.-]+$/.test(parts[1]))
    return { name: `${parts[0]}/${parts[1].replace(/\.git$/, "")}`, area: "GitHub", github: { owner: parts[0], repo: parts[1].replace(/\.git$/, "") } };
  if (host === "youtu.be" || host.endsWith("youtube.com")) return { name: `YouTube video ${url.searchParams.get("v") ?? parts.at(-1) ?? ""}`.trim(), area: "Video" };
  return { name: `${host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 120), area: "Web" };
}
/** Stable record id per link; query strings such as share tokens are ignored, except YouTube's video id. */
export function watchId(raw: string) {
  const url = new URL(raw);
  const v = url.searchParams.get("v");
  const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${v ? `?v=${v}` : ""}`.toLowerCase();
  return `ref-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}


/** Latest release and commit of a public GitHub repository. Plain API calls: no model, no credentials. */
export async function checkGithub(url: string, fetcher: typeof fetch = fetch) {
  const gh = describeUrl(url).github;
  if (!gh) return { summary: "Not a GitHub repository; not checked" };
  const get = async (p: string) => { const r = await fetcher(`https://api.github.com/repos/${gh.owner}/${gh.repo}${p}`, { headers: { accept: "application/vnd.github+json", "user-agent": "estio-build-worker" }, redirect: "follow", signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`GitHub HTTP ${r.status}`)); };
  try {
    const [release, commits] = await Promise.all([get("/releases/latest"), get("/commits?per_page=1")]);
    const commit = Array.isArray(commits) ? commits[0] : null;
    const tag = typeof release?.tag_name === "string" ? release.tag_name.slice(0, 60) : "";
    const sha = typeof commit?.sha === "string" ? commit.sha.slice(0, 12) : "";
    if (!sha) return { summary: "Check returned no commits" };
    const message = String(commit.commit?.message ?? "").split("\n")[0].slice(0, 160);
    const date = String(commit.commit?.committer?.date ?? "").slice(0, 10);
    return { latest: `${tag ? `${tag}@` : ""}${sha}`, summary: `${tag ? `Latest release ${tag}. ` : ""}Latest commit ${sha} (${date}): ${message}` };
  } catch (e) { return { summary: `Check failed: ${e instanceof Error ? e.message : "unknown error"}; retried tomorrow` }; }
}
