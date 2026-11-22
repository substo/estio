import { createHash } from "node:crypto";

/** One review request id per (turn, round): re-queuing the same round is a no-op, never a second paid call. */
export function agentRoundRequestId(turnId: string, round: number) {
  const hex = createHash("sha256").update(`studio-agent:${turnId}:${round}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
