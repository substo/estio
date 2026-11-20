import Link from "next/link";
import { Laptop } from "lucide-react";
import { getStudioDevices } from "@/lib/studio/devices";
import { summarizeComputerReadiness } from "@/lib/studio/computer-readiness-policy";

/** One honest line about the connected Mac. Failure to read it never blocks the page. */
export async function ComputerReadiness({ locationId }: { locationId: string }) {
  const data = await getStudioDevices(locationId).catch(() => null);
  if (!data) return null;
  const state = summarizeComputerReadiness(data.devices);
  const dot = state.tone === "ready" ? "bg-emerald-500" : state.tone === "attention" ? "bg-amber-500" : "bg-muted-foreground/50";
  return <section aria-label="Connected computer" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm">
    <Laptop aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
    <span className="font-medium">{state.label}</span>
    <span className="min-w-0 flex-1 text-muted-foreground">{state.detail}</span>
    <Link href="/settings/computer?from=studio" className="inline-flex min-h-9 items-center font-medium text-primary hover:underline">{state.action}</Link>
  </section>;
}
