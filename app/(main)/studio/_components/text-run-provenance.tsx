import Link from "next/link";
import type { IdeaSnapshot } from "@/lib/studio/idea-review-policy";
function sourceUrl(url: string | null) { try { const parsed = new URL(url ?? ""); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } }
export function TextRunProvenance({ locationId, snapshot }: { locationId: string; snapshot: IdeaSnapshot }) {
  return (
    <section className="space-y-3"><h2 className="text-xl font-medium">Input snapshot and provenance</h2>
      <p className="text-sm text-muted-foreground">Saved notes and partial research excerpts, not independently verified facts. These inputs were snapshotted for generation; current records may differ.</p>
      {snapshot.focus ? <p>Focus: {snapshot.focus}</p> : null}
      {snapshot.ideas.map(i => <details key={i.id} className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">{i.title} · version {i.version}{i.excerpted ? " · excerpted" : ""}</summary>
        <div className="mt-3 space-y-3"><Link href={`/studio/content/${i.id}`} className="text-primary hover:underline">Current content record</Link><p className="whitespace-pre-wrap">{i.summary}</p><p className="whitespace-pre-wrap">{i.notes}</p>
          {i.sources.map(s => <div key={s.id} className="space-y-1 border-l-2 pl-3"><p className="font-medium">{s.title} · {s.id} · version {s.version}{s.excerpted ? " · excerpted" : ""}</p>{sourceUrl(s.url) ? <a href={sourceUrl(s.url)!} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{s.url}</a> : null}<p className="whitespace-pre-wrap">{s.excerpt || "No supporting text was saved."}</p></div>)}
        </div>
      </details>)}
    </section>
  );
}
