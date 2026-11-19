"use client";
import { createContext, useContext, useMemo, useState } from "react";

export type IdeaProposal = { title: string; summary: string; ai?: boolean };
type Workspace = {
  /** Text the assistant proposes to add to My notes; shown as a change on the left until applied or dismissed. */
  noteProposal: string | null; setNoteProposal: (value: string | null) => void;
  ideaProposal: IdeaProposal | null; setIdeaProposal: (value: IdeaProposal | null) => void;
};
const Context = createContext<Workspace | null>(null);
/** The left side shows what the assistant is working on; the assistant on the right only proposes into it. */
export function SourceWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [noteProposal, setNoteProposal] = useState<string | null>(null);
  const [ideaProposal, setIdeaProposal] = useState<IdeaProposal | null>(null);
  const value = useMemo(() => ({ noteProposal, setNoteProposal, ideaProposal, setIdeaProposal }), [noteProposal, ideaProposal]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSourceWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("SourceWorkspaceProvider is missing");
  return value;
}
