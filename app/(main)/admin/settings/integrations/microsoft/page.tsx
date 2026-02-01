"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

interface ConnectionStatus {
    connected: boolean;
    method: 'oauth' | 'puppeteer' | null;
    email?: string;
    sessionExpiry?: string;
    sessionExpired?: boolean;
}

export default function MicrosoftIntegrationPage() {
    const [status, setStatus] = useState<ConnectionStatus>({ connected: false, method: null });
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/microsoft/puppeteer-auth');
            const data = await res.json();
            setStatus(data);
        } catch (err) {
            console.error('Failed to check status:', err);
        } finally {
            setLoading(false);
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

            const data = await res.json();

            if (data.success) {
                setSuccess('Successfully connected to Outlook!');
                setPassword(''); // Clear password from form
                await checkStatus();
            } else {
                setError(data.error || 'Failed to connect');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to connect');
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect your Outlook account?')) return;

        try {
            await fetch('/api/microsoft/puppeteer-auth', { method: 'DELETE' });
            setSuccess('Disconnected from Outlook');
            setStatus({ connected: false, method: null });
        } catch (err: any) {
            setError(err.message || 'Failed to disconnect');
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
                                {status.connected ? (
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
                                        {status.connected ? 'Connected' : 'Not Connected'}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {status.connected
                                            ? `Connected as ${status.email || 'Unknown'} (${status.method})`
                                            : 'Connect to start syncing.'
                                        }
                                    </p>
                                    {status.sessionExpired && (
                                        <p className="text-sm text-orange-600 dark:text-orange-400">
                                            Session expired - please reconnect
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {status.connected && (
                            <Button
                                variant="destructive"
                                className="w-full"
                                onClick={handleDisconnect}
                            >
                                Disconnect
                            </Button>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Connect Account</CardTitle>
                        <CardDescription>
                            Choose how to connect your Microsoft account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs defaultValue="browser" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="oauth">OAuth (Standard)</TabsTrigger>
                                <TabsTrigger value="browser">Browser Login</TabsTrigger>
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
        </div>
    );
}
