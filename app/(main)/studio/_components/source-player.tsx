"use client";
import { useState } from "react";
import { Play, ExternalLink } from "lucide-react";

/** Thumbnail first; the privacy-enhanced YouTube player loads only after the user asks to play. */
export function SourcePlayer({ title, thumbnail, videoId, url, portrait = false }: { title: string; thumbnail: string | null; videoId: string | null; url: string | null; portrait?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = portrait ? "mx-auto aspect-[9/16] max-h-[70dvh]" : "aspect-video";
  if (playing && videoId) return <div className={`${frame} w-full overflow-hidden rounded-xl bg-black`}><iframe title={`Player: ${title}`} className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>;
  const inner = <>
    {thumbnail && !failed ? <img src={thumbnail} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">No preview image</div>}
    <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-background/95 shadow-md transition-transform duration-150 group-hover:scale-105 motion-reduce:transition-none">{videoId ? <Play aria-hidden="true" className="ml-0.5 h-6 w-6" /> : <ExternalLink aria-hidden="true" className="h-5 w-5" />}</span></span>
  </>;
  const cls = `group relative block ${frame} w-full overflow-hidden rounded-xl bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`;
  if (videoId) return <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${title}`} className={cls}>{inner}</button>;
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} on the original site (new tab)`} className={cls}>{inner}</a> : <div className={cls}>{inner}</div>;
}
