"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bookmark, Globe, Instagram, Users, Youtube, Music2, Facebook, Linkedin } from "lucide-react";
import { libraryPresentation, platformLabels, type LibraryPlatform } from "@/lib/studio/library-presentation";

export interface LibraryCardRecord {
  id: string; kind: string; title: string; source_url: string | null; summary: string | null;
  approved: boolean; archived: boolean; payload?: Record<string, unknown>;
}
export function LibraryPlatformIcon({ platform }: { platform: LibraryPlatform }) {
  if (platform === "x") return <span aria-hidden="true" className="text-xs font-semibold">𝕏</span>;
  const Icon = { youtube: Youtube, instagram: Instagram, tiktok: Music2, facebook: Facebook, linkedin: Linkedin, x: Globe, other: Globe }[platform];
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}
function SourceImage({ src, title, channel }: { src: string | null; title: string; channel: boolean }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`h-full w-full ${channel ? "object-cover" : "object-contain"}`} />;
  return <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">{channel ? <Users aria-hidden="true" className="h-7 w-7" /> : <Bookmark aria-hidden="true" className="h-7 w-7" />}<span className="max-w-full truncate px-4 text-xs">{title}</span></div>;
}
export function LibraryCard({ record }: { record: LibraryCardRecord }) {
  const item = libraryPresentation(record);
  const channel = record.kind === "channel";
  const media = <SourceImage key={item.thumbnail} src={item.thumbnail} title={record.title} channel={channel} />;
  const mediaClass = channel ? "relative block h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted" : `group relative block w-full overflow-hidden border-b bg-muted/40 ${item.portrait ? "aspect-[9/16]" : item.square ? "aspect-square" : "aspect-video"}`;
  return <article className={`min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground ${channel ? "flex items-start gap-4 p-5" : ""}`}>
    {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${record.title} on ${platformLabels[item.platform]} (new tab)`} className={`${mediaClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}>
      {media}{!channel ? <><span className="absolute left-3 top-3 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium">{item.portrait ? "Short video" : item.platform === "youtube" ? "Video" : "Post"}</span><span className="absolute bottom-3 right-3 rounded-full bg-background/90 p-2 transition-transform group-hover:scale-110"><ArrowUpRight className="h-4 w-4" /></span></> : null}
    </a> : <div className={mediaClass}>{media}</div>}
    <div className={`min-w-0 space-y-2.5 ${channel ? "flex-1" : "p-4"}`}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><LibraryPlatformIcon platform={item.platform} /><span>{platformLabels[item.platform]}</span>{item.creator ? <><span aria-hidden="true">·</span><span className="truncate">{item.creator}</span></> : null}</div>
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug"><Link href={`/studio/library/${record.id}`} className="hover:underline">{record.title}</Link></h3>
      {item.summary ? <div className="space-y-1"><p className="text-[11px] font-medium text-muted-foreground">{item.summaryLabel}</p><p className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{item.summary}</p></div> : null}
      {item.statusMessage ? <p className="text-xs leading-relaxed text-muted-foreground">{item.statusMessage}</p> : !item.summary ? <p className="text-xs text-muted-foreground">{item.summaryStatus === "failed" ? "Summary unavailable" : "No summary yet"}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground"><Link href={`/studio/library/${record.id}`} className="hover:text-foreground hover:underline">Details & notes</Link>{channel ? <span>Watched channel</span> : null}{record.archived ? <span>Archived</span> : null}</div>
    </div>
  </article>;
}
export function LibraryCards({ records, channels = false }: { records: LibraryCardRecord[]; channels?: boolean }) {
  if (channels) return <div className="grid gap-4 md:grid-cols-2">{records.map(record => <LibraryCard key={record.id} record={record} />)}</div>;
  const landscape = records.filter(record => !libraryPresentation(record).portrait);
  const portrait = records.filter(record => libraryPresentation(record).portrait);
  return <div className="space-y-8">
    {landscape.length ? <section aria-label="Videos and posts" className="space-y-3"><h2 className="text-sm font-medium text-muted-foreground">Videos & posts</h2><div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">{landscape.map(record => <LibraryCard key={record.id} record={record} />)}</div></section> : null}
    {portrait.length ? <section aria-label="Short videos and reels" className="space-y-3"><h2 className="text-sm font-medium text-muted-foreground">Shorts & reels</h2><div className="grid items-start gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">{portrait.map(record => <LibraryCard key={record.id} record={record} />)}</div></section> : null}
  </div>;
}
