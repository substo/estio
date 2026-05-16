'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { getWhatsAppWebBridgeStatus, getEmailSyncProvidersStatus, triggerWhatsAppWebBridgeConnection } from '../actions';
import { CheckCircle2, Loader2, RefreshCw, QrCode as QrIcon, Smartphone, WifiOff } from 'lucide-react';
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
    const statusPollInFlightRef = useRef(false);

    const applyWhatsAppStatus = (res: Awaited<ReturnType<typeof getWhatsAppWebBridgeStatus>>) => {
        const nextStatus = String(res.status || 'disconnected');
        const connected = nextStatus === 'ready' || nextStatus === 'open' || nextStatus === 'connected';

        setProvider(res.provider === 'evolution' ? 'evolution' : 'web_bridge');
        setStatus(nextStatus);
        setQrCode(connected ? null : res.qrcode);
        setPhone(res.phone || null);
        setStatusError(connected ? null : (res.error || null));
        setIsConnecting(false);

        if (connected) {
            setDialogOpen(false);
        }

        return connected;
    };

    const checkStatus = async (options?: { foreground?: boolean }) => {
        if (statusPollInFlightRef.current) return false;
        statusPollInFlightRef.current = true;
        if (options?.foreground || status === 'checking') setLoading(true);

        try {
            const res = await getWhatsAppWebBridgeStatus();
            return applyWhatsAppStatus(res);
        } catch (e) {
            console.error(e);
            setStatus('ERROR');
            setStatusError('Unable to check WhatsApp status.');
            return false;
        } finally {
            setLoading(false);
            statusPollInFlightRef.current = false;
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
        await Promise.allSettled([checkStatus({ foreground: true }), checkEmailProviders()]);
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setDialogOpen(true); // Open dialog immediately to show loading state
        try {
            const res = await triggerWhatsAppWebBridgeConnection();
            if (res.success) {
                setProvider(res.provider === 'evolution' ? 'evolution' : 'web_bridge');
                const connected = res.status === 'ready' || res.status === 'open' || res.status === 'connected';
                if (connected) {
                    setStatus(res.status);
                    setQrCode(null);
                    setStatusError(null);
                    setDialogOpen(false);
                    return;
                }
                if (res.qrCode) {
                    setQrCode(res.qrCode);
                }
                setStatus(res.status || 'starting');
                setStatusError(res.error || null);
                if (res.status !== 'qrcode') {
                    toast({ title: "Connecting...", description: "Requesting WhatsApp linked-device QR code..." });
                }
                await checkStatus();
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
        void checkStatus();
        const shouldPollFast = dialogOpen || qrCode || ['starting', 'qr', 'authenticated', 'connecting', 'qrcode', 'loading', 'restarting', 'reconnecting'].includes(status);
        const pollTime = shouldPollFast ? 1500 : 30000;
        const interval = setInterval(checkStatus, pollTime);
        return () => clearInterval(interval);
    }, [dialogOpen, qrCode, status]);

    useEffect(() => {
        checkEmailProviders();
        const interval = setInterval(checkEmailProviders, 60000);
        return () => clearInterval(interval);
    }, []);

    const isConnected = status === 'ready' || status === 'open' || status === 'connected';
    const isError = status === 'ERROR' || status === 'NOT_FOUND' || status === 'close' || status === 'failed' || status === 'disconnected';
    const isAwaitingScan = !!qrCode && ['qr', 'qrcode'].includes(status);
    const isPairing = ['authenticated', 'starting', 'connecting', 'loading', 'restarting', 'reconnecting'].includes(status) || (dialogOpen && !isConnected && !isAwaitingScan && !!qrCode);
    const statusLabel = isConnected
        ? 'Online'
        : status === 'checking'
            ? 'Checking...'
            : ['starting', 'qr', 'authenticated', 'connecting', 'qrcode', 'loading', 'restarting', 'reconnecting'].includes(status)
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
                            <div className="w-full rounded-md border bg-slate-50 p-3">
                                <div className="flex items-start gap-3">
                                    <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${
                                        isPairing ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        {isPairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-slate-900">
                                            {isPairing ? 'Finishing WhatsApp connection' : 'Scan with WhatsApp'}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-slate-600">
                                            {isPairing
                                                ? 'WhatsApp accepted the scan. Keep this window open while Estio confirms the linked device. This can take up to a minute.'
                                                : <>Open WhatsApp on your phone, go to <strong>Linked Devices</strong>, and scan this code.</>}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-slate-500">
                                            Do not remove the active Estio linked device. Remove old duplicate Estio linked devices only if WhatsApp says the linked-device limit is reached.
                                        </p>
                                        {provider === 'web_bridge' && phone ? (
                                            <p className="mt-1 text-xs text-slate-500">Connected phone: {phone}</p>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {qrCode ? (
                                <div className="border-4 border-white shadow-lg rounded-lg overflow-hidden relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                                        alt="WhatsApp QR Code"
                                        className={`w-64 h-64 transition-opacity ${isPairing ? 'opacity-20' : 'opacity-100'}`}
                                    />
                                    {(isConnecting || isPairing) && (
                                        <div className="absolute inset-0 bg-white/75 flex flex-col items-center justify-center text-center">
                                            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                                            <p className="mt-3 max-w-40 text-xs font-medium text-slate-700">
                                                {isPairing ? 'Pairing device...' : 'Preparing QR...'}
                                            </p>
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
                            <div className="flex w-full max-w-xs items-center justify-between rounded-md border bg-white px-3 py-2 text-xs">
                                <div className="flex items-center gap-2">
                                    {isAwaitingScan ? (
                                        <QrIcon className="h-3.5 w-3.5 text-slate-500" />
                                    ) : isPairing ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                                    ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                    )}
                                    <span className="font-medium text-slate-700">
                                        {isAwaitingScan ? 'Waiting for scan' : isPairing ? 'Confirming connection' : statusLabel}
                                    </span>
                                </div>
                                <span className="text-slate-400">{status}</span>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
                                    <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                    Check Status
                                </Button>
                                {qrCode && (
                                    <Button variant="ghost" size="sm" onClick={handleConnect} disabled={isConnecting || isPairing}>
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
