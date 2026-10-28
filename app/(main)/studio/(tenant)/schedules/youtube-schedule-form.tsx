"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
export function YoutubeScheduleForm({ locationId, scheduleId, version, stateVersion, settings, active }: {
 locationId: string; scheduleId: string; version: number; stateVersion: number; active: boolean;
 settings: { connected: boolean; connectionVersion: string | null; channels: Array<{ channel_id: string; label: string }> };
}) {
 const router = useRouter(); const command = useStudioCommand(`/studio/schedules/api`);
 const [source, setSource] = useState("approved_channel"); const [channelId, setChannelId] = useState(settings.channels[0]?.channel_id ?? "");
 const [titlePrefix, setTitlePrefix] = useState("Research link"); const [confirmed, setConfirmed] = useState(false); const [recurring, setRecurring] = useState(false);
 const [mode, setMode] = useState<"run_youtube_now" | "enable_youtube">("run_youtube_now");
 async function submit(next: typeof mode) {
  setMode(next);
  const result = await command.run({ action: next, requestId: crypto.randomUUID(), scheduleId, version, stateVersion, source, channelId, titlePrefix, connectionVersion: settings.connectionVersion, confirmShare: confirmed && (next === "run_youtube_now" || recurring) });
  if (result?.ok) {
   setConfirmed(false); setRecurring(false);
   if (next === "run_youtube_now") router.push(`/studio/schedules/${scheduleId}/discoveries/${result.data.discoveryRunId}`);
   router.refresh();
  }
 }
 const blocked = command.pending || !settings.connected || !confirmed;
 return <form className="space-y-4 rounded-xl border bg-card p-5 text-sm" onSubmit={event => event.preventDefault()}>
  <h2 className="text-xl font-medium">Run now</h2>
  {!settings.connected ? <p><Link className="text-primary hover:underline" href="/account/connections">Connect YouTube in your profile</Link> before running discovery.</p> : null}
  <fieldset disabled={command.pending || command.retry || !settings.connected} className="space-y-4">
   <legend>Use my current profile connection on this app</legend>
   <label className="block">Source<select value={source} onChange={event => { setSource(event.target.value); setChannelId(event.target.value === "approved_channel" ? settings.channels[0]?.channel_id ?? "" : ""); setConfirmed(false); }} className="mt-1 block w-full rounded border bg-background p-2">
    <option value="approved_channel">One Business-approved public channel</option><option value="search">Public search using the saved schedule focus</option><option value="subscription">One channel from my subscriptions</option>
   </select></label>
   {source === "approved_channel" ? <label className="block">Approved channel<select required value={channelId} onChange={event => setChannelId(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2"><option value="">Choose a channel</option>{settings.channels.map(channel => <option key={channel.channel_id} value={channel.channel_id}>{channel.label}</option>)}</select></label> : null}
   {source === "subscription" ? <label className="block">Subscribed channel ID<input required value={channelId} onChange={event => setChannelId(event.target.value)} placeholder="UC…" maxLength={24} className="mt-1 block w-full rounded border bg-background p-2" /><span className="text-muted-foreground">Choose one channel ID from your own interactive subscriptions. It is verified on activation and every run. Your subscription list and selected private source stay private; only explicitly authorized public result links are shared.</span></label> : null}
   <label className="block">My label for saved links<input required value={titlePrefix} onChange={event => setTitlePrefix(event.target.value)} maxLength={100} className="mt-1 block w-full rounded border bg-background p-2" /></label>
   <p>Each run reads one bounded result page and saves up to ten public links as pending research, titled with your label and the video ID. Existing research edits are preserved. No provider titles, descriptions, statistics, media, transcripts or complete subscription lists are saved. No AI call is made.</p>
   <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I authorize this app to use my current profile connection and share these public result links with this Business using my label. I understand this reveals the shared links to team members.</span></label>
  </fieldset>
  <p>Running now does not turn the schedule on. One active run per schedule is allowed.</p>
  <button type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) void submit("run_youtube_now"); }} disabled={command.retry ? command.pending || mode !== "run_youtube_now" : blocked} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{command.pending && mode === "run_youtube_now" ? "Queuing…" : command.retry && mode === "run_youtube_now" ? "Retry same request" : "Run now"}</button>
  {!active ? <div className="space-y-3 border-t pt-4">
   <h3 className="font-medium">Turn on</h3>
   <label className="flex items-start gap-2"><input type="checkbox" checked={recurring} disabled={command.pending || command.retry || !settings.connected} onChange={event => setRecurring(event.target.checked)} /><span>Also repeat this at the saved frequency for 30 days using my profile connection, until turned off. Removing or reconnecting my profile connection turns it off.</span></label>
   <button type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) void submit("enable_youtube"); }} disabled={command.retry ? command.pending || mode !== "enable_youtube" : blocked || !recurring} className="rounded-md border px-3 py-2 disabled:opacity-50">{command.pending && mode === "enable_youtube" ? "Turning on…" : command.retry && mode === "enable_youtube" ? "Retry same request" : "Turn on"}</button>
  </div> : null}
  {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
 </form>;
}
