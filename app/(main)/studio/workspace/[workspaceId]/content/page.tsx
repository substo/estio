import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { listStudioContent } from "@/lib/studio/content";
import { CONTENT_STAGES, contentStageForDisplay, contentStageLabel, filterContentSummaries, readContentFilters } from "@/lib/studio/content-policy";
import { ContentRecordForm } from "../../../_components/content-record-form";

export const dynamic = "force-dynamic";

export default async function StudioContentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ archived?: string | string[]; q?: string | string[]; stage?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const filters = readContentFilters(query);
  const { search, showArchived, stage: selectedStage } = filters;
  const result = await listStudioContent(workspaceId, showArchived);
  if (!result) notFound();
  const records = filterContentSummaries(result.records, filters);
  const stages = selectedStage === "all" ? [...CONTENT_STAGES, "unclassified"] as const : [selectedStage];
  const root = `/studio/workspace/${workspaceId}`;
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <header className="space-y-2"><nav className="flex flex-wrap gap-4 text-sm"><Link href={root} className="text-muted-foreground hover:underline">{result.access.workspace.name}</Link><Link href={`${root}/library`} className="text-muted-foreground hover:underline">Research library</Link></nav><h1 className="text-3xl font-semibold tracking-tight">Content pipeline</h1><p className="text-muted-foreground">Develop ideas, write scripts, and move each piece through production to review.</p></header>
      <Link href={`${root}/content/idea-reviews`} className="inline-block text-sm text-primary hover:underline">Review saved ideas with workspace AI</Link>
      <Link href={`${root}/content/script-briefs`} className="ml-4 inline-block text-sm text-primary hover:underline">Recent script briefs</Link>
      <form key={JSON.stringify(filters)} method="get" className="flex flex-wrap items-end gap-4 rounded-lg border p-4" aria-label="Content pipeline filters">
        <label className="flex-1 text-sm font-medium">Search titles and summaries<input type="search" name="q" defaultValue={search} maxLength={200} className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
        <label className="text-sm font-medium">Stage<select name="stage" defaultValue={selectedStage} className="mt-1 block rounded-md border bg-background px-3 py-2">
          <option value="all">All stages</option>{[...CONTENT_STAGES, "unclassified" as const].map(stage => <option key={stage} value={stage}>{contentStageLabel(stage)}</option>)}
        </select></label>
        <label className="flex items-center gap-2 py-2 text-sm"><input name="archived" value="1" type="checkbox" defaultChecked={showArchived} />Include archived</label>
        <button className="rounded-md border px-4 py-2 text-sm" type="submit">Apply filters</button>
        <Link href={`${root}/content`} className="py-2 text-sm text-muted-foreground hover:underline">Reset filters</Link>
      </form>
      <p className="text-sm text-muted-foreground">{records.length} {records.length === 1 ? "piece" : "pieces"}{showArchived ? ", including archived work" : " in progress"}{selectedStage !== "all" ? ` · ${contentStageLabel(selectedStage)}` : ""}</p>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stages.map((stage) => {
          const items = records.filter((record) => contentStageForDisplay(record.stage) === stage);
          if (selectedStage === "all" && stage === "unclassified" && !items.length) return null;
          return <section key={stage} className="space-y-3 rounded-xl border bg-muted/20 p-4" aria-label={`${stage} stage`}>
            <h2 className="flex items-center justify-between font-medium"><span>{contentStageLabel(stage)}</span><span className="text-sm text-muted-foreground">{items.length}</span></h2>
            {items.map((record) => <article key={record.id} className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="font-medium"><Link href={`${root}/content/${record.id}`} className="hover:underline">{record.title}</Link></h3>
              {record.summary ? <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.summary}</p> : null}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{record.level ? <span>{record.level}</span> : null}{record.pillar ? <span>Pillar {record.pillar}</span> : null}<span>{record.approved ? "Approved" : "Needs review"}</span>{record.archived ? <span>Archived</span> : null}</div>
            </article>)}
            {!items.length ? <p className="text-sm text-muted-foreground">No content matches these filters.</p> : null}
          </section>;
        })}
      </div>
      <details open={result.records.length === 0} className="max-w-4xl space-y-4"><summary className="cursor-pointer text-xl font-medium">Add an idea or content piece</summary><ContentRecordForm workspaceId={workspaceId} recordId={randomUUID()} version={0} /></details>
    </main>
  );
}
