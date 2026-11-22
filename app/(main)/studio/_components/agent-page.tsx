"use client";
import { useState } from "react";
import type { AgentTurnView } from "@/lib/studio/agent";
import type { CreationRecord } from "@/lib/studio/creation-policy";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { AgentChat } from "./agent-chat";
import { AgentDraftProvider, DraftPanel } from "./agent-workspace";

/** Blank or existing draft outside a source page: the same conversation, with the draft beside it. */
export function AgentPage({ locationId, recordId, record, turns, plan, scope, sessionKey, newDraftHref }: { locationId: string; recordId: string | null; sessionKey: string; newDraftHref: string; record: CreationRecord | null; turns: AgentTurnView[]; plan: string[]; scope: string }) {
  const [provider, setProvider] = useState<StudioTextProvider>("location_order");
  return <AgentDraftProvider recordId={recordId} sessionKey={sessionKey} initialRecord={record} initialPlan={plan}>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <aside aria-label="Creation assistant" className="order-first flex max-h-[85dvh] min-h-[28rem] flex-col rounded-xl border bg-card text-sm lg:sticky lg:top-4 lg:order-last lg:max-h-[calc(100dvh-2rem)]">
        <header className="border-b px-4 py-3"><h2 className="font-semibold">Assistant</h2><p className="text-xs text-muted-foreground">Describe what you want to make.</p></header>
        <AgentChat key={sessionKey} locationId={locationId} source={null} initialTurns={turns} provider={provider} onProvider={setProvider} newDraftHref={newDraftHref} scope={scope} />
      </aside>
      <DraftPanel />
    </div>
  </AgentDraftProvider>;
}
