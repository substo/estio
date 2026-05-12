'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { getWhatsAppWebBridgeStatus, getEmailSyncProvidersStatus, triggerWhatsAppWebBridgeConnection } from '../actions';
import { Loader2, RefreshCw, QrCode as QrIcon, WifiOff } from 'lucide-react';
import { SiGmail, SiMicrosoftoutlook } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { toast } from '@/components/ui/use-toast';

type ProviderHealth = 'healthy' | 'warning' | 'stale' | 'error';

type EmailProviderStatus = {
    provider: 'gmail' | 'outlook';
    configured?: boolean;
    connected: boolean;
    health: ProviderHealth;
    email?: string | null;
    method?: 'oauth' | 'puppeteer' | null;
    lastSyncedAt?: string | null;
    expectedCadenceMinutes?: number;
    watchExpiration?: string | null;
    watchExpired?: boolean;
    sessionExpiry?: string | null;
    sessionExpired?: boolean;
    canAutoReconnect?: boolean;
    subscriptionExpiry?: string | null;
    subscriptionExpired?: boolean;
    settingsPath: string;
};

function healthDotClass(health: ProviderHealth) {
    if (health === 'healthy') return 'bg-green-500';
    if (health === 'warning') return 'bg-amber-500';
    if (health === 'stale') return 'bg-orange-500';
    return 'bg-red-500';
}

function healthLabel(health: ProviderHealth) {
    if (health === 'healthy') return 'Healthy';
    if (health === 'warning') return 'Warning';
    if (health === 'stale') return 'Stale';
    return 'Action needed';
}

function EmailProviderBadge({ provider }: { provider: EmailProviderStatus }) {
    const lastSyncDate = provider.lastSyncedAt ? new Date(provider.lastSyncedAt) : null;
    const watchExpiryDate = provider.watchExpiration ? new Date(provider.watchExpiration) : null;
    const sessionExpiryDate = provider.sessionExpiry ? new Date(provider.sessionExpiry) : null;
    const subscriptionExpiryDate = provider.subscriptionExpiry ? new Date(provider.subscriptionExpiry) : null;

    return (
        <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
                <Link
                    href={provider.settingsPath}
                    className="relative inline-flex h-6 w-6 items-center justify-center rounded border bg-white text-gray-600 hover:bg-slate-50 hover:text-gray-900 shrink-0"
                    aria-label={`${provider.provider} sync status`}
                >
                    {provider.provider === 'gmail' ? (
                        <SiGmail className="h-3.5 w-3.5" />
                    ) : (
                        <SiMicrosoftoutlook className="h-3.5 w-3.5" />
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white ${healthDotClass(provider.health)}`} />
                </Link>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="start" className="w-72 p-3">
                <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm">
                            {provider.provider === 'gmail' ? 'Gmail Sync' : 'Outlook Sync'}
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            provider.health === 'healthy'
                                ? 'bg-green-50 text-green-700'
                                : provider.health === 'warning'
                                    ? 'bg-amber-50 text-amber-700'
                                    : provider.health === 'stale'
                                        ? 'bg-orange-50 text-orange-700'
                                        : 'bg-red-50 text-red-700'
                        }`}>
                            {healthLabel(provider.health)}
                        </span>
                    </div>

                    {provider.email && (
                        <div className="text-muted-foreground truncate">{provider.email}</div>
                    )}

                    {provider.provider === 'outlook' && provider.method && (
                        <div>
                            <span className="text-muted-foreground">Method: </span>
                            <span className="font-medium uppercase">{provider.method}</span>
                        </div>
                    )}

                    <div>
                        <div className="text-muted-foreground">Last email sync</div>
                        <div className="font-medium">
                            {lastSyncDate
                                ? formatDistanceToNow(lastSyncDate, { addSuffix: true })
                                : 'No successful sync yet'}
                        </div>
                        {lastSyncDate && (
                            <div className="text-muted-foreground">{format(lastSyncDate, 'PPp')}</div>
                        )}
                    </div>

                    {provider.expectedCadenceMinutes ? (
                        <div className="text-muted-foreground">
                            Expected cadence: ~every {provider.expectedCadenceMinutes} min
                        </div>
                    ) : null}

                    {provider.provider === 'gmail' && watchExpiryDate && (
                        <div className={provider.watchExpired ? 'text-amber-700' : 'text-muted-foreground'}>
                            Gmail watch {provider.watchExpired ? 'expired' : 'expires'} {formatDistanceToNow(watchExpiryDate, { addSuffix: true })}
                        </div>
                    )}

                    {provider.provider === 'outlook' && provider.method === 'puppeteer' && sessionExpiryDate && (
                        <div className={provider.sessionExpired ? 'text-red-700' : 'text-muted-foreground'}>
                            Session {provider.sessionExpired ? 'expired' : 'expires'} {formatDistanceToNow(sessionExpiryDate, { addSuffix: true })}
                        </div>
                    )}

                    {provider.provider === 'outlook' && provider.method === 'puppeteer' && provider.sessionExpired && provider.canAutoReconnect && (
                        <div className="text-muted-foreground">
                            Stored credentials available. Next sync can attempt automatic re-login.
                        </div>
                    )}

                    {provider.provider === 'outlook' && provider.method === 'oauth' && subscriptionExpiryDate && (
                        <div className={provider.subscriptionExpired ? 'text-amber-700' : 'text-muted-foreground'}>
                            Webhook subscription {provider.subscriptionExpired ? 'expired' : 'expires'} {formatDistanceToNow(subscriptionExpiryDate, { addSuffix: true })}
                        </div>
                    )}

                    <div className="pt-1">
                        <Link href={provider.settingsPath} className="text-blue-600 hover:underline">
                            Open integration settings
                        </Link>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

export function WhatsAppStatus() {
    const [status, setStatus] = useState<string>('checking');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [emailProviders, setEmailProviders] = useState<EmailProviderStatus[]>([]);
    const [provider, setProvider] = useState<'web_bridge' | 'evolution'>('web_bridge');
    const [phone, setPhone] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);

    const checkStatus = async () => {
        if (loading) return; // Prevent double fetch
        // Don't show global loading spinner for background polls unless it's initial
        if (status === 'checking') setLoading(true);

        try {
            const res = await getWhatsAppWebBridgeStatus();
            setProvider(res.provider === 'evolution' ? 'evolution' : 'web_bridge');
            setStatus(res.status);
            setQrCode(res.qrcode);
            setPhone(res.phone || null);
            setStatusError(res.error || null);
        } catch (e) {
            console.error(e);
            setStatus('ERROR');
            setStatusError('Unable to check WhatsApp status.');
        } finally {
            setLoading(false);
        }
    };

    const checkEmailProviders = async () => {
        try {
            const res = await getEmailSyncProvidersStatus();
            setEmailProviders((res?.providers || []) as EmailProviderStatus[]);
        } catch (e) {
            console.error('[WhatsAppStatus] Failed to load email provider status', e);
        }
    };

    const handleRefresh = async () => {
        await Promise.allSettled([checkStatus(), checkEmailProviders()]);
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setDialogOpen(true); // Open dialog immediately to show loading state
        try {
            const res = await triggerWhatsAppWebBridgeConnection();
            if (res.success) {
                setProvider(res.provider === 'evolution' ? 'evolution' : 'web_bridge');
                if (res.qrCode) {
                    setQrCode(res.qrCode);
                }
                if (res.status !== 'qrcode') {
                    toast({ title: "Connecting...", description: "Requesting WhatsApp linked-device QR code..." });
                }
                checkStatus();
            } else {
                toast({ title: "Error", description: res.error || "Failed to start connection", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to start connection", variant: "destructive" });
        } finally {
            setIsConnecting(false);
        }
    };

    useEffect(() => {
        checkStatus();
        const pollTime = (qrCode || ['starting', 'qr', 'authenticated', 'connecting', 'qrcode'].includes(status)) ? 3000 : 30000;
        const interval = setInterval(checkStatus, pollTime);
        return () => clearInterval(interval);
    }, [qrCode, status]);

    useEffect(() => {
        checkEmailProviders();
        const interval = setInterval(checkEmailProviders, 60000);
        return () => clearInterval(interval);
    }, []);

    const isConnected = status === 'ready' || status === 'open' || status === 'connected';
    const isError = status === 'ERROR' || status === 'NOT_FOUND' || status === 'close' || status === 'failed' || status === 'disconnected';
    const statusLabel = isConnected
        ? 'Online'
        : status === 'checking'
            ? 'Checking...'
            : ['starting', 'qr', 'authenticated', 'connecting', 'qrcode'].includes(status)
                ? 'Connecting'
                : 'Offline';
    const visibleEmailProviders = emailProviders.filter((provider) => provider.connected || provider.configured);

    return (
        <div className="flex items-center gap-2 text-xs px-2 py-1 bg-slate-50 border-b">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />

            <span className="text-gray-500 font-medium truncate min-w-0">
                {statusLabel}
            </span>
            {provider === 'evolution' && (
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shrink-0">
                    Legacy
                </span>
            )}

            {visibleEmailProviders.length > 0 && (
                <div className="flex items-center gap-1 ml-1 shrink-0">
                    {visibleEmailProviders.map((provider) => (
                        <EmailProviderBadge key={provider.provider} provider={provider} />
                    ))}
                </div>
            )}

            {/* Refresh Button */}
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-600 shrink-0" onClick={handleRefresh} disabled={loading}>
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>

            {/* Connect Button (Offline) */}
            {!isConnected && (
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] px-2 gap-1 border-red-200 text-red-600 hover:bg-red-50 shrink-0"
                            onClick={() => {
                                if (!qrCode) handleConnect();
                            }}
                        >
                            {qrCode ? <QrIcon className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                            {qrCode ? "Scan QR" : "Connect"}
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Connect WhatsApp</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col items-center justify-center p-4 space-y-4">
                            <p className="text-sm text-gray-500 text-center">
                                Open WhatsApp on your phone, go to <strong>Linked Devices</strong>, and scan this code.
                                {provider === 'web_bridge' && phone ? (
                                    <span className="mt-1 block text-xs">Connected phone: {phone}</span>
                                ) : null}
                            </p>

                            {qrCode ? (
                                <div className="border-4 border-white shadow-lg rounded-lg overflow-hidden relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                                        alt="WhatsApp QR Code"
                                        className="w-64 h-64"
                                    />
                                    {isConnecting && (
                                        <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                                            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="w-64 h-64 flex flex-col items-center justify-center bg-gray-50 rounded-lg border border-dashed">
                                    {isConnecting ? (
                                        <>
                                            <Loader2 className="w-8 h-8 animate-spin text-purple-600 mb-2" />
                                            <p className="text-xs text-gray-400">Generating QR...</p>
                                        </>
                                    ) : (
                                        <Button onClick={handleConnect}>Generate QR Code</Button>
                                    )}
                                </div>
                            )}
                            {statusError && (
                                <p className="max-w-xs text-center text-xs text-red-600">{statusError}</p>
                            )}

                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
                                    <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                    Check Status
                                </Button>
                                {qrCode && (
                                    <Button variant="ghost" size="sm" onClick={handleConnect} disabled={isConnecting}>
                                        Regenerate
                                    </Button>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
