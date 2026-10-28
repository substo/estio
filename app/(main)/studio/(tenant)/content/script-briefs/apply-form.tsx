"use client";
import { useStudioTenantHeaders } from "../../../_components/studio-tenant-context";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function ScriptBriefApplyForm({ locationId, reviewId, expectedVersion }: { locationId: string; reviewId: string; expectedVersion: number }) {
  const tenantHeaders = useStudioTenantHeaders();
  const router = useRouter(); const [confirm,setConfirm] = useState(false); const [pending,setPending] = useState(false);
  const [error,setError] = useState<string|null>(null); const [retry,setRetry] = useState<object|null>(null); const [saved,setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending || saved || (!confirm && !retry)) return;
    const command = retry ?? { action:"apply",requestId:crypto.randomUUID(),reviewId,expectedVersion,confirmReplace:true };
    setPending(true);setRetry(command);setError(null);
    try {
      const response=await fetch(`/studio/content/script-briefs/api`,{method:"POST",headers:{...tenantHeaders,"Content-Type":"application/json"},body:JSON.stringify(command),signal:AbortSignal.timeout(30000)});
      const body=await response.json();
      if(!response.ok) {if(response.status<500)setRetry(null);setError(body.error??"Draft could not be applied.");if(response.status===409)router.refresh();return;}
      setSaved(true);setRetry(null);router.refresh();
    } catch {setError("The outcome is unconfirmed. Retry this same command or reload to check the saved application.");}
    finally {setPending(false);}
  }
  if(saved)return <p role="status">Draft applied as an unapproved script.</p>;
  return <form onSubmit={submit} className="space-y-3 rounded-xl border p-5 text-sm"><h2 className="font-medium">Apply this draft</h2>
    <label className="flex items-start gap-2"><input type="checkbox" required checked={confirm} disabled={pending||!!retry} onChange={e=>setConfirm(e.target.checked)}/>
      <span>I reviewed this draft and authorize replacing the content script at version {expectedVersion}, moving it to script stage and clearing approval. Claims still require verification. Notes and linked records stay intact; the previous script is retained in the application audit.</span></label>
    <button disabled={pending} className="rounded-md border px-3 py-2 disabled:opacity-50">{pending?"Applying…":retry?"Retry same application":"Apply as unapproved script"}</button>
    {error?<p role="alert" className="text-destructive">{error}</p>:null}
  </form>;
}
