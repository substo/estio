import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { getCreationPage } from "@/lib/studio/creation";
import { agentSessionKey } from "@/lib/studio/agent-policy";
import { agentRouteScope, getAgentConversation } from "@/lib/studio/agent";
import { AgentPage } from "../../../_components/agent-page";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function CreateWithStudio({ params, searchParams }: {
  params: Promise<Record<string, never>>;
  searchParams: Promise<{ draft?: string; source?: string; new?: string }>;
}) {
  const { locationId } = await studioRouteParams(params);
  const { draft, source, new: fresh } = await searchParams;
  if ((draft && (typeof draft !== "string" || !recordLinkId(draft))) || (source && (typeof source !== "string" || !recordLinkId(source))) || (draft && source)) notFound();
  if (source) redirect(`/studio/library/${source}?mode=create&new=1`);
  const data = await getCreationPage(locationId, draft);
  if (!data) notFound();
  if (draft && data.source) redirect(`/studio/library/${data.source.id}?mode=create&draft=${draft}`);
  const conversation = data.record ? await getAgentConversation(locationId, data.record.id) : { turns: [], plan: [] };
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-5 px-4 py-6 sm:px-8 sm:py-9">
    <header className="space-y-3">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 text-sm">
        <Link className="py-2 text-muted-foreground hover:underline" href="/studio/content">Content pipeline</Link>
        {draft && <Link className="py-2 text-muted-foreground hover:underline" href={`/studio/content/${draft}`}>Content record</Link>}
      </nav>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><Sparkles aria-hidden="true" className="size-5 text-primary" /> Create with Studio</h1>
    </header>
    <AgentPage locationId={locationId} recordId={draft ?? null} sessionKey={agentSessionKey(draft, fresh)} newDraftHref={`/studio/content/create?new=${randomUUID().slice(0, 8)}`} record={data.record} turns={conversation.turns} plan={conversation.plan} scope={await agentRouteScope(locationId)} />
  </main>;
}
