"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { YoutubeVideo } from "@/lib/google/youtube-api";
import type { VideoQueueResult } from "@/lib/studio/video-transcription";
import { useStudioTenantHeaders } from "./studio-tenant-context";

type Band = "relevant" | "maybe" | "off_topic" | "unranked";
type Candidate = Omit<YoutubeVideo, "publishedAt" | "statistics" | "thumbnailUrl"> & { publishedAt?: string; statistics?: YoutubeVideo["statistics"]; publishedText?: string; viewsText?: string; ticket: string; score?: number | null; reason?: string; band?: Band };
type SearchResult = { query: string; alternateQuery: string | null; videos: Candidate[]; ranked?: boolean; note?: string; runId?: string | null; route?: string };
type Started = { status: "pending"; jobId: string; query: string; alternateQuery: string | null; ranking?: boolean } | ({ status: "done"; via?: "api" } & SearchResult);
type Polled = { status: "pending" } | { status: "failed"; message: string } | ({ status: "done"; viaDevice?: boolean } & SearchResult);
const POLL_MS = 2000, GIVE_UP_MS = 3 * 60_000, SLOW_MS = 20_000;
type Saved = { recordId: string; transcription: VideoQueueResult };

export function RelatedYoutubeVideos({ anchorId }: { anchorId: string }) {
  const router = useRouter();
  const tenant = useStudioTenantHeaders()["X-Studio-Tenant"];
  const section = useRef<HTMLElement>(null);
  const started = useRef(false);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [viaDevice, setViaDevice] = useState(false);
  const [ranking, setRanking] = useState(false);
  const run = useRef(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [dismissed, setDismissed] = useState(() => new Map<string, string[]>());
  const [saved, setSaved] = useState(() => new Map<string, Saved>());
  const [preview, setPreview] = useState<Candidate | null>(null);

  const request = useCallback(async <T,>(body: Record<string, unknown>) => {
    const response = await fetch("/studio/youtube/api", {
      method: "POST",
      headers: { "X-Studio-Tenant": tenant, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, anchorId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "YouTube discovery could not complete.");
    return data as T;
  }, [anchorId, tenant]);

  const search = useCallback(async (showMore: boolean, phrase?: string) => {
    const mine = ++run.current;
    setLoading(true); setSlow(false);
    setError("");
    try {
      const begun = await request<Started>({ action: "related", expanded: showMore, query: phrase || undefined });
      setQuery(begun.query);
      setRanking(begun.status === "pending" && begun.ranking === true);
      if (begun.status === "done") { setResult(begun); setViaDevice(false); return; }
      const startedAt = Date.now();
      while (mine === run.current) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        if (mine !== run.current) return;
        const polled = await request<Polled>({ action: "relatedStatus", jobId: begun.jobId });
        if (polled.status === "failed") throw new Error(polled.message);
        if (polled.status === "done") { setResult(polled); setQuery(polled.query); setViaDevice(polled.viaDevice === true); break; }
        if (Date.now() - startedAt > SLOW_MS) setSlow(true);
        if (Date.now() - startedAt > GIVE_UP_MS) throw new Error("Your Mac did not answer. Make sure it is on and the Studio companion is running, then search again.");
      }
    } catch (cause) {
      if (mine === run.current) setError(cause instanceof Error ? cause.message : "YouTube discovery could not complete.");
    } finally {
      if (mine === run.current) { setLoading(false); setSlow(false); }
    }
  }, [request]);

  useEffect(() => () => { run.current++; }, []);

  useEffect(() => {
    if (started.current || !section.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      observer.disconnect();
      void search(false);
    }, { rootMargin: "240px" });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, [search]);

  useEffect(() => {
    const onAsk = (event: Event) => {
      const phrase = (event as CustomEvent<{ phrase?: string }>).detail?.phrase?.trim();
      if (!phrase) return;
      started.current = true; setExpanded(true); setQuery(phrase); void search(true, phrase);
    };
    window.addEventListener("studio:related-search", onAsk);
    return () => window.removeEventListener("studio:related-search", onAsk);
  }, [search]);

  function explore() {
    started.current = true;
    setExpanded(true);
    void search(true, result?.query);
  }

  async function save(video: Candidate) {
    setSaving(video.id);
    setSaveError("");
    try {
      const value = await request<Saved>({ action: "saveRelated", ticket: video.ticket, title: video.title.trim().slice(0, 180) });
      setSaved(previous => new Map(previous).set(video.id, value));
      router.refresh();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "This reference could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  const currentQuery = result?.query ?? "";
  const videos = result?.videos.filter(video => !dismissed.get(currentQuery)?.includes(video.id)) ?? [];
  const relevant = videos.filter(v => v.band === "relevant");
  const less = videos.filter(v => v.band === "maybe" || v.band === "off_topic");
  const unchecked = videos.filter(v => !v.band || v.band === "unranked");
  const renderCard = (video: Candidate) => {
          const counts = [[video.statistics?.views, "views"], [video.statistics?.likes, "likes"], [video.statistics?.comments, "comments"]]
        .flatMap(([value, label]) => value ? [`${BigInt(value).toLocaleString()} ${label}`] : []);
      const selection = saved.get(video.id);
      return <article key={video.id} className="min-w-0 overflow-hidden rounded-lg border">
        <button type="button" aria-label={`Preview ${video.title}`} className="block w-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" onClick={event => { previewTrigger.current = event.currentTarget; setPreview(video); }}>
          {/* YouTube thumbnails are served by its video CDN. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" width={480} height={360} loading="lazy" className="aspect-video w-full bg-muted object-cover" />
          <span className="sr-only">Preview</span>
        </button>
        <div className="space-y-2 p-3 text-sm">
          <h3 className="break-words font-medium">{video.title}</h3>
          <p className="break-words text-xs text-muted-foreground">
            <a className="hover:underline" href={video.channelId ? `https://www.youtube.com/channel/${video.channelId}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(video.channelTitle)}`} target="_blank" rel="noreferrer">{video.channelTitle}</a>
            {video.publishedText ? <> · {video.publishedText}</> : /^\d{4}-\d{2}-\d{2}/.test(video.publishedAt ?? "") ? <> · {video.publishedAt?.slice(0, 10)}</> : null}
          </p>
          {(video.viewsText || counts.length > 0) && <p className="text-xs tabular-nums">{video.viewsText ?? counts.join(" · ")}</p>}
          {video.score != null && video.band !== "unranked" && <p className="break-words text-xs"><span className="font-medium">Relevance {video.score}/100</span>{video.reason ? ` · ${video.reason}` : ""}</p>}
              {video.description && <p className="break-words text-xs text-muted-foreground"><span className="sr-only">Publisher description. </span>{video.description}</p>}
          {selection ? <div role="status" className="space-y-1">
            <Link className="font-medium text-primary underline" href={`/studio/library/${selection.recordId}`}>Open linked reference</Link>
            {selection.transcription.status === "not_queued" && <p className="text-xs text-muted-foreground">{selection.transcription.message}</p>}
            {["queued", "reused"].includes(selection.transcription.status) && <p className="text-xs text-muted-foreground">Mac transcription queued.</p>}
          </div> : <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={saving !== null} onClick={() => void save(video)} className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50">{saving === video.id ? "Adding…" : "Add as reference"}</button>
            <button type="button" disabled={saving === video.id} onClick={() => setDismissed(previous => new Map(previous).set(currentQuery, [...(previous.get(currentQuery) ?? []), video.id]))} className="text-xs text-muted-foreground underline">Skip</button>
          </div>}
        </div>
      </article>;
  };
  const grid = (items: Candidate[]) => <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderCard)}</div>;
  return (
    <section ref={section} aria-label="Related YouTube videos" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Related YouTube videos</h2>
        {!expanded && <button type="button" className="text-sm text-primary underline disabled:opacity-50" onClick={explore} disabled={loading}>Explore more</button>}
      </div>
      {expanded && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void search(true, query); }}>
        <label htmlFor={`related-query-${anchorId}`} className="text-sm font-medium">Search YouTube</label>
        <div className="flex flex-wrap gap-2">
          <input id={`related-query-${anchorId}`} className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" value={query} onChange={event => setQuery(event.target.value)} maxLength={160} required />
          <button type="submit" className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={loading}>Search</button>
        </div>
        {result?.alternateQuery && <button type="button" className="text-left text-sm text-primary underline disabled:opacity-50" disabled={loading} onClick={() => void search(true, result.alternateQuery ?? undefined)}>Try “{result.alternateQuery}”</button>}
      </form>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">{slow ? "Waiting for your Mac… It must be on with the Studio companion running." : ranking ? "Your Mac is planning the search and checking each video’s relevance…" : "Searching YouTube…"}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
      {result && <p className="text-xs text-muted-foreground">YouTube results for “{result.query}”{viaDevice ? " · searched through your connected phone’s network" : ""}</p>}
      {result && !videos.length && !loading ? <p className="text-sm text-muted-foreground">
        {result.videos.length ? "You skipped all results for this search." : "No other public videos found. Try a different search."}
      </p> : null}
      {result?.ranked ? <>
        {relevant.length ? grid(relevant) : !loading ? <p className="text-sm text-muted-foreground">No videos scored as relevant to this source. Try Explore more or a different search.</p> : null}
        {less.length > 0 && <details className="space-y-3"><summary className="cursor-pointer text-sm text-muted-foreground">Less relevant ({less.length})</summary>{grid(less)}</details>}
      </> : unchecked.length > 0 ? <div className="space-y-3">
        <p role="note" className="text-sm text-amber-700 dark:text-amber-400">Not checked for relevance{result?.note ? `. ${result.note.replace(/^Not checked for relevance: /, "")}` : "."}</p>
        <details className="space-y-3"><summary className="cursor-pointer text-sm text-muted-foreground">Show {unchecked.length} unchecked results anyway</summary>{grid(unchecked)}</details>
      </div> : null}
      {result?.runId ? <p className="text-xs"><Link className="text-primary underline" href={`/studio/related-history/${anchorId}`}>How these were chosen</Link></p> : null}
      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }}>
        {preview && <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); previewTrigger.current?.focus(); }}>
          <DialogTitle className="break-words pr-7">{preview.title}</DialogTitle>
          <DialogDescription>{preview.channelTitle}</DialogDescription>
          <iframe title={`YouTube player for ${preview.title}`} className="aspect-video w-full rounded-md bg-black" src={`https://www.youtube-nocookie.com/embed/${preview.id}`} allow="encrypted-media; picture-in-picture" allowFullScreen />
          <a className="text-sm text-primary underline" href={`https://www.youtube.com/watch?v=${preview.id}`} target="_blank" rel="noreferrer">Open on YouTube</a>
        </DialogContent>}
      </Dialog>
    </section>
  );
}
