"use client";
import { IdeaDraft } from "./idea-draft";
import { useSourceWorkspace } from "./source-workspace";

export function IdeaPanel({ locationId, sourceId, ideaId, archived }: { locationId: string; sourceId: string; ideaId: string; archived: boolean }) {
  const { ideaProposal, setIdeaProposal } = useSourceWorkspace();
  if (!ideaProposal) return null;
  if (archived) return <p className="text-sm text-muted-foreground">This source is archived, so ideas can't be created from it.</p>;
  return <IdeaDraft key={`${ideaProposal.title}:${ideaProposal.summary}`} locationId={locationId} sourceId={sourceId} ideaId={ideaId} initial={ideaProposal} onCancel={() => setIdeaProposal(null)} />;
}
