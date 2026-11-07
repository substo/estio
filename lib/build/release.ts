/**
 * What is live: the production release manifest written by the owned deploy (scripts/deploy-server-guard.py,
 * current-release.json: revision + publish time). Client-safe. A merged task counts as deployed when the live revision
 * is its merge commit or was published after it was merged: every deploy ships the then-current release branch tip,
 * which already contains earlier merges. Without a manifest nothing is claimed either way.
 */
export type Release = { revision: string; at: string };
export function releaseFrom(value: unknown): Release | null {
  const v = value as { revision?: unknown; at?: unknown } | null;
  return v && typeof v.revision === "string" && /^[0-9a-f]{40}$/.test(v.revision) && typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? { revision: v.revision, at: v.at } : null;
}
export function deployed(merge: { sha?: string; at: string }, release: Release | null | undefined): boolean | null {
  if (!release) return null;
  return merge.sha === release.revision || Date.parse(release.at) > Date.parse(merge.at);
}
/** Plain words for a merge. "Not deployed" only when the live release is known and doesn't contain it. */
export function mergeWords(merge: { state: string; at: string; sha?: string; reason?: string }, release: Release | null | undefined) {
  if (merge.state === "merged") { const live = deployed(merge, release); return live === true ? "Merged and deployed" : live === false ? "Merged, not deployed yet" : "Merged"; }
  return merge.state === "resolving" ? "Merging: an agent is resolving conflicts" : merge.state === "failed" ? `Merge failed: ${merge.reason ?? "unknown"}` : "Merging…";
}
