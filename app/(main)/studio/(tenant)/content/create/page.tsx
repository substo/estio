import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { CREATION_STAGES } from "@/lib/studio/creation-policy";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { getCreationPage } from "@/lib/studio/creation";
import { getStudioScriptTemplateChoices } from "@/lib/studio/script-templates";
import { CreationWorkspace } from "../../../_components/creation-workspace";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function CreateWithStudio({ params, searchParams }: {
  params: Promise<Record<string, never>>;
  searchParams: Promise<{ draft?: string; source?: string; stage?: string }>;
}) {
  const { locationId } = await studioRouteParams(params);
  const { draft, source, stage } = await searchParams;
  const initialStage = CREATION_STAGES.find(item => item.toLowerCase() === stage);
  if ((draft && (typeof draft !== "string" || !recordLinkId(draft))) || (source && (typeof source !== "string" || !recordLinkId(source))) || (draft && source)) notFound();
  const data = await getCreationPage(locationId, draft, source);
  if (!data) notFound();
  const { options } = await getStudioScriptTemplateChoices(locationId, data.record?.templateId);
  return <main className="mx-auto w-full min-w-0 max-w-5xl space-y-5 px-4 py-6 sm:px-8 sm:py-9">
    <header className="space-y-3">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 text-sm">
        <Link className="py-2 text-muted-foreground hover:underline" href="/studio/content">Content pipeline</Link>
        {draft && <Link className="py-2 text-muted-foreground hover:underline" href={`/studio/content/${draft}`}>Content record</Link>}
      </nav>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><Sparkles aria-hidden="true" className="size-5 text-primary" /> Create with Studio</h1>
    </header>
    <CreationWorkspace key={draft ?? source ?? "new"} recordId={draft ?? randomUUID()} initial={data.record} initialStage={initialStage} source={data.source} publisher={data.publisher}
      templates={options.map(({ id, name, version }) => ({ id, name, version }))} history={data.runs} />
  </main>;
}
