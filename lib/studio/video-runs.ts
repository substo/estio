/** Pure: which run to headline, which to take frames from, and which newer unsuccessful re-run to mention. Earlier saved results are never hidden by a later failure. */
export function pickVideoRuns<T extends { id: string; status: string; frame_count: number }>(history: T[]) {
  const newest = history[0] ?? null;
  const saved = history.filter(h => h.status === "ready" || h.status === "partial");
  const withFrames = saved.find(h => h.frame_count > 0) ?? null;
  const best = saved[0] ?? null;
  const working = newest && (newest.status === "queued" || newest.status === "running");
  const latest = !newest ? null : working || !best || newest.id === best.id ? newest : best;
  const lastAttempt = newest && best && !working && newest.id !== best.id && history.indexOf(newest) < history.indexOf(best) ? newest : null;
  return { latest, lastAttempt, framesFrom: withFrames?.id ?? null };
}
