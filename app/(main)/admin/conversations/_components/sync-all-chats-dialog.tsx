'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CloudDownload, Loader2, CheckCircle2, AlertCircle, MessageCircle, Users } from 'lucide-react';
import { syncAllEvolutionChats } from '../actions';

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
    const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
    const [result, setResult] = useState<SyncResult | null>(null);

    const handleSync = async () => {
        setStatus('syncing');
        setResult(null);

        try {
            const res = await syncAllEvolutionChats();
            setResult(res);
            setStatus(res.success ? 'done' : 'error');
            if (res.success) {
                onComplete?.();
            }
        } catch (err: any) {
            setResult({ success: false, error: err.message || 'Unknown error' });
            setStatus('error');
        }
    };

    const handleClose = () => {
        setStatus('idle');
        setResult(null);
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
                        Import all WhatsApp conversations from your connected device. Existing messages will be skipped automatically.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {status === 'idle' && (
                        <div className="space-y-3">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                                <p className="font-medium mb-1">What this does:</p>
                                <ul className="list-disc list-inside space-y-1 text-blue-700">
                                    <li>Fetches all chats from your WhatsApp</li>
                                    <li>Imports recent messages (up to 30 per chat)</li>
                                    <li>Creates contacts automatically</li>
                                    <li>Skips duplicates — safe to run multiple times</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {status === 'syncing' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-4">
                            <Loader2 className="w-10 h-10 text-green-600 animate-spin" />
                            <div className="text-center">
                                <p className="font-medium text-gray-900">Syncing chats...</p>
                                <p className="text-sm text-gray-500 mt-1">This may take a minute depending on how many chats you have.</p>
                            </div>
                        </div>
                    )}

                    {status === 'done' && result && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-green-700 bg-green-50 rounded-lg p-3">
                                <CheckCircle2 className="w-6 h-6 shrink-0" />
                                <p className="font-medium">Sync Complete!</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 rounded-lg p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                                        <MessageCircle className="w-3.5 h-3.5" />
                                        <span className="text-xs">Chats</span>
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">{result.chatsProcessed || 0}</p>
                                    <p className="text-xs text-gray-500">of {result.totalChats || 0}</p>
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

                            {(result.errors || 0) > 0 && (
                                <p className="text-xs text-amber-600 text-center">{result.errors} errors (non-critical)</p>
                            )}
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
                        <Button variant="outline" disabled>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Syncing...
                        </Button>
                    )}
                    {(status === 'done' || status === 'error') && (
                        <Button onClick={handleClose}>Close</Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
