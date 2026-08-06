"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Member = { id: string; name: string; email: string };

export function ImpersonationForm({ locationId, members }: { locationId: string; members: Member[] }) {
  const [targetUserId, setTargetUserId] = useState(members[0]?.id || "");
  const [reason, setReason] = useState("");
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createAccess(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setLaunchUrl(null); setCopied(false);
    try {
      const response = await fetch("/api/platform/impersonation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, locationId, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create support access.");
      setLaunchUrl(result.launchUrl);
      setExpiresAt(result.expiresAt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create support access.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!launchUrl) return;
    try {
      await navigator.clipboard.writeText(launchUrl);
      setCopied(true);
    } catch {
      setError("Clipboard access failed. Allow clipboard access and try again.");
    }
  }

  return (
    <form onSubmit={createAccess} className="space-y-5 rounded-lg border p-5">
      <div className="space-y-2">
        <Label htmlFor="support-target">User to view as</Label>
        <select id="support-target" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required className="min-h-11 w-full rounded-md border bg-background px-3">
          {members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-reason">Support reason</Label>
        <Textarea id="support-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} required placeholder="Describe the customer issue being investigated" />
        <p className="text-xs text-muted-foreground">Required. Stored in the audit record (10–500 characters).</p>
      </div>
      <Button type="submit" disabled={busy || !targetUserId || reason.trim().length < 10}>{busy ? "Creating…" : "Create one-time support link"}</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {launchUrl ? (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
          <p className="font-medium">Open this link in a Private Window or a separate browser profile.</p>
          <p className="text-sm">A normal tab shares Clerk cookies and can replace your current administrator session. This one-time link expires at {expiresAt ? new Date(expiresAt).toLocaleTimeString() : "soon"}.</p>
          <Button type="button" onClick={copyLink} variant="outline">{copied ? "Copied" : "Copy secure link"}</Button>
        </div>
      ) : null}
    </form>
  );
}
