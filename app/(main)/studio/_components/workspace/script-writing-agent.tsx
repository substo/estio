"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { X } from "lucide-react";
import type { AgentTurnView } from "@/lib/studio/agent";
import { agentSessionKey, type AgentSelection } from "@/lib/studio/agent-policy";
import type { CreationRecord, CreationStage } from "@/lib/studio/creation-policy";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { AgentChat } from "../agent-chat";
import { AgentDraftProvider, WritingAudiencePanel, useAgentDraft } from "../agent-workspace";

export type WritingAgentData = { record: CreationRecord; turns: AgentTurnView[]; plan: string[]; target: number | null; scope: string };
const desktopQuery = "(min-width: 1024px)";
function subscribeDesktop(change: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
const isDesktop = () => window.matchMedia(desktopQuery).matches;

/** Keep one chat mounted through sheet close, tab changes and resize so an in-flight turn or typed message survives. */
/** Sends one prepared message into the chat each time `nonce` changes (the Storyboard step's "Plan the shots"). Inside the provider, so it reaches the same send as the box. */
function StarterBridge({ starter }: { starter?: { message: string; nonce: number } | null }) {
  const { sendRef } = useAgentDraft();
  const sent = useRef(0);
  useEffect(() => { if (starter && starter.nonce !== sent.current) { sent.current = starter.nonce; requestAnimationFrame(() => sendRef.current?.(starter.message)); } }, [starter, sendRef]);
  return null;
}

export function ScriptWritingAgent({ locationId, data, active, open, onOpenChange, focus, returnFocus, startApply, endApply, onApplied, clearFocus, onSent, starter }: {
  starter?: { message: string; nonce: number } | null;
  locationId: string;
  data: WritingAgentData;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focus: { selection: AgentSelection; label: string } | null;
  returnFocus: RefObject<HTMLElement | null>;
  startApply: () => boolean;
  endApply: () => void;
  onApplied: (record: CreationRecord, stage: CreationStage) => void;
  clearFocus: () => void;
  onSent: () => void;
}) {
  const [showAudience, setShowAudience] = useState(false);
  const [provider, setProvider] = useState<StudioTextProvider>("location_order");
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const panel = useRef<HTMLDialogElement>(null);
  const audienceToggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = `studio-script-agent-${data.record.id}`;
  const sessionKey = agentSessionKey(data.record.id, null);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;

    if (desktop || !active || !open) {
      if (dialog.matches(":modal")) {
        dialog.close();
        if (active && !desktop) {
          const trigger = returnFocus.current;
          (trigger?.isConnected ? trigger : document.getElementById(`studio-script-agent-trigger-${data.record.id}`))?.focus();
        }
      }
      if (active && desktop) dialog.setAttribute("open", "");
      else dialog.removeAttribute("open");
      return;
    }

    if (!dialog.matches(":modal")) {
      dialog.removeAttribute("open");
      dialog.showModal();
      heading.current?.focus();
    }
  }, [active, data.record.id, desktop, open, returnFocus]);

  useEffect(() => {
    if (!active || !open || !focus) return;
    setShowAudience(false);
    if (desktop) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-assistant-field]:enabled")?.focus());
  }, [active, desktop, open, focus]);

  function backToWriting(focusMessage: boolean) {
    setShowAudience(false);
    requestAnimationFrame(() => {
      if (focusMessage) panel.current?.querySelector<HTMLElement>("[data-assistant-field]:enabled")?.focus();
      else audienceToggle.current?.focus();
    });
  }

  return (
    <dialog ref={panel} role={desktop ? "complementary" : undefined} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onOpenChange(false); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none flex-col gap-0 overflow-y-auto rounded-t-xl border bg-card p-0 pb-[env(safe-area-inset-bottom)] text-card-foreground shadow-lg backdrop:bg-black/50 open:flex lg:sticky lg:inset-auto lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:pb-0 lg:shadow-none">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 ref={heading} tabIndex={-1} id={titleId} className="font-semibold">Writing agent</h2>
        <div className="flex items-center gap-1">
          <button ref={audienceToggle} type="button" aria-expanded={showAudience} aria-controls={`${titleId}-audience`}
            onClick={() => { if (showAudience) backToWriting(false); else setShowAudience(true); }}
            className="min-h-11 rounded-md px-2 text-xs font-medium text-primary hover:bg-accent focus-visible:outline focus-visible:outline-2">
            {showAudience ? "Back to writing" : "Audience language"}
          </button>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close writing agent"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-2 lg:hidden"><X aria-hidden className="size-4" /></button>
        </div>
      </header>
      <AgentDraftProvider recordId={data.record.id} sessionKey={sessionKey} initialRecord={data.record} initialPlan={data.plan} initialTarget={data.target}>
        <StarterBridge starter={starter} />
        <div className={showAudience ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          <AgentChat locationId={locationId} source={null} initialTurns={data.turns} provider={provider} onProvider={setProvider} scope={data.scope}
            focus={focus} scriptEditor={{ startApply, endApply, onApplied, clearFocus, onSent }} />
        </div>
        <div id={`${titleId}-audience`} hidden={!showAudience} className="min-h-0 flex-1 overflow-y-auto">
          <WritingAudiencePanel startSave={startApply} endSave={endApply} onSaved={onSent} onPrepared={() => backToWriting(true)} />
        </div>
      </AgentDraftProvider>
    </dialog>
  );
}
