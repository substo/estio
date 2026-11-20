"use client";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import type { FindingSelection } from "@/lib/studio/knowledge-outline";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type IdeaProposal = { title: string; summary: string; ai?: boolean; draftReviewId?: string; limitations?: string[]; evidence?: Array<{ href: string; label: string; quote: string }> };
export const DRAFT_FROM_FINDINGS_EVENT = "studio:draft-from-findings";
type Workspace = {
  /** Text the assistant proposes to add to My notes; shown as a change on the left until applied or dismissed. */
  noteProposal: string | null; setNoteProposal: (value: string | null) => void;
  provider: StudioTextProvider; setProvider: (value: StudioTextProvider) => void;
  creating: boolean; setCreating: (value: boolean) => void;
  creationControls: HTMLDivElement | null; setCreationControls: (node: HTMLDivElement | null) => void;
  ideaProposal: IdeaProposal | null; setIdeaProposal: (value: IdeaProposal | null) => void;
  findingSelection: FindingSelection | null; setFindingSelection: (value: FindingSelection | null) => void;
};
const Context = createContext<Workspace | null>(null);
/** The left side shows what the assistant is working on; the assistant on the right only proposes into it. */
export function SourceWorkspaceProvider({ children, startInCreation = false, draftId }: { children: React.ReactNode; startInCreation?: boolean; draftId?: string }) {
  const [provider, setProvider] = useState<StudioTextProvider>("subscription");
  const [creating, setCreating] = useState(startInCreation);
  useEffect(() => { setCreating(startInCreation); }, [startInCreation, draftId]);
  const [creationControls, setCreationControls] = useState<HTMLDivElement | null>(null);
  const [noteProposal, setNoteProposal] = useState<string | null>(null);
  const [ideaProposal, setIdeaProposal] = useState<IdeaProposal | null>(null);
  const [findingSelection, setFindingSelection] = useState<FindingSelection | null>(null);
  const value = useMemo(() => ({ provider, setProvider, creating, setCreating, creationControls, setCreationControls, noteProposal, setNoteProposal, ideaProposal, setIdeaProposal, findingSelection, setFindingSelection }), [provider, creating, creationControls, noteProposal, ideaProposal, findingSelection]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOptionalSourceWorkspace() { return useContext(Context); }
export function useSourceWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("SourceWorkspaceProvider is missing");
  return value;
}

/** Keep source panels mounted so changing mode keeps the current tab and edits. */
export function SourceWorkArea({ research, creation }: { research: React.ReactNode; creation: React.ReactNode }) {
  const { creating } = useSourceWorkspace();
  return <div className="min-w-0">
    <div hidden={creating && Boolean(creation)}>{research}</div>
    {creation && <div hidden={!creating}>{creation}</div>}
  </div>;
}
