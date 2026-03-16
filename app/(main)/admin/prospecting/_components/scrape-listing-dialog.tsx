'use client';

import { useState, useCallback, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Bug, ChevronDown, ChevronUp } from 'lucide-react';

interface ScrapeListingDialogProps {
    listingId: string;
    listingUrl: string;
    listingTitle: string | null;
    platform: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

interface ScrapeEvent {
    status: string;
    message?: string;
    error?: string;
    debugHtml?: string;
    data?: any;
}

type ScrapePhase = 'idle' | 'running' | 'success' | 'error';

export function ScrapeListingDialog({
    listingId,
    listingUrl,
    listingTitle,
    platform,
    isOpen,
    onOpenChange,
    onSuccess,
}: ScrapeListingDialogProps) {
    const [phase, setPhase] = useState<ScrapePhase>('idle');
    const [logs, setLogs] = useState<ScrapeEvent[]>([]);
    const [extractedData, setExtractedData] = useState<any>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [debugHtml, setDebugHtml] = useState<string | null>(null);
    const [showDebugHtml, setShowDebugHtml] = useState(false);

    const startScrape = useCallback(async () => {
        setPhase('running');
        setLogs([]);
        setExtractedData(null);
        setErrorMessage(null);
        setDebugHtml(null);
        setShowDebugHtml(false);

        try {
            const res = await fetch('/api/admin/scrape-listing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId, url: listingUrl, platform }),
            });

            if (!res.body) throw new Error('Streaming not supported by browser.');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const event: ScrapeEvent = JSON.parse(line.replace('data: ', ''));
                                setLogs(prev => [...prev, event]);

                                if (event.status === 'success') {
                                    setPhase('success');
                                    if (event.data) setExtractedData(event.data);
                                    onSuccess?.();
                                } else if (event.status === 'error') {
                                    setPhase('error');
                                    setErrorMessage(event.error || 'Unknown error');
                                    if (event.debugHtml) setDebugHtml(event.debugHtml);
                                }
                            } catch (e) {
                                console.error('Failed to parse SSE chunk:', line);
                            }
                        }
                    }
                }
            }

            // If stream ended without success/error, mark as error
            setPhase(prev => prev === 'running' ? 'error' : prev);
            if (phase === 'running') setErrorMessage('Stream ended unexpectedly');
        } catch (e: any) {
            setPhase('error');
            setErrorMessage(`Client error: ${e.message}`);
        }
    }, [listingId, listingUrl, platform, onSuccess]);

    // Auto-start scrape when dialog opens
    useEffect(() => {
        if (isOpen && phase === 'idle') {
            const timer = setTimeout(startScrape, 100);
            return () => clearTimeout(timer);
        }
    }, [isOpen, phase, startScrape]);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            // Reset state when closing
            setPhase('idle');
            setLogs([]);
            setExtractedData(null);
            setErrorMessage(null);
            setDebugHtml(null);
        }
        onOpenChange(open);
    };

    const latestMessage = logs.length > 0 ? logs[logs.length - 1]?.message : null;

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {phase === 'running' && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
                        {phase === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                        {phase === 'error' && <AlertTriangle className="w-5 h-5 text-red-500" />}
                        Scrape Listing
                    </DialogTitle>
                    <DialogDescription className="text-xs truncate">
                        {listingTitle || listingUrl}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    {/* Live Status */}
                    {phase === 'running' && latestMessage && (
                        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                            <span className="text-sm text-blue-700 dark:text-blue-300">{latestMessage}</span>
                        </div>
                    )}

                    {/* Log stream */}
                    <div className="bg-muted/40 border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Activity Log</div>
                        {logs.length === 0 ? (
                            <div className="text-xs text-muted-foreground italic">Waiting to start...</div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                    <Badge
                                        variant={
                                            log.status === 'error' ? 'destructive' :
                                                log.status === 'success' ? 'default' :
                                                    'outline'
                                        }
                                        className="text-[10px] shrink-0 mt-0.5"
                                    >
                                        {log.status}
                                    </Badge>
                                    <span className="text-muted-foreground break-all">{log.message || log.error || ''}</span>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Success: Extracted Data Card */}
                    {phase === 'success' && extractedData && (
                        <div className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                <span className="font-semibold text-sm text-green-700 dark:text-green-300">Data Extracted</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                {extractedData.title && (
                                    <div className="col-span-2">
                                        <span className="text-muted-foreground">Title:</span>
                                        <span className="ml-1 font-medium">{extractedData.title}</span>
                                    </div>
                                )}
                                {extractedData.price != null && (
                                    <div>
                                        <span className="text-muted-foreground">Price:</span>
                                        <span className="ml-1 font-medium">€{extractedData.price?.toLocaleString()}</span>
                                    </div>
                                )}
                                {extractedData.location && (
                                    <div>
                                        <span className="text-muted-foreground">Location:</span>
                                        <span className="ml-1 font-medium">{extractedData.location}</span>
                                    </div>
                                )}
                                {extractedData.ownerName && (
                                    <div>
                                        <span className="text-muted-foreground">Owner:</span>
                                        <span className="ml-1 font-medium">{extractedData.ownerName}</span>
                                    </div>
                                )}
                                {extractedData.ownerPhone && (
                                    <div>
                                        <span className="text-muted-foreground">Phone:</span>
                                        <span className="ml-1 font-mono font-medium">{extractedData.ownerPhone}</span>
                                    </div>
                                )}
                                {extractedData.images?.length > 0 && (
                                    <div>
                                        <span className="text-muted-foreground">Images:</span>
                                        <span className="ml-1">{extractedData.images.length} found</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Error Panel */}
                    {phase === 'error' && errorMessage && (
                        <div className="border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-600" />
                                <span className="font-semibold text-sm text-red-700 dark:text-red-300">Scrape Failed</span>
                            </div>
                            <p className="text-xs text-red-600 dark:text-red-400 break-all">{errorMessage}</p>

                            {debugHtml && (
                                <div className="space-y-2">
                                    <button
                                        onClick={() => setShowDebugHtml(!showDebugHtml)}
                                        className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 hover:underline font-medium"
                                    >
                                        <Bug className="w-3 h-3" />
                                        Debug HTML
                                        {showDebugHtml ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                    {showDebugHtml && (
                                        <pre className="whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto text-[10px] text-red-800 dark:text-red-300 bg-red-100 dark:bg-red-950 p-3 rounded border border-red-200 dark:border-red-800">
                                            {debugHtml}
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-2 pt-2">
                        {(phase === 'error' || phase === 'success') && (
                            <Button variant="outline" size="sm" onClick={startScrape} className="gap-2">
                                <RefreshCw className="w-4 h-4" />
                                Retry
                            </Button>
                        )}
                        <Button
                            variant={phase === 'success' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => handleOpenChange(false)}
                        >
                            {phase === 'success' ? 'Done' : 'Close'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
