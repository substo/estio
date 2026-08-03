"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Attempt = { attemptId: string; scope: "USER" | "LOCATION"; state: string; verificationUrl?: string; userCode?: string; expiresAt: string; message?: string };
type UsageLimits = { primary?: { usedPercent?: number; resetsAt?: number | null } | null; secondary?: { usedPercent?: number; resetsAt?: number | null } | null } | null;

export function ChatGptConnectionPanel({
    scope,
    canManage,
    connected,
    identity,
    planType,
    verifiedAt,
    health,
    usageLimits,
    preferMyConnection = false,
}: {
    scope: "USER" | "LOCATION";
    canManage: boolean;
    connected: boolean;
    identity?: string | null;
    planType?: string | null;
    verifiedAt?: string | null;
    health?: string | null;
    usageLimits?: UsageLimits;
    preferMyConnection?: boolean;
}) {
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [preferred, setPreferred] = useState(preferMyConnection);

    useEffect(() => {
        if (!attempt || !dialogOpen || attempt.state !== "waiting") return;
        const timer = window.setInterval(async () => {
            try {
                const response = await fetch(`/api/admin/settings/integrations/chatgpt-subscription/device?scope=${scope}&attemptId=${encodeURIComponent(attempt.attemptId)}`, { cache: "no-store" });
                const body = await response.json().catch(() => ({}));
                if (body.attempt) {
                    setAttempt(body.attempt);
                    if (body.attempt.state !== "waiting") window.clearInterval(timer);
                } else if (!response.ok) {
                    setAttempt((current) => current ? { ...current, state: "failed", message: body.error || "Sign-in status could not be checked. Start again." } : current);
                    window.clearInterval(timer);
                }
            } catch {
                setAttempt((current) => current ? { ...current, state: "failed", message: "Sign-in status could not be checked. Start again." } : current);
                window.clearInterval(timer);
            }
        }, 2000);
        return () => window.clearInterval(timer);
    }, [attempt, dialogOpen, scope]);

    async function start() {
        setBusy(true); setMessage("");
        try {
            const response = await fetch("/api/admin/settings/integrations/chatgpt-subscription/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "start", scope }) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body.attempt) { setMessage(body.error || "Could not start ChatGPT sign-in."); return; }
            setAttempt(body.attempt); setDialogOpen(true);
        } catch {
            setMessage("Could not start ChatGPT sign-in. Try again.");
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        if (!window.confirm(`Disconnect the ${scope === "LOCATION" ? "location" : "personal"} ChatGPT connection from Estio?`)) return;
        setBusy(true);
        try {
            const response = await fetch("/api/admin/settings/integrations/chatgpt-subscription/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "disconnect", scope }) });
            const body = await response.json().catch(() => ({}));
            setMessage(body.message || body.error || "Connection updated.");
            if (response.ok) window.location.reload();
        } catch {
            setMessage("Could not disconnect ChatGPT. Try again.");
        } finally {
            setBusy(false);
        }
    }

    async function setPreference(enabled: boolean) {
        setPreferred(enabled);
        try {
            const response = await fetch("/api/admin/settings/integrations/chatgpt-subscription/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "preference", scope: "USER", enabled }) });
            if (!response.ok) throw new Error("Preference update failed");
        } catch {
            setPreferred(!enabled); setMessage("Could not update your preference.");
        }
    }

    async function closeDialog(open: boolean) {
        setDialogOpen(open);
        if (!open && attempt?.state === "waiting") {
            await fetch("/api/admin/settings/integrations/chatgpt-subscription/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "cancel", scope, attemptId: attempt.attemptId }) });
        }
        if (!open && attempt?.state === "connected") window.location.reload();
    }

    return <div className="space-y-4">
        <div className="rounded-md bg-muted p-4 text-sm">
            <p className="font-medium">{connected ? (scope === "LOCATION" ? "Available for this location" : "Connected") : "Not connected"}</p>
            {identity && <p className="text-muted-foreground">{identity}{planType ? ` · ${planType}` : ""}</p>}
            {connected && health && <p className="text-muted-foreground">Connection health: {health === "connected" ? "Connected" : "Needs attention"}</p>}
            {verifiedAt && <p className="text-muted-foreground">Last verified {new Date(verifiedAt).toLocaleString()}</p>}
            {connected && usageLimits?.primary && <p className="text-muted-foreground">Subscription limit used: {Math.round(Number(usageLimits.primary.usedPercent || 0))}%{usageLimits.primary.resetsAt ? ` · resets ${new Date(Number(usageLimits.primary.resetsAt) * 1000).toLocaleString()}` : ""}</p>}
        </div>
        {scope === "USER" && connected && <div className="flex min-h-11 items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="prefer-personal" className="leading-5">Use my ChatGPT connection for my interactive AI requests.</Label>
            <Switch id="prefer-personal" checked={preferred} onCheckedChange={setPreference} />
        </div>}
        {canManage && <div className="flex flex-wrap gap-3">
            <Button onClick={start} disabled={busy} className="min-h-11">{connected ? "Replace connection" : "Connect"}</Button>
            {connected && <Button onClick={disconnect} disabled={busy} variant="outline" className="min-h-11">Disconnect</Button>}
        </div>}
        <div aria-live="polite" role="status" className="text-sm text-muted-foreground">{message}</div>

        <Dialog open={dialogOpen} onOpenChange={closeDialog}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{scope === "LOCATION" ? "Connect location ChatGPT subscription" : "Connect my ChatGPT subscription"} (Codex)</DialogTitle>
                    <DialogDescription>Open ChatGPT, sign in, and enter the one-time code. Estio stores the connection encrypted on the server and never sends ChatGPT tokens to this browser.</DialogDescription>
                </DialogHeader>
                <div aria-live="polite" role="status" className="space-y-4">
                    {attempt?.state === "waiting" && <>
                        <div className="rounded-md border p-4 text-center">
                            <p className="text-sm text-muted-foreground">One-time code</p>
                            <p className="mt-1 font-mono text-2xl tracking-wider">{attempt.userCode || "Preparing…"}</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <Button asChild disabled={!attempt.verificationUrl} className="min-h-11"><a href={attempt.verificationUrl || "#"} target="_blank" rel="noreferrer">Open ChatGPT</a></Button>
                            <Button variant="outline" className="min-h-11" disabled={!attempt.userCode} onClick={async () => {
                                if (!attempt.userCode) return;
                                try { await navigator.clipboard.writeText(attempt.userCode); setMessage("One-time code copied."); }
                                catch { setMessage("Could not copy the code. Select it and copy it manually."); }
                            }}>Copy code</Button>
                        </div>
                        <p className="text-sm text-muted-foreground">Waiting for ChatGPT…</p>
                    </>}
                    {attempt?.state !== "waiting" && <p className={attempt?.state === "connected" ? "text-emerald-700" : "text-destructive"}>{attempt?.message || "Sign-in finished."}</p>}
                </div>
            </DialogContent>
        </Dialog>
    </div>;
}
