import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { listStudioScriptTemplates } from "@/lib/studio/script-templates";

export const dynamic = "force-dynamic";

export default async function StudioScriptTemplatesPage() {
  const { locationId } = await studioRouteParams(Promise.resolve({}));
  const result = await listStudioScriptTemplates(locationId);
  if (!result) notFound();

  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <header className="space-y-3">
      <Link className="text-sm text-primary hover:underline" href="/studio/content">Content pipeline</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Script templates</h1>
        {result.canEdit ? <Link className="rounded-md border px-3 py-2 text-sm font-medium" href="/studio/content/templates/new">New template</Link> : null}
      </div>
    </header>
    {result.templates.length ? <ul className="space-y-3">
      {result.templates.map(template => <li key={template.template_id} className="space-y-1 rounded-lg border p-4">
        <h2 className="break-words font-medium"><Link className="text-primary hover:underline" href={`/studio/content/templates/${template.template_id}`}>{template.name}</Link></h2>
        <p className="break-words text-sm text-muted-foreground">{template.purpose}</p>
        <p className="text-sm">{template.approved_at ? `Approved · v${template.version}` :
          `Draft · v${template.version}${template.approved_version ? ` · v${template.approved_version} available for scripts` : ""}`}</p>
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">No script templates yet. Approved templates appear in the script editor.</p>}
  </main>;
}
