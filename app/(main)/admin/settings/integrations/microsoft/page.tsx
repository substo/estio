"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Eye, EyeOff, Activity, Clock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConnectionStatus {
    connected: boolean;
    method: 'oauth' | 'puppeteer' | null;
    email?: string;
    sessionExpiry?: string;
    sessionExpired?: boolean;
    recoverableSession?: boolean;
    renewing?: boolean;
    autoRenewThrottled?: boolean;
    autoRenewRetryAt?: string | null;
    autoRenewLastAttemptAt?: string | null;
    autoRenewLastAttemptMode?: 'auto' | 'manual' | null;
    autoRenewLastSuccessAt?: string | null;
    autoRenewLastError?: string | null;
    autoRenewLastErrorAt?: string | null;
    lastSyncedAt?: string;
    syncEnabled?: boolean;
}

async function parseApiResponse<T = any>(res: Response): Promise<T> {
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();

    if (!contentType.toLowerCase().includes('application/json')) {
        const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
        const htmlHint = raw.trimStart().startsWith('<')
            ? 'The server returned an HTML error page (often a proxy timeout while a long sync is still running).'
            : (snippet || `HTTP ${res.status}`);
        throw new Error(`Unexpected non-JSON response (HTTP ${res.status}). ${htmlHint}`);
    }

    try {
        return JSON.parse(raw) as T;
    } catch {
        throw new Error(`Invalid JSON response from server (HTTP ${res.status}).`);
    }
}

export default function MicrosoftIntegrationPage() {
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<ConnectionStatus>({ connected: false, method: null });
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    useEffect(() => {
        if (!status.renewing) return;
        const timer = window.setTimeout(() => {
            checkStatus({ showLoading: false });
        }, 4000);
        return () => window.clearTimeout(timer);
    }, [status.renewing]);

    useEffect(() => {
        if (searchParams.get('microsoft_connected') === 'true') {
            setSuccess('Successfully connected to Outlook!');
        }
    }, [searchParams]);

    const handleSyncNow = async () => {
        setSyncing(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await fetch('/api/microsoft/sync', { method: 'POST' });
            const data = await parseApiResponse<any>(res);

            if (res.ok && data.success) {
                setSuccess(data.message || 'Sync completed successfully!');
                await checkStatus(); // Refresh stats
            } else {
                setError(data.error || `Failed to sync (HTTP ${res.status})`);
            }
        } catch (err: any) {
            setError(err.message || 'Error occurred during sync');
        } finally {
            setSyncing(false);
        }
    };

    const handleRenewSession = async () => {
        setSyncing(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await fetch('/api/microsoft/renew-session', { method: 'POST' });
            const data = await parseApiResponse<any>(res);

            if (res.ok && data.success) {
                setSuccess(data.message || 'Outlook session renewed successfully!');
                await checkStatus();
            } else if (res.status === 202 && data.renewing) {
                setSuccess(data.message || 'Outlook session renewal is already in progress...');
                await checkStatus({ showLoading: false });
            } else {
                setError(data.error || `Failed to renew session (HTTP ${res.status})`);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to renew Outlook session');
        } finally {
            setSyncing(false);
        }
    };

    const checkStatus = async (options?: { showLoading?: boolean }) => {
        try {
            if (options?.showLoading !== false) {
                setLoading(true);
            }
            const res = await fetch('/api/microsoft/puppeteer-auth', { cache: 'no-store' });
            const data = await parseApiResponse<ConnectionStatus | { error?: string }>(res);
            if (!res.ok) {
                throw new Error((data as any)?.error || `Failed to check status (HTTP ${res.status})`);
            }
            setStatus(data as ConnectionStatus);
        } catch (err) {
            console.error('Failed to check status:', err);
        } finally {
            if (options?.showLoading !== false) {
                setLoading(false);
            }
        }
    };

    const handleBrowserLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setConnecting(true);

        try {
            const res = await fetch('/api/microsoft/puppeteer-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await parseApiResponse<any>(res);

            if (res.ok && data.success) {
                setSuccess('Successfully connected to Outlook!');
                setPassword(''); // Clear password from form
                await checkStatus();
            } else {
                setError(data.error || `Failed to connect (HTTP ${res.status})`);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to connect');
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnectClick = () => {
        setShowDisconnectDialog(true);
    };

    const confirmDisconnect = async () => {
        try {
            const res = await fetch('/api/microsoft/puppeteer-auth', { method: 'DELETE' });
            const data = await parseApiResponse<any>(res);
            if (!res.ok || !data.success) {
                throw new Error(data.error || `Failed to disconnect (HTTP ${res.status})`);
            }
            setSuccess('Disconnected from Outlook');
            setStatus({ connected: false, method: null });
        } catch (err: any) {
            setError(err.message || 'Failed to disconnect');
        } finally {
            setShowDisconnectDialog(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Outlook / Microsoft Sync</h1>
                <p className="text-muted-foreground">
                    Connect your Microsoft account (Personal or Work) to sync Contacts and Emails.
                </p>
            </div>

            {success && (
                <div className="rounded-md bg-green-50 p-4 text-green-700 dark:bg-green-900/10 dark:text-green-400">
                    <div className="flex items-center">
                        <CheckCircle2 className="mr-2 h-5 w-5" />
                        <p>{success}</p>
                    </div>
                </div>
            )}

            {error && (
                <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900/10 dark:text-red-400">
                    <div className="flex items-center">
                        <AlertTriangle className="mr-2 h-5 w-5" />
                        <p>{error}</p>
                    </div>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Connection Status</CardTitle>
                        <CardDescription>
                            Current connection to Microsoft Outlook.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="flex items-center space-x-3">
                                {status.renewing ? (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/20">
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                    </div>
                                ) : status.connected ? (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/20">
                                        <CheckCircle2 className="h-6 w-6" />
                                    </div>
                                ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">
                                        <XCircle className="h-6 w-6" />
                                    </div>
                                )}
                                <div>
                                    <p className="font-medium">
                                        {status.renewing ? 'Renewing Session' : (status.connected ? 'Connected' : 'Not Connected')}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {status.renewing
                                            ? 'Attempting automatic Outlook session renewal in the background...'
                                            : status.connected
                                            ? `Connected as ${status.email || 'Unknown'} (${status.method})`
                                            : 'Connect to start syncing.'
                                        }
                                    </p>
                                    {status.sessionExpired && (
                                        <p className="text-sm text-orange-600 dark:text-orange-400 mt-1 flex items-center gap-1">
                                            {status.renewing ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <AlertTriangle className="h-3 w-3" />
                                            )}
                                            {status.method === 'puppeteer' && status.recoverableSession
                                                ? status.renewing
                                                    ? 'Session expired - renewing automatically...'
                                                    : status.autoRenewThrottled && status.autoRenewRetryAt
                                                        ? `Session expired - next auto-renew retry ${formatDistanceToNow(new Date(status.autoRenewRetryAt), { addSuffix: true })}`
                                                        : 'Session expired - auto-renew can be attempted'
                                                : 'Session expired - please reconnect'}
                                        </p>
                                    )}
                                    {!status.renewing && status.autoRenewLastError && status.sessionExpired && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            Last auto-renew attempt failed
                                            {status.autoRenewLastErrorAt
                                                ? ` ${formatDistanceToNow(new Date(status.autoRenewLastErrorAt), { addSuffix: true })}`
                                                : ''}.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {status.connected && (
                            <Button
                                variant="destructive"
                                className="w-full"
                                onClick={handleDisconnectClick}
                            >
                                Disconnect
                            </Button>
                        )}
                    </CardContent>
                </Card>

                {/* New Sync Health Dashboard */}
                {status.connected && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <div className="space-y-1">
                                <CardTitle>Sync Health</CardTitle>
                                <CardDescription>
                                    Real-time status of your inbox synchronization.
                                </CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSyncNow}
                                disabled={syncing || status.renewing || !status.syncEnabled}
                            >
                                {syncing ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <Activity className="mr-2 h-4 w-4" />
                                        Sync Now
                                    </>
                                )}
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4">
                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                                    <Activity className="h-5 w-5 text-blue-500" />
                                    <div>
                                        <p className="text-sm font-medium">Last Inbox Sync</p>
                                        <p className="text-xs text-muted-foreground">
                                            {status.lastSyncedAt
                                                ? formatDistanceToNow(new Date(status.lastSyncedAt), { addSuffix: true })
                                                : 'Pending initial sync...'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                                    <ShieldCheck className="h-5 w-5 text-purple-500" />
                                    <div>
                                        <p className="text-sm font-medium">Session Status</p>
                                        <p className="text-xs text-muted-foreground">
                                            {status.renewing
                                                ? 'Automatic session renewal in progress...'
                                                : status.sessionExpiry
                                                ? `Expires ${formatDistanceToNow(new Date(status.sessionExpiry), { addSuffix: true })}`
                                                : 'Unknown expiry'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                                    <Clock className="h-5 w-5 text-green-500" />
                                    <div>
                                        <p className="text-sm font-medium">Auto-Sync</p>
                                        <p className="text-xs text-muted-foreground">
                                            {status.syncEnabled ? 'Active (Every 5 mins)' : 'Paused'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {!status.connected && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Connect Account</CardTitle>
                            <CardDescription>
                                Choose how to connect your Microsoft account.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {status.method === 'puppeteer' && status.sessionExpired && status.recoverableSession && (
                                <div className="mb-4 rounded-md bg-amber-50 p-3 text-amber-700 text-sm dark:bg-amber-900/10 dark:text-amber-400">
                                    {status.renewing
                                        ? 'Automatic session renewal is in progress. This page will refresh status automatically.'
                                        : 'Your stored Outlook credentials are available. Automatic renewal is attempted in the background before reconnecting manually.'}
                                    {status.autoRenewThrottled && status.autoRenewRetryAt && !status.renewing && (
                                        <div className="mt-2 text-xs">
                                            Next automatic retry {formatDistanceToNow(new Date(status.autoRenewRetryAt), { addSuffix: true })}.
                                        </div>
                                    )}
                                    {status.autoRenewLastError && !status.renewing && (
                                        <div className="mt-2 text-xs">
                                            Last auto-renew error: {status.autoRenewLastError}
                                        </div>
                                    )}
                                    <div className="mt-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleRenewSession}
                                            disabled={syncing || status.renewing}
                                        >
                                            {syncing || status.renewing ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    {status.renewing ? 'Renewing automatically...' : 'Renewing...'}
                                                </>
                                            ) : (
                                                'Try Auto-Renew Now'
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <Tabs defaultValue="browser" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="browser">Browser Login</TabsTrigger>
                                    <TabsTrigger value="oauth">OAuth (Standard)</TabsTrigger>
                                </TabsList>

                                <TabsContent value="oauth" className="space-y-4 pt-4">
                                    <p className="text-sm text-muted-foreground">
                                        Standard Microsoft OAuth login. Works if your organization allows app registrations.
                                    </p>
                                    <Button asChild className="w-full">
                                        <Link href="/api/microsoft/auth">
                                            Connect with Microsoft
                                        </Link>
                                    </Button>
                                    <p className="text-xs text-center text-muted-foreground">
                                        Redirects to Microsoft's secure login page.
                                    </p>
                                </TabsContent>

                                <TabsContent value="browser" className="space-y-4 pt-4">
                                    <div className="rounded-md bg-amber-50 p-3 text-amber-700 text-sm dark:bg-amber-900/10 dark:text-amber-400">
                                        <strong>Alternative Method:</strong> Use this if your organization blocks OAuth app registrations.
                                        Your credentials are encrypted and stored securely.
                                    </div>

                                    <form onSubmit={handleBrowserLogin} className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="email">Microsoft Email</Label>
                                            <Input
                                                id="email"
                                                type="email"
                                                placeholder="you@outlook.com"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                required
                                                disabled={connecting}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="password">Password</Label>
                                            <div className="relative">
                                                <Input
                                                    id="password"
                                                    type={showPassword ? "text" : "password"}
                                                    placeholder="••••••••"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    required
                                                    disabled={connecting}
                                                    className="pr-10"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>

                                        <Button
                                            type="submit"
                                            className="w-full"
                                            disabled={connecting || !email || !password}
                                        >
                                            {connecting ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Connecting...
                                                </>
                                            ) : (
                                                'Connect via Browser Login'
                                            )}
                                        </Button>
                                    </form>

                                    <p className="text-xs text-center text-muted-foreground">
                                        Note: Accounts with MFA/2FA enabled are not supported.
                                    </p>
                                </TabsContent>
                            </Tabs>
                        </CardContent>
                    </Card>
                )}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Sync Features</CardTitle>
                    <CardDescription>
                        What gets synchronized with your Outlook account.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        <li><strong>Email Sync:</strong> Inbox and Sent Items are synced to your conversations.</li>
                        <li><strong>Contact Sync:</strong> Contacts are synced bidirectionally with "Visual ID" caller display.</li>
                        <li><strong>Real-time:</strong> Changes are pushed instantly (OAuth mode) or polled periodically (Browser mode).</li>
                    </ul>
                </CardContent>
            </Card>

            <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect Outlook?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to disconnect your Outlook account? This will stop all email and contact synchronization. You will need to re-enter your credentials to reconnect.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDisconnect}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            Disconnect
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
