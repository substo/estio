'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CloudDownload, Loader2, CheckCircle2, AlertCircle, MessageCircle, Users, Activity, StopCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface SyncResult {
    success: boolean;
    error?: string;
    chatsProcessed?: number;
    totalChats?: number;
    messagesImported?: number;
    messagesSkipped?: number;
    errors?: number;
}

interface SyncAllChatsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

export function SyncAllChatsDialog({ open, onOpenChange, onComplete }: SyncAllChatsDialogProps) {
    const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error' | 'stopped'>('idle');
    const [result, setResult] = useState<SyncResult | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [isFullSync, setIsFullSync] = useState(false);

    // Live Progress State
    const [currentChat, setCurrentChat] = useState<string>('');
    const [progress, setProgress] = useState(0); // 0-100
    const [stats, setStats] = useState({
        processed: 0,
        total: 0,
        imported: 0,
        skipped: 0
    });

    const handleSync = async () => {
        setStatus('syncing');
        setResult(null);
        setStats({ processed: 0, total: 0, imported: 0, skipped: 0 });
        setProgress(0);
        setCurrentChat('');

        try {
            const controller = new AbortController();
            abortControllerRef.current = controller;

            const query = isFullSync ? '?full=true' : '';
            const response = await fetch(`/api/whatsapp/sync${query}`, {
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Keep the last partial line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const data = JSON.parse(line);

                        switch (data.type) {
                            case 'start':
                                setStats(prev => ({ ...prev, total: data.total }));
                                break;

                            case 'progress':
                                setCurrentChat(data.name || data.phone);
                                setStats(prev => {
                                    const next = {
                                        ...prev,
                                        processed: data.chatIndex,
                                        imported: prev.imported + (data.imported || 0),
                                        skipped: prev.skipped + (data.skipped || 0)
                                    };
                                    // Update progress calculation
                                    if (next.total > 0) {
                                        setProgress(Math.round((next.processed / next.total) * 100));
                                    }
                                    return next;
                                });
                                break;

                            case 'done':
                                setResult({
                                    success: true,
                                    ...data.stats,
                                    totalChats: stats.total // ensure total is preserved
                                });
                                setStatus('done');
                                onComplete?.();
                                break;

                            case 'error':
                                throw new Error(data.message);
                        }
                    } catch (e: any) {
                        console.error("Error parsing sync stream:", e);
                        if (line.includes('"type":"error"')) {
                            const match = line.match(/"message":"([^"]+)"/);
                            if (match) throw new Error(match[1]);
                        }
                    }
                }
            }

        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.log('Sync stopped by user');
                setStatus('stopped');
                return;
            }
            console.error("Sync failed:", err);
            setResult({ success: false, error: err.message || 'Unknown error' });
            setStatus('error');
        } finally {
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        abortControllerRef.current?.abort();
    };

    const handleClose = () => {
        if (status === 'syncing') {
            handleStop(); // Stop sync first, then close
        }
        setStatus('idle');
        setResult(null);
        setStats({ processed: 0, total: 0, imported: 0, skipped: 0 });
        setProgress(0);
        setIsFullSync(false);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CloudDownload className="w-5 h-5 text-green-600" />
                        Sync WhatsApp Chats
                    </DialogTitle>
                    <DialogDescription>
                        Import all WhatsApp conversations from your connected device.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {status === 'idle' && (
                        <div className="space-y-4">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                                <p className="font-medium mb-1">What this does:</p>
                                <ul className="list-disc list-inside space-y-1 text-blue-700">
                                    <li>Fetches all chats from your WhatsApp</li>
                                    <li>Imports recent messages (up to 30 per chat)</li>
                                    <li>Creates contacts automatically</li>
                                    <li>Skips duplicates — safe to run multiple times</li>
                                </ul>
                            </div>

                            <div className="flex items-center space-x-2 bg-slate-50 p-3 rounded-md border border-slate-200">
                                <Checkbox
                                    id="full-sync"
                                    checked={isFullSync}
                                    onCheckedChange={(c) => setIsFullSync(!!c)}
                                />
                                <Label
                                    htmlFor="full-sync"
                                    className="text-sm font-medium leading-none cursor-pointer select-none"
                                >
                                    Deep Sync (Import full history)
                                </Label>
                            </div>
                        </div>
                    )}

                    {status === 'syncing' && (
                        <div className="space-y-6 py-2">
                            {/* Progress Bar & Stats */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm text-gray-600">
                                    <span>Progress</span>
                                    <span className="font-medium">{stats.processed} / {stats.total} chats</span>
                                </div>
                                <Progress value={progress} className="h-2" />
                            </div>

                            {/* Current Activity */}
                            <div className="bg-slate-50 border rounded-lg p-4 flex items-start gap-3">
                                <Loader2 className="w-5 h-5 text-green-600 animate-spin shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-gray-900 truncate">
                                        {currentChat ? `Processing: ${currentChat}` : 'Connecting...'}
                                    </p>
                                    <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                                        <span className="flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                                            {stats.imported} imported
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3 text-gray-400" />
                                            {stats.skipped} skipped
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {status === 'done' && result && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-green-700 bg-green-50 rounded-lg p-3">
                                <CheckCircle2 className="w-6 h-6 shrink-0" />
                                <div className="flex-1">
                                    <p className="font-medium">Sync Complete!</p>
                                    <p className="text-sm text-green-600 mt-0.5">
                                        Processed {result.chatsProcessed} chats successfully.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 rounded-lg p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                                        <MessageCircle className="w-3.5 h-3.5" />
                                        <span className="text-xs">Chats</span>
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">{result.chatsProcessed || 0}</p>
                                    <p className="text-xs text-gray-500">total processed</p>
                                </div>

                                <div className="bg-slate-50 rounded-lg p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                                        <Users className="w-3.5 h-3.5" />
                                        <span className="text-xs">Messages</span>
                                    </div>
                                    <p className="text-2xl font-bold text-green-600">{result.messagesImported || 0}</p>
                                    <p className="text-xs text-gray-500">{result.messagesSkipped || 0} skipped</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {status === 'stopped' && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-amber-700 bg-amber-50 rounded-lg p-3">
                                <StopCircle className="w-6 h-6 shrink-0" />
                                <div className="flex-1">
                                    <p className="font-medium">Sync Stopped</p>
                                    <p className="text-sm text-amber-600 mt-0.5">
                                        Stopped after {stats.processed} / {stats.total} chats.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-green-600">{stats.imported}</p>
                                    <p className="text-xs text-gray-500">imported</p>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-400">{stats.skipped}</p>
                                    <p className="text-xs text-gray-500">skipped</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {status === 'error' && result && (
                        <div className="flex items-start gap-3 text-red-700 bg-red-50 rounded-lg p-3">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">Sync Failed</p>
                                <p className="text-sm mt-1">{result.error}</p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {status === 'idle' && (
                        <>
                            <Button variant="outline" onClick={handleClose}>Cancel</Button>
                            <Button onClick={handleSync} className="bg-green-600 hover:bg-green-700">
                                <CloudDownload className="w-4 h-4 mr-2" />
                                Start Sync
                            </Button>
                        </>
                    )}
                    {status === 'syncing' && (
                        <Button variant="destructive" onClick={handleStop} className="w-full sm:w-auto">
                            <StopCircle className="w-4 h-4 mr-2" />
                            Stop Sync
                        </Button>
                    )}
                    {(status === 'done' || status === 'error' || status === 'stopped') && (
                        <Button onClick={handleClose}>Close</Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
