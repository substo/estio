import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { listRelatedRuns, type RelatedRunView } from "@/lib/studio/related-history";

export const dynamic = "force-dynamic";
const routeLabels: Record<string, string> = { mac_browser: "Your Mac's browser", device_network: "Connected device network", api: "YouTube API" };
const modeLabels: Record<string, string> = { plan_search_rank: "Model planned queries, searched, then ranked", rank: "API candidates ranked by your Mac's model", search: "Plain search (no model)", heuristic: "Keyword search (no model)" };
const byLabels = { model: "model", heuristic: "keywords from the source", user: "you" } as const;

function Step({ title, step }: { title: string; step: NonNullable<RelatedRunView["trace"]["planner"]> }) {
  return <details className="rounded-md border p-3">
    <summary className="cursor-pointer text-sm font-medium">{title} · {step.provider} · {step.model} · {(step.ms / 1000).toFixed(1)}s</summary>
    <div className="mt-3 space-y-3">
      <div><p className="text-xs font-medium text-muted-foreground">Exact prompt sent to the model</p><pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{step.prompt}</pre></div>
      <div><p className="text-xs font-medium text-muted-foreground">Model reply</p><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{step.response}</pre></div>
    </div>
  </details>;
}

export default async function RelatedHistoryPage({ params }: { params: Promise<{ anchorId: string }> }) {
  const { locationId, anchorId } = await studioRouteParams(params);
  const history = await listRelatedRuns(locationId, anchorId);
  if (!history) notFound();
  const back = history.anchor.kind === "content" ? `/studio/content/${history.anchor.id}` : `/studio/library/${history.anchor.id}`;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <header className="space-y-1">
        <Link href={back} className="text-sm text-muted-foreground hover:underline">Back to “{history.anchor.title}”</Link>
        <h1 className="text-2xl font-semibold">How related videos were chosen</h1>
        <p className="text-sm text-muted-foreground">Each search run keeps its queries, the exact prompts, the model that judged relevance, and every video’s score and reason. Newest first.</p>
      </header>
      {history.runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet. Open the source and let Related YouTube videos search.</p> : null}
      {history.runs.map(run => <section key={run.id} aria-label={`Run ${run.createdAt}`} className="space-y-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{new Date(run.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC</h2>
          <p className="text-xs text-muted-foreground">{routeLabels[run.route] ?? run.route} · {modeLabels[run.mode] ?? run.mode}</p>
        </div>
        {run.trace.focus ? <p className="text-sm"><span className="font-medium">What the model thinks the source is about:</span> {run.trace.focus}</p> : null}
        <div>
          <p className="text-sm font-medium">Search queries</p>
          <ul className="mt-1 list-disc pl-5 text-sm">{run.trace.queries.length ? run.trace.queries.map((q, i) => <li key={i}><code>{q.query}</code> <span className="text-muted-foreground">· by {byLabels[q.by]} · {q.found} results</span></li>) : <li className="text-muted-foreground">No new search: the candidates came from the YouTube API search shown above.</li>}</ul>
        </div>
        {run.trace.planner ? <Step title="Query planning" step={run.trace.planner} /> : null}
        {run.trace.ranker ? <Step title="Relevance ranking" step={run.trace.ranker} /> : null}
        {run.trace.notes?.length ? <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">{run.trace.notes.map((note, i) => <li key={i}>{note}</li>)}</ul> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">Score</th><th className="py-1 pr-3 font-medium">Video</th><th className="py-1 font-medium">Reason</th></tr></thead>
            <tbody>{run.trace.candidates.map(c => <tr key={c.id} className="border-t align-top">
              <td className="py-2 pr-3 tabular-nums">{c.score ?? "—"}<span className="block text-xs text-muted-foreground">{c.band.replace("_", " ")}</span></td>
              <td className="py-2 pr-3 break-words"><a className="text-primary underline" href={`https://www.youtube.com/watch?v=${c.id}`} target="_blank" rel="noreferrer">{c.title}</a>{c.channel ? <span className="block text-xs text-muted-foreground">{c.channel}</span> : null}</td>
              <td className="py-2 break-words text-muted-foreground">{c.reason || "Not scored"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>)}
    </main>
  );
}
