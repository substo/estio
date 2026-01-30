'use client';

import { useState, useEffect } from 'react';
import { getEvolutionStatus, triggerWhatsAppConnection } from '../actions';
import { Loader2, RefreshCw, QrCode as QrIcon, CheckCircle, AlertCircle, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from '@/components/ui/use-toast';

export function WhatsAppStatus() {
    const [status, setStatus] = useState<string>('checking');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    const checkStatus = async () => {
        if (loading) return; // Prevent double fetch
        // Don't show global loading spinner for background polls unless it's initial
        if (status === 'checking') setLoading(true);

        try {
            const res = await getEvolutionStatus();
            setStatus(res.status);
            setQrCode(res.qrcode);

            // If we have a QR code, open dialog automatically if we were connecting?
            // Maybe not automatically, but update the state.
        } catch (e) {
            console.error(e);
            setStatus('ERROR');
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setDialogOpen(true); // Open dialog immediately to show loading state
        try {
            const res = await triggerWhatsAppConnection();
            if (res.success) {
                if (res.qrCode) {
                    setQrCode(res.qrCode);
                }
                // Determine status to show
                if (res.status === 'qrcode') {
                    // QR Code is ready
                } else {
                    // Still connecting...
                    toast({ title: "Connecting...", description: "Requesting QR Code from WhatsApp..." });
                }
                // Trigger a status check
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
        // Poll every 10 seconds normally, but every 3 seconds if we have a QR code displayed to check for scan
        const pollTime = (qrCode || status === 'connecting') ? 3000 : 30000;
        const interval = setInterval(checkStatus, pollTime);
        return () => clearInterval(interval);
    }, [qrCode, status]);

    const isConnected = status === 'open' || status === 'connected';
    const isError = status === 'ERROR' || status === 'NOT_FOUND' || status === 'close';

    return (
        <div className="flex items-center gap-2 text-xs px-2 py-1 bg-slate-50 border-b">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />

            <span className="text-gray-500 font-medium truncate min-w-0">
                {isConnected ? 'Online' : status === 'checking' ? 'Checking...' : 'Offline'}
            </span>



            {/* Refresh Button */}
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-600 shrink-0" onClick={checkStatus} disabled={loading}>
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
                                // If we already have a QR code, just opening the dialog is enough (handled by DialogTrigger)
                                // If we assume we need to trigger connection if plain offline:
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

                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={checkStatus} disabled={loading}>
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
