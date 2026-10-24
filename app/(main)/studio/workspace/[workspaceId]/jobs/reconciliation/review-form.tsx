"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reconciliationCostMicros, type ReconciliationCommand } from "@/lib/studio/transcription-reconciliation-policy";

export function TranscriptionReviewForm({ workspaceId, attemptId, version, billingReviewed }: {
  workspaceId: string; attemptId: string; version: number; billingReviewed: boolean;
}) {
  const router = useRouter();
  const [action, setAction] = useState<"no_charge" | "billed">("no_charge");
  const [evidence, setEvidence] = useState("");
  const [cost, setCost] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<ReconciliationCommand | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || saved) return;
    setError(null);
    let command: ReconciliationCommand;
    try {
      command = retry ?? { requestId: crypto.randomUUID(), attemptId, expectedVersion: version,
        action: billingReviewed ? "authorize_replacement" : action, evidence,
        costMicros: billingReviewed ? null : action === "no_charge" ? 0 : reconciliationCostMicros(cost), confirmPaid: billingReviewed && confirm };
    } catch (error) { setError(error instanceof Error ? error.message : "Check this review."); return; }
    setRetry(command); setPending(true);
    try {
      const response = await fetch(`/studio/workspace/${workspaceId}/jobs/reconciliation/api`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) {
        // Validation/conflict responses are definite rejections. Transport/5xx
        // failures keep the exact command and request ID for a safe replay.
        if (response.status < 500) setRetry(null);
        setError(typeof result.error === "string" ? result.error : "Review was not accepted.");
        if (response.status === 409) router.refresh();
        return;
      }
      setSaved(true); setRetry(null); router.refresh();
    } catch { setError("The outcome could not be confirmed. Retry this same review or reload to check the latest state."); }
    finally { setPending(false); }
  }
  if (saved) return <p role="status">{billingReviewed ? "Replacement authorized. The job is queued and remains subject to the workspace budget." : "Billing evidence recorded. Replacement processing still needs separate authorization."}</p>;
  return <form onSubmit={submit} className="space-y-3 border-t pt-3">
    <fieldset disabled={pending || !!retry} className="space-y-3 disabled:opacity-60">
      {!billingReviewed ? <>
        <label className="block space-y-1"><span>Confirmed provider billing outcome</span>
          <select value={action} onChange={e => setAction(e.target.value as "no_charge" | "billed")} className="block rounded-md border bg-background p-2">
            <option value="no_charge">Provider evidence confirms no charge</option>
            <option value="billed">Provider evidence confirms a charge</option>
          </select>
        </label>
        {action === "billed" ? <label className="block space-y-1"><span>Confirmed cost (USD)</span>
          <input required type="text" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.006000" className="block rounded-md border bg-background p-2" />
        </label> : null}
        <p className="text-muted-foreground">A timeout or missing result is insufficient evidence of no charge. Verify this specific attempt with the provider. This records your review; it does not check or change the provider invoice.</p>
      </> : <label className="flex items-start gap-2">
        <input required type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1" />
        <span>I authorize another paid attempt for this missing result, in addition to any confirmed earlier charge. Requeueing may also process other unfinished work under the workspace budget.</span>
      </label>}
      <label className="block space-y-1"><span>{billingReviewed ? "Authorization reason and reference" : "Provider evidence and reference"}</span>
        <textarea required minLength={20} maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)} rows={3} className="block w-full rounded-md border bg-background p-2" />
      </label>
      <p className="text-muted-foreground">Saved in the workspace audit history. Include a support case or billing record reference. Keep API keys and credentials out of this field.</p>
    </fieldset>
    <button disabled={pending} className="rounded-md border px-3 py-2 disabled:opacity-50">{pending ? "Saving…" : retry ? "Retry same review" : billingReviewed ? "Authorize replacement and queue job" : "Record billing evidence"}</button>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </form>;
}
