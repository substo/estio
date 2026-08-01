'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Trash } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { deleteFeed, toggleFeedStatus } from '../actions';
import { FeedWizard } from './feed-builder/feed-wizard';

interface Feed {
    id: string;
    url: string;
    format: string;
    lastSyncAt: Date | null;
    isActive: boolean;
}

type ManagerMessage = { kind: 'status' | 'error'; text: string } | null;

export function FeedManager({ companyId, initialFeeds }: { companyId: string; initialFeeds: Feed[] }) {
    const router = useRouter();
    const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
    const [isAdding, setIsAdding] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [pendingFeedId, setPendingFeedId] = useState<string | null>(null);
    const [feedToDelete, setFeedToDelete] = useState<Feed | null>(null);
    const [message, setMessage] = useState<ManagerMessage>(null);

    useEffect(() => {
        setFeeds(initialFeeds);
    }, [initialFeeds]);

    const handleSync = async () => {
        setIsSyncing(true);
        setMessage({ kind: 'status', text: 'Syncing active feeds…' });
        try {
            const response = await fetch('/api/admin/companies/feed-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId }),
            });
            const data = await response.json().catch(() => null) as {
                success?: boolean;
                error?: string;
                message?: string;
            } | null;
            if (response.ok && data?.success) {
                setMessage({ kind: 'status', text: 'Feed sync completed.' });
                toast.success('Feed sync completed.');
                router.refresh();
            } else {
                const error = data?.error || data?.message || 'Feed sync failed.';
                setMessage({ kind: 'error', text: error });
                toast.error(error);
            }
        } catch {
            setMessage({ kind: 'error', text: 'Sync request failed. Try again.' });
            toast.error('Sync request failed.');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDelete = async () => {
        if (!feedToDelete) return;
        const target = feedToDelete;
        setPendingFeedId(target.id);
        setMessage({ kind: 'status', text: 'Deleting feed…' });
        try {
            const result = await deleteFeed(target.id);
            if (result.success) {
                setFeeds((current) => current.filter((feed) => feed.id !== target.id));
                setFeedToDelete(null);
                setMessage({ kind: 'status', text: 'Feed deleted.' });
                toast.success('Feed deleted.');
                router.refresh();
            } else {
                setMessage({ kind: 'error', text: result.message });
                toast.error(result.message);
            }
        } catch {
            setMessage({ kind: 'error', text: 'Failed to delete feed. Try again.' });
            toast.error('Failed to delete feed.');
        } finally {
            setPendingFeedId(null);
        }
    };

    const handleToggle = async (feedId: string, currentStatus: boolean) => {
        const nextStatus = !currentStatus;
        setPendingFeedId(feedId);
        setMessage({ kind: 'status', text: `${nextStatus ? 'Activating' : 'Pausing'} feed…` });
        setFeeds((current) => current.map((feed) => (
            feed.id === feedId ? { ...feed, isActive: nextStatus } : feed
        )));

        try {
            const result = await toggleFeedStatus(feedId, nextStatus);
            if (result.success) {
                setMessage({ kind: 'status', text: `Feed ${nextStatus ? 'activated' : 'paused'}.` });
                router.refresh();
            } else {
                setFeeds((current) => current.map((feed) => (
                    feed.id === feedId ? { ...feed, isActive: currentStatus } : feed
                )));
                setMessage({ kind: 'error', text: result.message });
                toast.error(result.message);
            }
        } catch {
            setFeeds((current) => current.map((feed) => (
                feed.id === feedId ? { ...feed, isActive: currentStatus } : feed
            )));
            setMessage({ kind: 'error', text: 'Failed to update feed status. Try again.' });
            toast.error('Failed to update feed status.');
        } finally {
            setPendingFeedId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Configure property XML feeds for this company.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSync}
                        disabled={isSyncing || feeds.length === 0}
                    >
                        <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing…' : 'Sync active feeds'}
                    </Button>
                    <Button type="button" size="sm" onClick={() => setIsAdding(true)} variant="secondary">
                        <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
                        Add feed
                    </Button>
                </div>
            </div>

            {message ? (
                <p
                    role={message.kind === 'error' ? 'alert' : 'status'}
                    aria-live={message.kind === 'error' ? 'assertive' : 'polite'}
                    className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
                >
                    {message.text}
                </p>
            ) : null}

            <Dialog open={isAdding} onOpenChange={setIsAdding}>
                <DialogContent className="flex h-[min(80vh,48rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col p-0">
                    <DialogHeader className="p-6 pb-2 pr-12">
                        <DialogTitle>Add XML feed</DialogTitle>
                        <DialogDescription>
                            Analyze a public XML feed, review its field mapping, and save it to this company.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden p-6 pt-2">
                        <FeedWizard
                            companyId={companyId}
                            onSuccess={() => {
                                setIsAdding(false);
                                setMessage({ kind: 'status', text: 'Feed added.' });
                                router.refresh();
                            }}
                            onCancel={() => setIsAdding(false)}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            {feeds.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No feeds configured. Add a feed to begin importing properties.
                </p>
            ) : (
                <ul className="space-y-2" aria-label="Configured XML feeds">
                    {feeds.map((feed) => {
                        const isPending = pendingFeedId === feed.id;
                        return (
                            <li
                                key={feed.id}
                                className={`flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                                    feed.isActive ? 'bg-slate-50 dark:bg-slate-900' : 'bg-slate-100 opacity-75 dark:bg-slate-800'
                                }`}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span
                                            aria-hidden="true"
                                            className={`h-2 w-2 shrink-0 rounded-full ${feed.isActive ? 'bg-green-500' : 'bg-slate-400'}`}
                                        />
                                        <span className="truncate font-medium" title={feed.url}>{feed.url}</span>
                                    </div>
                                    <p className="ml-4 text-xs text-muted-foreground">
                                        {feed.format} · Last sync:{' '}
                                        {feed.lastSyncAt ? new Date(feed.lastSyncAt).toLocaleString() : 'Never'}
                                    </p>
                                </div>

                                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={feed.isActive}
                                            onCheckedChange={() => handleToggle(feed.id, feed.isActive)}
                                            disabled={isPending}
                                            aria-label={`${feed.isActive ? 'Pause' : 'Activate'} feed ${feed.url}`}
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {feed.isActive ? 'Active' : 'Paused'}
                                        </span>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-10 w-10 text-red-500 hover:text-red-700"
                                        onClick={() => setFeedToDelete(feed)}
                                        disabled={isPending}
                                        aria-label={`Delete feed ${feed.url}`}
                                    >
                                        <Trash aria-hidden="true" className="h-4 w-4" />
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <AlertDialog
                open={Boolean(feedToDelete)}
                onOpenChange={(open) => {
                    if (!open && !pendingFeedId) setFeedToDelete(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete XML feed?</AlertDialogTitle>
                        <AlertDialogDescription className="break-all">
                            This permanently removes {feedToDelete?.url}. Imported properties are not deleted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={Boolean(pendingFeedId)}>Cancel</AlertDialogCancel>
                        <Button type="button" variant="destructive" onClick={handleDelete} disabled={Boolean(pendingFeedId)}>
                            {pendingFeedId ? 'Deleting…' : 'Delete feed'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
