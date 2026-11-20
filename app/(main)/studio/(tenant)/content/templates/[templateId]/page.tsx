import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioAccess } from "@/lib/studio/access";
import { studioRouteParams } from "@/lib/studio/route-context";
import { proofFirstScriptTemplate } from "@/lib/studio/script-template-policy";
import { getStudioScriptTemplate } from "@/lib/studio/script-templates";
import { ScriptTemplateBeats } from "../../../../_components/script-template-beats";
import { approveScriptTemplateAction, proposeScriptTemplateAction } from "../actions";
import { ApproveScriptTemplateForm, ScriptTemplateForm } from "../template-form";

export const dynamic = "force-dynamic";
const path = "/studio/content/templates";

export default async function StudioScriptTemplatePage({ params, searchParams }: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ example?: string | string[] }>;
}) {
  const { locationId, templateId } = await studioRouteParams(params);
  const back = <Link className="text-sm text-primary hover:underline" href={path}>Script templates</Link>;

  if (templateId === "new") {
    const [access, state, query] = await Promise.all([getStudioAccess(locationId), auth(), searchParams]);
    if (!access || state.actor) notFound();
    const useExample = query.example === "proof-first";
    const action = proposeScriptTemplateAction.bind(null, locationId, randomUUID(), randomUUID(), 0);
    return <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-3">{back}<h1 className="text-3xl font-semibold">New script template</h1>
        {!useExample ? <Link className="text-sm text-primary hover:underline" href={`${path}/new?example=proof-first`}>Start with the proof-first example</Link> : null}
      </header>
      <ScriptTemplateForm key={useExample ? "example" : "blank"} action={action} initial={useExample ? proofFirstScriptTemplate : undefined} />
    </main>;
  }

  const result = await getStudioScriptTemplate(locationId, templateId);
  if (!result) notFound();
  const [latest, ...history] = result.versions;
  const sourceReview = result.versions.find(version => version.source_review_id)?.source_review_id;
  return <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
    <header className="space-y-3">{back}<h1 className="break-words text-3xl font-semibold">{latest.name}</h1>
      <p className="break-words text-muted-foreground">{latest.purpose}</p>
      <p className="text-sm">{latest.approved_at ? "Approved" : "Draft awaiting approval"} · v{latest.version}</p>
    </header>
    <ScriptTemplateBeats beats={latest.beats} />
    {sourceReview ? <Link className="block text-sm text-primary underline" href={`${path}/from-video/${sourceReview}`}>Review original video extraction and citations</Link> : null}
    {result.canApprove && !latest.approved_at ? <ApproveScriptTemplateForm
      action={approveScriptTemplateAction.bind(null, locationId, templateId, latest.id)} version={latest.version} /> : null}
    {result.canEdit ? <details className="space-y-4 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Propose a new version</summary>
      <ScriptTemplateForm key={latest.id} initial={latest}
        action={proposeScriptTemplateAction.bind(null, locationId, templateId, randomUUID(), latest.version)} />
    </details> : null}
    {history.length ? <section className="space-y-3">
      <h2 className="font-medium">Earlier versions</h2>
      {history.map(version => <details key={version.id} className="space-y-3 rounded-lg border p-4">
        <summary className="cursor-pointer break-words text-sm">v{version.version} · {version.approved_at ? "Approved" : "Superseded draft"} · {version.name}</summary>
        <p className="break-words text-sm text-muted-foreground">{version.purpose}</p>
        <ScriptTemplateBeats beats={version.beats} />
      </details>)}
    </section> : null}
  </main>;
}
