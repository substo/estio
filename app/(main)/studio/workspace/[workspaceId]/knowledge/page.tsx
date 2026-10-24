import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioKnowledge } from "@/lib/studio/knowledge";
import { knowledgePage, knowledgeStatus, knowledgeTopic, type KnowledgeStatus } from "@/lib/studio/knowledge-policy";

export const dynamic = "force-dynamic";

export default async function StudioKnowledgePage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ status?: string | string[]; topic?: string | string[]; page?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const status = knowledgeStatus(query.status);
  const topicId = knowledgeTopic(query.topic);
  const page = knowledgePage(query.page);
  const result = await listStudioKnowledge(workspaceId, status, topicId, page);
  if (!result) notFound();
  const root = `/studio/workspace/${workspaceId}`;
  const href = (nextStatus: KnowledgeStatus, nextPage: number, nextTopic = topicId) => {
    const search = new URLSearchParams({ status: nextStatus, page: String(nextPage) });
    if (nextTopic) search.set("topic", nextTopic);
    return `${root}/knowledge?${search}`;
  };
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <nav className="flex flex-wrap gap-4 text-sm"><Link href={root} className="text-muted-foreground hover:underline">{result.access.workspace.name}</Link><Link href={`${root}/library`} className="text-muted-foreground hover:underline">Research library</Link><Link href={`${root}/content`} className="text-muted-foreground hover:underline">Content pipeline</Link></nav>
        <h1 className="text-3xl font-semibold tracking-tight">Knowledge</h1>
        <p className="text-muted-foreground">Read source findings alongside their citations and imported review decisions.</p>
      </header>
      <Link href={`${root}/knowledge/extractions`} className="block text-sm text-primary hover:underline">Review hosted knowledge extractions</Link>
      <nav aria-label="Knowledge status" className="flex flex-wrap gap-2">
        {([ ["pending", "Needs review"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All findings"] ] as const).map(([value, label]) =>
          <Link key={value} href={href(value, 0)} aria-current={status === value ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${status === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</Link>)}
      </nav>
      {topicId ? <p className="text-sm">Filtered to a topic. <Link href={href(status, 0, null)} className="text-primary hover:underline">Clear topic filter</Link></p> : null}
      <section className="grid gap-4" aria-label="Knowledge findings">
        {result.insights.map((insight) => {
          const topicName = insight.topic_id ? result.topicNames.get(insight.topic_id) : null;
          return <article key={insight.id} className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>{insight.status}</span><span>{insight.kind?.replaceAll("_", " ") || "Finding"}</span><span>Source: {result.sourceNames.get(insight.source_id) || insight.source_id}</span></div>
            <h2 className="font-medium whitespace-pre-wrap"><Link href={`${root}/knowledge/${insight.id}`} className="hover:underline">{insight.statement}</Link></h2>
            {insight.topic_id ? <Link href={href(status, 0, insight.topic_id)} className="text-sm text-primary hover:underline">Topic: {topicName || insight.suggested_topic || insight.topic_id}</Link> : insight.suggested_topic ? <p className="text-sm text-muted-foreground">Suggested topic: {insight.suggested_topic}</p> : null}
          </article>;
        })}
        {!result.insights.length ? <p className="text-sm text-muted-foreground">No findings on this page.</p> : null}
      </section>
      <nav className="flex gap-5 text-sm" aria-label="Knowledge pages">
        {page > 0 ? <Link href={href(status, page - 1)} className="text-primary hover:underline">Previous page</Link> : null}
        {result.hasNext ? <Link href={href(status, page + 1)} className="text-primary hover:underline">Next page</Link> : null}
      </nav>
      <p className="text-xs text-muted-foreground">Page {page + 1}; up to 50 findings per page. Imported review decisions are shown on each finding.</p>
    </main>
  );
}
