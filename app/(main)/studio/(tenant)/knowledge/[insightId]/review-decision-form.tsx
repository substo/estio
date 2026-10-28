"use client";
import { useStudioTenantHeaders } from "../../../_components/studio-tenant-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { availableKnowledgeReviewActions, type KnowledgeReviewAction } from "@/lib/studio/knowledge-policy";
import { useStudioCommand } from "@/app/(main)/studio/_components/use-studio-command";
const labels = { edit: "Save statement edit and return to pending", approve: "Approve finding and topic", reject: "Reject finding", reopen: "Reopen for review" };
export function ReviewDecisionForm({ locationId, insightId, version, status, statement, suggestedTopic, currentTopic, initialTopics }: {
 locationId: string; insightId: string; version: number; status: "pending" | "approved" | "rejected";
 statement: string; suggestedTopic: string; currentTopic: { id: string; name: string } | null;
 initialTopics: { topics: Array<{ id: string; name: string }>; hasMore: boolean };
}) {
  const tenantHeaders = useStudioTenantHeaders();
 const router = useRouter(); const command = useStudioCommand(`/studio/knowledge/${insightId}/api`);
 const [action, setAction] = useState<KnowledgeReviewAction | "edit" | "">("");
 const [draft, setDraft] = useState(statement); const [reason, setReason] = useState("");
 const [topicMode, setTopicMode] = useState<"keep" | "existing" | "create">(currentTopic ? "keep" : "create");
 const [topicId, setTopicId] = useState(""); const [name, setName] = useState(suggestedTopic.length <= 120 ? suggestedTopic : "");
 const [topics, setTopics] = useState(initialTopics); const [query, setQuery] = useState("");
 const [searchPending, setSearchPending] = useState(false); const [searchError, setSearchError] = useState("");
 const inputClass = "mt-1 block w-full rounded-md border bg-background p-3 text-sm";
 async function searchTopics() {
  if (searchPending) return; setSearchPending(true); setSearchError("");
  try {
   const response = await fetch(`/studio/knowledge/topics/api?${new URLSearchParams({ q: query })}`, { headers: tenantHeaders, cache: "no-store", signal: AbortSignal.timeout(20000) });
   const body = await response.json(); if (!response.ok) { setSearchError(body.error ?? "Topics could not be loaded."); return; }
   setTopics(body); setTopicId("");
  } catch { setSearchError("Topics could not be loaded. Your statement and review note are still here."); }
  finally { setSearchPending(false); }
 }
 return <form className="space-y-4 rounded-xl border bg-card p-5" aria-label="Edit and review finding" onSubmit={async event => {
  event.preventDefault(); const result = await command.run({ requestId: crypto.randomUUID(), version, action,
   statement: draft === statement ? null : draft, reason,
   topic: action !== "approve" || topicMode === "keep" ? { mode: "keep" } : topicMode === "existing" ? { mode: "existing", id: topicId } : { mode: "create", name } });
  if (result?.ok) router.refresh();
 }}>
  <h2 className="text-lg font-medium">Edit and review</h2>
  <p className="text-sm text-muted-foreground">Current status: {status}. Edits and decisions are recorded with your account, previous values and timestamp.</p>
  <fieldset disabled={command.pending || command.retry} className="space-y-4">
   <legend className="sr-only">Finding changes</legend>
   <label className="block text-sm font-medium">Current statement<textarea value={draft} maxLength={4000} rows={5} onChange={event => setDraft(event.target.value)} className={inputClass} /></label>
   <p className="text-xs text-muted-foreground">Up to 4,000 characters when changed; wording and whitespace are saved exactly. Saving an edit alone returns the finding to pending and retains its topic. You can approve an edited pending statement and its topic together. Evidence and imported wording remain unchanged.</p>
   <label className="block text-sm font-medium">Action<select required value={action} onChange={event => setAction(event.target.value as typeof action)} className={inputClass}>
    <option value="">Choose an action</option><option value="edit">{labels.edit}</option>{availableKnowledgeReviewActions(status).map(value => <option key={value} value={value}>{labels[value]}</option>)}
   </select></label>
   {action === "approve" ? <div className="space-y-3 rounded border p-3">
    <label className="block text-sm font-medium">Approval topic<select value={topicMode} onChange={event => setTopicMode(event.target.value as typeof topicMode)} className={inputClass}>
     {currentTopic ? <option value="keep">Keep {currentTopic.name}</option> : null}<option value="existing">Assign an existing topic</option><option value="create">Use or create a named topic</option>
    </select></label>
    {topicMode === "create" ? <><label className="block text-sm">Topic name<input value={name} required maxLength={120} onChange={event => setName(event.target.value)} className={inputClass} /></label><p className="text-xs text-muted-foreground">Matching names reuse an existing topic. ASCII case and repeated spaces are ignored; punctuation and other characters stay distinct. If imported names are ambiguous, choose the existing topic explicitly.</p></> : null}
    {topicMode === "existing" ? <><label className="block text-sm">Find a topic<input value={query} maxLength={120} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchTopics(); } }} className={inputClass} /></label>
     <button type="button" disabled={searchPending} onClick={() => void searchTopics()} className="rounded border px-3 py-2 text-sm">{searchPending ? "Finding…" : "Find topics"}</button>
     <label className="block text-sm">Topic<select required value={topicId} onChange={event => setTopicId(event.target.value)} className={inputClass}><option value="">Choose a topic</option>{topics.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name} · {topic.id}</option>)}</select></label>
     {topics.hasMore ? <p className="text-xs text-muted-foreground">Showing 100 matching topics. Refine your search to find others.</p> : null}
     {searchError ? <p role="alert" className="text-sm">{searchError}</p> : null}</> : null}
   </div> : null}
   <label className="block text-sm font-medium">Review note (optional)<textarea value={reason} maxLength={2000} rows={3} onChange={event => setReason(event.target.value)} className={inputClass} /></label>
  </fieldset>
  <p className="text-xs text-muted-foreground">Your draft stays here if another review conflicts. After an uncertain response, retry the same command to check its saved outcome.</p>
  <button disabled={command.pending || (!command.retry && (!action || (action === "edit" && draft === statement)))} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{command.pending ? "Saving…" : command.retry ? "Retry same command" : action ? labels[action] : "Save finding"}</button>
  {command.error ? <p role="alert" className="text-sm text-destructive">{command.error}</p> : null}
 </form>;
}
