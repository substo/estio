/**
 * Delay before the next poll: `minMs` while work is found, doubling for each empty
 * (or failed) poll up to `maxMs`. Half of each delay is random ("equal jitter") so
 * many pollers never line up.
 */
export function pollDelay(streak: number, minMs: number, maxMs: number, random: () => number = Math.random): number {
  const ceiling = Math.min(maxMs, minMs * 2 ** Math.min(Math.max(streak, 0), 20));
  return Math.round(ceiling / 2 + random() * ceiling / 2);
}
