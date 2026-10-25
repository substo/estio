"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
export function YoutubeScheduleForm({ workspaceId, scheduleId, version, stateVersion, settings }: {
 workspaceId: string; scheduleId: string; version: number; stateVersion: number;
 settings: { connected: boolean; connectionVersion: string | null; channels: Array<{ channel_id: string; label: string }> };
}) {
 const router = useRouter(); const command = useStudioCommand(`/studio/schedules/api`);
 const [source, setSource] = useState("approved_channel"); const [channelId, setChannelId] = useState(settings.channels[0]?.channel_id ?? "");
 const [titlePrefix, setTitlePrefix] = useState("Research link"); const [confirmed, setConfirmed] = useState(false);
 return <form className="space-y-4 rounded-xl border bg-card p-5 text-sm" onSubmit={async event => {
  event.preventDefault(); const result = await command.run({ action: "enable_youtube", requestId: crypto.randomUUID(), scheduleId, version, stateVersion, source, channelId, titlePrefix, connectionVersion: settings.connectionVersion, confirmShare: confirmed });
  if (result?.ok) { setConfirmed(false); router.refresh(); }
 }}>
  <h2 className="text-xl font-medium">Authorize recurring YouTube discovery</h2>
  {!settings.connected ? <p><Link className="text-primary hover:underline" href="/account/connections">Connect YouTube in your profile</Link> before enabling discovery.</p> : null}
  <fieldset disabled={command.pending || command.retry || !settings.connected} className="space-y-4">
   <legend>Use my current profile connection on this app</legend>
   <label className="block">Source<select value={source} onChange={event => { setSource(event.target.value); setChannelId(event.target.value === "approved_channel" ? settings.channels[0]?.channel_id ?? "" : ""); setConfirmed(false); }} className="mt-1 block w-full rounded border bg-background p-2">
    <option value="approved_channel">One workspace-approved public channel</option><option value="search">Public search using the saved schedule focus</option><option value="subscription">One channel from my subscriptions</option>
   </select></label>
   {source === "approved_channel" ? <label className="block">Approved channel<select value={channelId} onChange={event => setChannelId(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2"><option value="">Choose a channel</option>{settings.channels.map(channel => <option key={channel.channel_id} value={channel.channel_id}>{channel.label}</option>)}</select></label> : null}
   {source === "subscription" ? <label className="block">Subscribed channel ID<input required value={channelId} onChange={event => setChannelId(event.target.value)} placeholder="UC…" maxLength={24} className="mt-1 block w-full rounded border bg-background p-2" /><span className="text-muted-foreground">Choose one channel ID from your own interactive subscriptions. It is verified on activation and every run. Your subscription list and selected private source stay private; only explicitly authorized public result links are shared.</span></label> : null}
   <label className="block">My label for saved links<input required value={titlePrefix} onChange={event => setTitlePrefix(event.target.value)} maxLength={100} className="mt-1 block w-full rounded border bg-background p-2" /></label>
   <p>Each occurrence reads one bounded result page and saves up to ten public links as pending research, titled with your label and the video ID. Existing research edits are preserved. No provider titles, descriptions, statistics, media, transcripts or complete subscription lists are saved. No AI call is made.</p>
   <label className="flex items-start gap-2"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I authorize this app to use my current profile grant on the saved cadence for 30 days, and automatically share these public result links with this location using my label. I understand this reveals the shared links to team members. I can pause here or remove my profile connection. Reconnecting requires fresh authorization.</span></label>
  </fieldset>
  <button disabled={command.pending || (!command.retry && (!confirmed || !settings.connected))} className="rounded border px-3 py-2 disabled:opacity-50">{command.pending ? "Authorizing…" : command.retry ? "Retry same authorization" : "Enable YouTube discovery"}</button>
  {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
 </form>;
}
