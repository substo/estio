"use client";

import { useId, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIBRARY_PLATFORMS, platformLabels } from "@/lib/studio/library-presentation";

export function LibraryImportForm({ locationId, inputRef }: { locationId: string; inputRef?: Ref<HTMLInputElement> }) {
  const inputId = useId();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const ambiguous = /^@?[\w.-]+$/.test(input.trim()) && !!input.trim();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(""); setSuccess("");
    const body = { input: input.trim(), ...(ambiguous ? { platform } : {}) };
    const fingerprint = JSON.stringify(body);
    try {
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch("/api/studio/library/import", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ ...body, idempotencyKey: request.current.key }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Could not add this source. Please try again.");
      const summaryNotice = typeof result.summaryError === "string" && result.summaryError.trim()
        ? result.summaryError
        : result.summaryStatus === "no_evidence" ? "Source description or transcript unavailable for a summary." : "";
      // Retain the successful request key: re-entering the same source can retry
      // summary enqueue without repeating the metadata mutation.
      setInput(""); setPlatform(""); setSuccess(`Source saved.${summaryNotice ? ` ${summaryNotice}` : ""}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect. Try again with the same source."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="min-w-0 space-y-3" aria-label="Add to library">
    <label htmlFor={inputId} className="block text-sm font-medium">Source URL or @handle</label>
    <div className="flex min-w-0 flex-col gap-3">
      <Input ref={inputRef} id={inputId} value={input} onChange={event => { setInput(event.target.value); setError(""); setSuccess(""); }} required maxLength={20000} disabled={pending} placeholder="Paste a video, post, channel URL or @handle" className="min-w-0 flex-1" />
      {ambiguous ? <select aria-label="Handle platform" required value={platform} disabled={pending} onChange={event => setPlatform(event.target.value)} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"><option value="">Choose platform</option>{LIBRARY_PLATFORMS.filter(item => item !== "other").map(item => <option key={item} value={item}>{platformLabels[item]}</option>)}</select> : null}
      <Button type="submit" disabled={pending || !input.trim()}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{pending ? "Adding…" : "Add source"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Save videos and posts for inspiration, or add a channel to your watchlist.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {success ? <p role="status" className="text-sm text-muted-foreground">{success}</p> : null}
  </form>;
}
