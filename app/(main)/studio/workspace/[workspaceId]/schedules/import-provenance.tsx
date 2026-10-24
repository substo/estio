import type { ScheduleImportProvenance } from "@/lib/studio/schedule-history-reader";

export function ImportProvenance({ workspaceId, imported }: { workspaceId: string; imported: ScheduleImportProvenance | null }) {
  if (!imported) return <p className="text-sm text-muted-foreground">No import provenance is available.</p>;
  const issues = Array.isArray(imported.preview_evidence.issues) ? imported.preview_evidence.issues : [];
  return <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Import provenance">
    <h2 className="text-xl font-medium">Import provenance</h2>
    <p className="text-sm">Imported {imported.created_at} by workspace account {imported.imported_by_clerk_user_id}.</p>
    <p className="break-all text-xs text-muted-foreground">Import {imported.id} · source SHA-256 {imported.source_digest}</p>
    <details className="text-sm"><summary className="cursor-pointer">Snapshot counts and source-file evidence</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify({ counts: imported.counts, sourceFiles: imported.preview_evidence.sourceFiles }, null, 2)}</pre>
    </details>
    <p className="text-sm text-muted-foreground">{issues.length} preview review flags. The download includes every flag and the complete canonical source snapshot, including all schedules and run history in this import.</p>
    <a href={`/studio/workspace/${workspaceId}/schedules/imports/${imported.id}/download`} className="text-sm text-primary hover:underline">Download full import provenance</a>
    <p className="text-xs text-muted-foreground">The download contains private workspace content. Imported enabled states and in-flight history do not activate hosted work.</p>
  </section>;
}
