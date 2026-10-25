"use client";
import { useStudioTenantHeaders } from "../../_components/studio-tenant-context";
import { useState } from "react";
import Link from "next/link";
import type { ApprovedYoutubeChannel } from "@/lib/studio/youtube";
import type { YoutubeChannel, YoutubeVideo } from "@/lib/google/youtube-api";
type Results = { kind: "channels" | "videos"; channels?: YoutubeChannel[]; videos?: Array<YoutubeVideo & { ticket: string }>; identity?: string | null; nextPageToken?: string | null; provenance?: string; observedAt?: string; };
export function YoutubeDiscovery({ workspaceId, channels: initialChannels, canManage, connected }: { workspaceId: string; channels: ApprovedYoutubeChannel[]; canManage: boolean; connected: boolean }) {
  const tenantHeaders = useStudioTenantHeaders();
  const [channels, setChannels] = useState(initialChannels); const [mode, setMode] = useState("search"); const [query, setQuery] = useState("");
  const [channel, setChannel] = useState(initialChannels[0]?.channel_id ?? ""); const [results, setResults] = useState<Results | null>(null);
  const [lastRequest, setLastRequest] = useState<Record<string, unknown>>({}); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const [label, setLabel] = useState(""); const [newChannel, setNewChannel] = useState(""); const [titles, setTitles] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  async function call(body: Record<string, unknown>) {
    const response = await fetch(`/studio/youtube/api`, { method: "POST", headers: { ...tenantHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Request failed."); return data;
  }
  async function browse(request: Record<string, unknown>) {
    setError(""); setPending(true);
    try { const data = await call({ action: "browse", ...request }); setResults(data); setLastRequest(request); }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  async function save(id: string, ticket: string) {
    setError(""); setPending(true);
    try { const data = await call({ action: "save", ticket, title: titles[id] ?? "" }); setSaved(s => ({ ...s, [id]: data.recordId })); }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  async function approve(remove: boolean, id = newChannel) {
    setError(""); setPending(true);
    try { const data = await call({ action: "channel", channelId: id, label, remove }); const resolvedId = data.channelId; setChannels(c => remove ? c.filter(item => item.channel_id !== resolvedId) : [...c.filter(item => item.channel_id !== resolvedId), { channel_id: resolvedId, label }]); if (!remove) { setChannel(resolvedId); setNewChannel(""); setLabel(""); } }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  return <div className="space-y-6">
    <p className="text-sm">{connected ? "Your personal YouTube connection is available." : "Connect YouTube in your profile to browse your subscriptions."} <Link href="/account/connections" className="text-primary underline">My profile connections</Link></p>
    <form onSubmit={event => { event.preventDefault(); void browse({ mode, query, channelId: channel }); }} className="space-y-3 rounded-xl border p-5">
      <label className="block text-sm">Source<select value={mode} onChange={e => setMode(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2">
        <option value="search">Public YouTube search</option><option value="channel">Approved public channel</option><option value="subscriptions">My subscriptions (private to me)</option><option value="url">Saved video URL</option>
      </select></label>
      {mode === "search" || mode === "url" ? <label className="block text-sm">{mode === "url" ? "YouTube video URL" : "Search query"}<input value={query} maxLength={mode === "url" ? 300 : 160} required onChange={e => setQuery(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2" /></label> : null}
      {mode === "channel" ? <label className="block text-sm">Approved channel<select value={channel} onChange={e => setChannel(e.target.value)} required className="mt-1 w-full rounded-md border bg-background p-2"><option value="">Choose a channel</option>{channels.map(c => <option key={c.channel_id} value={c.channel_id}>{c.label}</option>)}</select></label> : null}
      <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Loading…" : "Discover"}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {results ? <section className="space-y-4" aria-label="YouTube discovery results">
      {results.identity ? <p className="text-sm">Your connected YouTube channel: {results.identity}</p> : null}
      {results.provenance ? <p className="text-sm text-muted-foreground">Source: {results.provenance.replaceAll("_", " ")} · observed {results.observedAt}</p> : null}
      {results.channels?.map(c => <article key={c.id} className="flex flex-wrap justify-between gap-3 rounded-xl border p-5"><span>{c.title}</span><button disabled={pending} onClick={() => void browse({ mode: "subscription", channelId: c.id })} className="text-sm text-primary">View public uploads</button></article>)}
      {results.videos?.map(v => <article key={v.id} className="space-y-3 rounded-xl border p-5">
        <h2 className="font-medium"><a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{v.title}</a></h2>
        <p className="text-sm text-muted-foreground">{v.channelTitle} · {v.publishedAt}</p>
        <label className="block text-sm">Your research title<input value={titles[v.id] ?? ""} maxLength={180} onChange={e => setTitles(t => ({ ...t, [v.id]: e.target.value }))} className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        {saved[v.id] ? <Link href={`/studio/library/${saved[v.id]}`} className="text-sm text-primary underline">Open saved research link</Link> : <button disabled={pending} onClick={() => void save(v.id, v.ticket)} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">Save public link to workspace</button>}
      </article>)}
      {!results.channels?.length && !results.videos?.length ? <p className="text-sm">No available results on this page.</p> : null}
      {results.nextPageToken ? <button disabled={pending} onClick={() => void browse({ ...lastRequest, pageToken: results.nextPageToken })} className="text-sm text-primary">Next results</button> : null}
    </section> : null}
    {canManage ? <section className="space-y-3 rounded-xl border p-5"><h2 className="text-lg font-medium">Approved public channels</h2>
      <form onSubmit={e => { e.preventDefault(); void approve(false); }} className="space-y-3">
        <label className="block text-sm">YouTube channel URL or @handle<input value={newChannel} onChange={e => setNewChannel(e.target.value)} maxLength={300} required className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        <label className="block text-sm">Your label<input value={label} onChange={e => setLabel(e.target.value)} maxLength={180} required className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        <button disabled={pending} className="rounded-md border px-3 py-2 text-sm">Approve channel</button>
      </form>
      {channels.map(c => <p key={c.channel_id} className="flex justify-between gap-3 text-sm"><span>{c.label} · {c.channel_id}</span><button disabled={pending} onClick={() => void approve(true, c.channel_id)} className="text-primary">Remove approval</button></p>)}
    </section> : null}
  </div>;
}
