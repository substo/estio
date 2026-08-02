"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, QrCode, RefreshCw, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/components/ui/use-toast";
import {
    clearWhatsAppWebBridge,
    connectWhatsAppWebBridge,
    disconnectWhatsAppWebBridge,
    getWhatsAppSettings,
    restartWhatsAppWebBridge,
    setWhatsAppWebBridgeDefault,
} from "../actions";
import { getFriendlyLinkedPhoneStatus, type FriendlyLinkedPhoneStatus } from "../linked-phone-status";
import { WhatsAppNav } from "../whatsapp-nav";

type Settings = Awaited<ReturnType<typeof getWhatsAppSettings>>;

function friendlyTime(value: string | null | undefined) {
    if (!value) return "Not yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    return date.toLocaleString();
}

function statusBadgeClass(tone: FriendlyLinkedPhoneStatus["tone"]) {
    if (tone === "success") return "bg-green-600 text-white";
    if (tone === "warning") return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
    if (tone === "error") return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100";
    return "";
}

export function LinkedPhoneClient() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [technicalOpen, setTechnicalOpen] = useState(false);
    const { toast } = useToast();

    const loadSettings = useCallback(async () => {
        const next = await getWhatsAppSettings(null);
        setSettings(next);
        return next;
    }, []);

    useEffect(() => {
        loadSettings().catch((error) => {
            setAnnouncement(error?.message || "Unable to load the WhatsApp connection.");
        });
    }, [loadSettings]);

    const runAction = async (name: string, action: (locationId: string) => Promise<unknown>, successMessage: string) => {
        if (!settings) return;
        setBusyAction(name);
        setAnnouncement("");
        try {
            const result = await action(settings.locationId) as { success?: boolean; error?: string } | undefined;
            if (result?.success === false) throw new Error(result.error || "The connection service could not complete this action.");
            await loadSettings();
            setAnnouncement(successMessage);
            toast({ title: successMessage });
        } catch (error: any) {
            const message = error?.message || "The WhatsApp connection could not be updated.";
            setAnnouncement(message);
            toast({ title: "Connection update failed", description: message, variant: "destructive" });
        } finally {
            setBusyAction(null);
        }
    };

    if (!settings) {
        return <div className="flex min-h-72 items-center justify-center" role="status" aria-label="Loading WhatsApp connection"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const status = getFriendlyLinkedPhoneStatus(settings);
    const session = settings.webBridgeSession;
    const diagnostics = settings.webBridgeDiagnostics;
    const connected = status.label === "Connected";
    const needsRestart = status.label === "Reconnecting" || diagnostics?.status === "failed";
    const qrVisible = Boolean(session?.qrCode);

    const primaryAction = !connected
        ? needsRestart && session
            ? { label: "Try reconnecting", name: "restart", run: () => runAction("restart", restartWhatsAppWebBridge, "Reconnection started") }
            : qrVisible
                ? { label: "Check connection", name: "check", run: () => runAction("check", async () => loadSettings(), "Connection checked") }
                : { label: "Connect with QR code", name: "connect", run: () => runAction("connect", connectWhatsAppWebBridge, "QR connection started") }
        : !session?.isDefaultOutbound
            ? { label: "Use this phone for messages", name: "default", run: () => runAction("default", setWhatsAppWebBridgeDefault, "This phone is now used for WhatsApp messages") }
            : { label: "Check connection", name: "check", run: () => runAction("check", async () => loadSettings(), "Connection checked") };

    return (
        <div className="max-w-4xl space-y-6">
            <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Connect your WhatsApp phone</h1>
                <p className="text-muted-foreground">Link the WhatsApp account already used on your phone by scanning a QR code.</p>
            </div>
            <WhatsAppNav />
            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

            <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
                <Card>
                    <CardHeader>
                        <CardTitle>How to link your phone</CardTitle>
                        <CardDescription>You only need WhatsApp and the phone you normally use.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ol className="list-decimal space-y-3 pl-5 text-sm">
                            <li>Open WhatsApp on the phone.</li>
                            <li>Open Settings or the menu.</li>
                            <li>Choose <strong>Linked devices</strong>.</li>
                            <li>Choose <strong>Link a device</strong>.</li>
                            <li>Scan the QR code shown here.</li>
                        </ol>
                    </CardContent>
                </Card>

                <Card className="border-green-500/50">
                    <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <CardTitle>Phone connection</CardTitle>
                            <Badge className={statusBadgeClass(status.tone)} variant={status.tone === "neutral" ? "outline" : "default"}>{status.label}</Badge>
                        </div>
                        <CardDescription>{status.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <dl className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-md border p-3">
                                <dt className="text-xs text-muted-foreground">Connected phone</dt>
                                <dd className="mt-1 font-medium">{session?.phone || "Not shown yet"}</dd>
                            </div>
                            <div className="rounded-md border p-3">
                                <dt className="text-xs text-muted-foreground">Last connected or seen</dt>
                                <dd className="mt-1 font-medium">{friendlyTime(session?.lastSeenAt || session?.lastReadyAt)}</dd>
                            </div>
                        </dl>

                        {qrVisible && (
                            <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-4 text-center">
                                <img src={session?.qrCode} alt="QR code for linking this WhatsApp phone" className="h-56 w-56 max-w-full rounded bg-white p-2" />
                                <p className="text-sm text-muted-foreground">Keep this page open while you scan. The code refreshes when the service creates a new one.</p>
                            </div>
                        )}

                        {session?.lastError && (
                            <Alert variant="destructive">
                                <CircleAlert className="h-4 w-4" aria-hidden="true" />
                                <AlertTitle>Connection needs attention</AlertTitle>
                                <AlertDescription>{session.lastError}</AlertDescription>
                            </Alert>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <Button type="button" className="min-h-11" onClick={primaryAction.run} disabled={Boolean(busyAction)}>
                                {busyAction === primaryAction.name ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : primaryAction.name === "connect" ? <QrCode className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                {primaryAction.label}
                            </Button>
                            {session && (
                                <Button type="button" variant="outline" className="min-h-11" onClick={() => runAction("disconnect", disconnectWhatsAppWebBridge, "Phone disconnected")} disabled={Boolean(busyAction)}>
                                    <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />Disconnect
                                </Button>
                            )}
                            {session && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busyAction)}>Forget this phone</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Forget this phone?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This removes the saved WhatsApp pairing from this location. To connect again, you will need to scan a new QR code from the phone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Keep phone</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => runAction("forget", clearWhatsAppWebBridge, "Saved phone pairing removed")} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                Forget this phone
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Collapsible open={technicalOpen} onOpenChange={setTechnicalOpen}>
                <Card>
                    <CollapsibleTrigger asChild>
                        <Button type="button" variant="ghost" className="min-h-11 w-full justify-between rounded-b-none px-6" aria-expanded={technicalOpen}>
                            Technical details
                            <ChevronDown className={`h-4 w-4 transition-transform ${technicalOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <CardContent className="grid gap-3 border-t pt-5 text-sm sm:grid-cols-2">
                            <div><span className="font-medium">Database status:</span> {diagnostics?.dbStatus || session?.status || "not created"}</div>
                            <div><span className="font-medium">Service reachable:</span> {diagnostics?.reachable ? "yes" : "no"}</div>
                            <div><span className="font-medium">Worker status:</span> {diagnostics?.workerStatus || "not registered"}</div>
                            <div><span className="font-medium">Worker ready:</span> {diagnostics?.workerReady ? "yes" : "no"}</div>
                            <div><span className="font-medium">Session count:</span> {diagnostics?.sessionCount ?? "unknown"}</div>
                            <div><span className="font-medium">Protocol timeout:</span> {diagnostics?.protocolTimeoutMs ? `${diagnostics.protocolTimeoutMs}ms` : "unknown"}</div>
                            {diagnostics?.message && <div className="sm:col-span-2"><span className="font-medium">Diagnostic:</span> {diagnostics.message}</div>}
                            {diagnostics?.baseUrl && <div className="break-all sm:col-span-2"><span className="font-medium">Service URL:</span> {diagnostics.baseUrl}</div>}
                            {diagnostics?.sessionDir && <div className="break-all sm:col-span-2"><span className="font-medium">Session directory:</span> {diagnostics.sessionDir}</div>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>
        </div>
    );
}
