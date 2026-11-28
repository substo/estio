"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readVideoNotQueuedReason } from "@/lib/studio/video-state-text";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { LIBRARY_PLATFORMS, platformLabels } from "@/lib/studio/library-presentation";

export function LibraryImportForm({ locationId, inputRef, deferRefresh }: {
  locationId: string;
  inputRef: { current: HTMLInputElement | null };
  deferRefresh: (refresh: () => void) => void;
}) {
  const inputId = useId();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState("");
  const [pending, setPending] = useState<"open" | "continue" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ href: string; notice: string } | null>(null);
  const [opening, startOpening] = useTransition();
  useEffect(() => { if (saved) inputRef.current?.focus(); }, [inputRef, saved]);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const ambiguous = /^@?[\w.-]+$/.test(input.trim()) && !!input.trim();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || opening) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const open = !(submitter instanceof HTMLButtonElement && submitter.value === "continue");
    setPending(open ? "open" : "continue"); setError(""); setSaved(null);
    const body = { input: input.trim(), ...(ambiguous ? { platform } : {}), transcribe: true, extractKnowledge: true };
    const fingerprint = JSON.stringify(body);
    try {
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch("/api/studio/library/import", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ ...body, idempotencyKey: request.current.key }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Could not add this source. Please try again.");
      if (typeof result.recordId !== "string" || !recordLinkId(result.recordId)) throw new Error("Studio didn’t return a source link. Try again.");
      const transcription = result.transcription as { status?: string; message?: string; reason?: string } | undefined;
      const reason = transcription?.status === "not_queued" ? readVideoNotQueuedReason(transcription.reason) : null;
      const setup = new URLSearchParams();
      if (reason) setup.set("transcriptionSetup", reason);
      if (result.knowledgeSetup === "unavailable") setup.set("knowledgeSetup", "unavailable");
      const href = `/studio/library/${result.recordId}${setup.size ? `?${setup}` : ""}`;
      if (open) {
        startOpening(() => router.push(href));
      } else {
        setInput(""); setPlatform("");
        setSaved({ href, notice: transcription?.status === "not_queued" ? transcription.message ?? ""
          : transcription?.status === "queued" || transcription?.status === "reused" ? "Transcription queued on your Mac." : "" });
        // The empty-library trigger can disappear after the first save. Keep the dialog mounted while adding more.
        deferRefresh(() => router.refresh());
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect. Try again with the same source."); }
    finally { setPending(null); }
  }
  const busy = pending !== null || opening;
  return <form onSubmit={submit} className="min-w-0 space-y-3" aria-label="Add to library" aria-busy={busy}>
    <label htmlFor={inputId} className="block text-sm font-medium">Source URL or @handle</label>
    <div className="flex min-w-0 flex-col gap-3">
      <Input ref={inputRef} id={inputId} value={input} onChange={event => { setInput(event.target.value); setError(""); }} required maxLength={20000} disabled={busy} placeholder="Paste a video, post, channel URL or @handle" className="min-w-0 flex-1" />
      {ambiguous ? <select aria-label="Handle platform" required value={platform} disabled={busy} onChange={event => setPlatform(event.target.value)} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"><option value="">Choose platform</option>{LIBRARY_PLATFORMS.filter(item => item !== "other").map(item => <option key={item} value={item}>{platformLabels[item]}</option>)}</select> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="submit" value="open" className="min-h-11" disabled={busy || !input.trim()}>
          {pending === "open" || opening ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : <ArrowRight aria-hidden="true" className="mr-2 h-4 w-4" />}
          {opening ? "Opening source…" : pending === "open" ? "Saving source…" : "Add and open"}
        </Button>
        <Button type="submit" value="continue" variant="outline" className="min-h-11" disabled={busy || !input.trim()}>
          {pending === "continue" ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : <Plus aria-hidden="true" className="mr-2 h-4 w-4" />}
          {pending === "continue" ? "Saving source…" : "Save and add another"}
        </Button>
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {saved ? <p role="status" className="text-sm text-muted-foreground">
      Source saved. {saved.notice} <Link href={saved.href} className="font-medium text-primary underline underline-offset-2">Open source</Link>
    </p> : null}
  </form>;
}
