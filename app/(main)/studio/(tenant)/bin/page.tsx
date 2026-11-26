import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listBin } from "@/lib/studio/bin";
import { BIN_RETENTION_DAYS } from "@/lib/studio/bin-policy";
import { BinRestoreButton } from "../../_components/bin-restore-button";

export const dynamic = "force-dynamic";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

export default async function StudioBinPage({ params }: { params: Promise<{}> }) {
  const { locationId } = await studioRouteParams(params);
  const items = await listBin(locationId);
  if (!items) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-2">
        <nav className="flex gap-4 text-sm"><Link href="/studio/content" className="text-muted-foreground hover:underline">Content pipeline</Link></nav>
        <h1 className="text-3xl font-semibold tracking-tight">Bin</h1>
        <p className="text-muted-foreground">Deleted pieces and footage stay here for {BIN_RETENTION_DAYS} days. Restore anything you still need; the rest is deleted for good.</p>
      </header>
      {items.length ? <ul className="space-y-2">{items.map(item => (
        <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
          <div className="min-w-0">
            <p className="break-words font-medium">{item.name}</p>
            <p className="text-xs text-muted-foreground">{item.kind === "content" ? `Piece${Number(item.detail) ? ` · ${item.detail} ${Number(item.detail) === 1 ? "upload" : "uploads"}` : ""}` : `Footage from “${item.detail}”`} · deleted {day(item.deletedAt)} · {daysLeft(item.purgesAt)} {daysLeft(item.purgesAt) === 1 ? "day" : "days"} left</p>
          </div>
          <BinRestoreButton locationId={locationId} kind={item.kind} id={item.id} name={item.name} />
        </li>))}</ul>
        : <p className="rounded-lg border p-6 text-sm text-muted-foreground">The Bin is empty. Deleted pieces and footage will appear here.</p>}
    </main>
  );
}
