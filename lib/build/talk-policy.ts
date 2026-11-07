import { extractPlan, proposalDraft } from "./contract";
import { createHash } from "node:crypto";
export const backgroundTalkWhere = { state: { in: ["idle", "waiting"] }, threadId: { not: null } };
export type ThreadMessage = { role: string; text: string; runId?: string };
export const startDigest = (thread: string | null, m: ThreadMessage) => createHash("sha256").update(JSON.stringify([thread, m.runId, m.text])).digest("hex");
export function freshStarts(thread: string | null, plan: { runId: string; items: unknown[] }, messages: ThreadMessage[], seen: string[]) {
  // Parse saved JSON too: PostgreSQL JSONB may reorder object keys.
  const savedItems = plan.items.flatMap(item => { const parsed = proposalDraft.safeParse(item); return parsed.success ? [parsed.data] : []; });
  if (savedItems.length !== plan.items.length || !savedItems.length) return [];
  let preceding: { runId?: string; items: unknown[] } | null = null;
  return messages.filter(m => {
    if (m.role === "assistant") {
      const found = extractPlan(m.text);
      if (found.items.length) preceding = { runId: m.runId, items: found.items };
    }
    return !!(thread && preceding?.runId === plan.runId && JSON.stringify(preceding.items) === JSON.stringify(savedItems)
      && m.role === "user" && m.runId && /^(?:Start|Start it)$/i.test(m.text.trim()) && !seen.includes(startDigest(thread, m)));
  });
}

export const planKey = (talkId: string, runId: string, i: number) => `talk-${talkId}-${createHash("sha256").update(runId).digest("hex").slice(0, 8)}-${i}`;
