"use client";
import type { AssetGroups } from "@/lib/studio/workspace/assets";

const Row = ({ children }: { children: React.ReactNode }) => <li className="space-y-0.5 rounded-md border p-2">{children}</li>;
const Heading = ({ children, count }: { children: React.ReactNode; count: number }) => <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>{children}</span><span>{count}</span></h3>;

/** The footage you shot. Narration lives on each script block, and every export is a version in the player, so neither is listed here. Unfinished uploads live in the upload control's "Needs attention". */
export function AssetsRail({ groups, uploadSlot }: { groups: AssetGroups; uploadSlot: React.ReactNode }) {
  return (
    <aside aria-label="Assets" className="space-y-5 text-sm">
      <section className="space-y-2"><Heading count={groups.footage.length}>Footage</Heading>
        <p className="text-xs text-muted-foreground">What you shot and uploaded.</p>
        {uploadSlot}
        {groups.footage.length ? <ul className="space-y-2">{groups.footage.map(a => (
          <Row key={a.id}><p className="break-words font-medium">{a.name}</p><p className="text-xs text-muted-foreground">{a.provenance} · {a.size}</p>
            <a className="inline-flex min-h-11 items-center text-xs text-primary hover:underline" href={`/studio/uploads/${a.id}?inline=1`} target="_blank" rel="noreferrer">Preview</a></Row>))}</ul>
          : <p className="text-xs text-muted-foreground">No footage yet. Add the clips you shot, then make the video.</p>}
      </section>
    </aside>
  );
}
