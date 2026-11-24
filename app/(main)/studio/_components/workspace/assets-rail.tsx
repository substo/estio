"use client";
import type { AssetGroups } from "@/lib/studio/workspace/assets";

const Row = ({ children }: { children: React.ReactNode }) => <li className="space-y-0.5 rounded-md border p-2">{children}</li>;
const Heading = ({ children, count }: { children: React.ReactNode; count: number }) => <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>{children}</span><span>{count}</span></h3>;

/** Assets grouped by where they came from. Nothing here is an upload row: unfinished uploads live in the upload control's "Needs attention". */
export function AssetsRail({ groups, uploadSlot, onShowVersion }: { groups: AssetGroups; uploadSlot: React.ReactNode; onShowVersion: (id: string) => void }) {
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
      <section className="space-y-2"><Heading count={groups.narration.length}>Narration</Heading>
        <p className="text-xs text-muted-foreground">Voice generated from the script.</p>
        {groups.narration.length ? <ul className="space-y-2">{groups.narration.map(n => (
          <Row key={n.stamp}><p className="font-medium">{n.count} clip{n.count === 1 ? "" : "s"}</p><p className="text-xs text-muted-foreground">{n.provenance}</p>
            <details><summary className="min-h-11 cursor-pointer text-xs leading-[2.75rem] text-primary">Listen</summary>
              <ol className="space-y-2">{n.ids.map((id, i) => <li key={id}><span className="text-xs text-muted-foreground">Clip {i + 1}</span><audio controls preload="none" className="w-full" src={`/studio/uploads/${id}?inline=1`} /></li>)}</ol></details></Row>))}</ul>
          : <p className="text-xs text-muted-foreground">None yet. Turn on the voiceover when you make a video.</p>}
      </section>
      <section className="space-y-2"><Heading count={groups.exports.length}>Exports</Heading>
        <p className="text-xs text-muted-foreground">Videos made from your script, newest first.</p>
        {groups.exports.length ? <ul className="space-y-2">{groups.exports.map((a, i) => (
          <Row key={a.id}><p className="font-medium">{i === 0 ? "Latest" : "Earlier"} · {a.size}</p><p className="text-xs text-muted-foreground">{a.provenance}</p>
            <div className="flex gap-3"><button type="button" onClick={() => onShowVersion(a.id)} className="inline-flex min-h-11 items-center text-xs text-primary hover:underline">Show in player</button>
              <a className="inline-flex min-h-11 items-center text-xs text-primary hover:underline" href={`/studio/uploads/${a.id}`} download>Download</a></div></Row>))}</ul>
          : <p className="text-xs text-muted-foreground">No video yet.</p>}
      </section>
    </aside>
  );
}
