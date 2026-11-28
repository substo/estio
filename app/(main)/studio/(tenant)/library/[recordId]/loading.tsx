import { Loader2 } from "lucide-react";

export default function LoadingSource() {
  return <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6" aria-busy="true">
    <p role="status" className="flex items-center gap-2 text-sm font-medium">
      <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> Opening source…
    </p>
    <div aria-hidden="true" className="grid max-w-3xl gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="aspect-video rounded-xl bg-muted motion-safe:animate-pulse" />
      <div className="space-y-3 pt-2">
        <div className="h-5 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
      </div>
    </div>
  </main>;
}
