"use client";
import { useStudioTenantHeaders } from "../../../_components/studio-tenant-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function IdeaReviewStartForm({ workspaceId, ideas, workflow = "idea_review" }: { workspaceId: string; workflow?: "idea_review" | "script_brief"; ideas: Array<{ id: string; version: number; title: string }> }) {
  const tenantHeaders = useStudioTenantHeaders();
  const isScript = workflow === "script_brief";
  const section = isScript ? "script-briefs" : "idea-reviews";
  const router = useRouter(); const [selected, setSelected] = useState<string[]>([]); const [focus, setFocus] = useState("");
  const [confirm, setConfirm] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<object | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending) return;
    if (!retry && (selected.length < 1 || selected.length > 5 || !confirm)) { setError(isScript ? "Select this idea and authorize the paid brief." : "Select one to five ideas and authorize the paid review."); return; }
    const command = retry ?? { action: "enqueue", requestId: crypto.randomUUID(), ideas: ideas.filter(i => selected.includes(i.id)).map(i => ({ id: i.id, version: Number(i.version) })), focus, confirmPaid: confirm };
    setRetry(command); setPending(true); setError(null);
    try {
      const response = await fetch(`/studio/content/${section}/api`, { method: "POST", headers: { ...tenantHeaders, "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      if (!response.ok) { if (response.status < 500) setRetry(null); setError(body.error ?? "Review could not be queued."); return; }
      router.push(`/studio/content/${section}/${body.reviewId}`);
    } catch { setError("The outcome is unconfirmed. Retry the same request to find its queued review."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border p-5 text-sm">
    <fieldset disabled={pending || !!retry} className="space-y-4">
      <legend className="font-medium">{isScript ? "Selected idea" : "Select up to five ideas"}</legend>
      <div className="max-h-80 space-y-2 overflow-y-auto">{ideas.map(i => <label key={i.id} className="flex items-start gap-2">
        <input type="checkbox" checked={selected.includes(i.id)} disabled={!selected.includes(i.id) && selected.length >= 5} onChange={e => setSelected(current => e.target.checked ? [...current, i.id] : current.filter(id => id !== i.id))} />{i.title}
      </label>)}</div>
      {!ideas.length ? <p>Add an unarchived idea in the content pipeline first.</p> : null}
      <label className="block space-y-1"><span>Audience or topic focus (optional)</span><input value={focus} onChange={e => setFocus(e.target.value)} maxLength={300} className="block w-full rounded-md border bg-background p-2" /></label>
      <p className="text-muted-foreground">The workspace OpenAI key sends selected idea notes and excerpts from up to three linked records per idea to OpenAI. Long text is excerpted and labeled. No browsing, third-party downloads or publishing occurs.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} required /><span>I authorize this paid review using the workspace key and budget. It reserves $0.01 before the call and settles metered usage afterward. Uncertain outcomes keep their hold until manager review.</span></label>
    </fieldset>
    <button disabled={pending || !ideas.length} className="rounded-md border px-3 py-2 disabled:opacity-50">{pending ? "Queuing…" : retry ? "Retry same request" : (isScript ? "Generate script brief" : "Review selected ideas")}</button>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </form>;
}
export function RefreshIdeaReview() { const router = useRouter(); return <button className="rounded-md border px-3 py-2 text-sm" onClick={() => router.refresh()}>Refresh status</button>; }
