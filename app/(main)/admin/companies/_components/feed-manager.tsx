
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { deleteFeed, toggleFeedStatus } from '../actions';
import { Trash, RefreshCw, Plus, Play, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { FeedWizard } from './feed-builder/feed-wizard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Feed {
    id: string;
    url: string;
    format: string;
    lastSyncAt: Date | null;
    isActive: boolean;
}

export function FeedManager({ companyId, initialFeeds }: { companyId: string, initialFeeds: Feed[] }) {
    const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
    const [isAdding, setIsAdding] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    // Sync Handler
    const handleSync = async () => {
        setIsSyncing(true);
        toast.info("Starting sync...");
        try {
            const res = await fetch(`/api/cron/sync-feeds?companyId=${companyId}`);
            const data = await res.json();
            if (data.success) {
                toast.success(`Sync complete!`);
                window.location.reload(); // Refresh to show new items
            } else {
                toast.error(`Sync failed: ${data.error}`);
            }
        } catch (e) {
            toast.error("Sync request failed");
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure?')) return;
        const res = await deleteFeed(id);
        if (res.success) {
            setFeeds(feeds.filter(f => f.id !== id));
            toast.success("Feed deleted");
        } else {
            toast.error(res.message);
        }
    };

    const handleToggle = async (id: string, currentStatus: boolean) => {
        // Optimistic update
        setFeeds(feeds.map(f => f.id === id ? { ...f, isActive: !currentStatus } : f));

        const res = await toggleFeedStatus(id, !currentStatus);
        if (!res.success) {
            // Revert
            setFeeds(feeds.map(f => f.id === id ? { ...f, isActive: currentStatus } : f));
            toast.error(res.message);
        }
    };

    return (
        <div className="space-y-4 mt-4 border-t pt-4">
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold">XML Feeds</h3>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
                        <RefreshCw className={`h-3 w-3 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                        Sync All
                    </Button>
                    <Button size="sm" onClick={() => setIsAdding(!isAdding)} variant="secondary" disabled={isAdding}>
                        <Plus className="h-3 w-3 mr-1" /> Add Feed
                    </Button>
                </div>
            </div>

            {/* Feed Builder Dialog */}
            <Dialog open={isAdding} onOpenChange={setIsAdding}>
                <DialogContent className="max-w-4xl p-0 h-[80vh] flex flex-col">
                    <DialogHeader className="p-6 pb-2">
                        <DialogTitle>Add XML Feed</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden p-6 pt-2">
                        <FeedWizard
                            companyId={companyId}
                            onSuccess={() => {
                                window.location.reload();
                                setIsAdding(false);
                            }}
                            onCancel={() => setIsAdding(false)}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <div className="space-y-2">
                {feeds.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No feeds configured.</p>
                ) : (
                    feeds.map(feed => (
                        <div key={feed.id} className={`flex items-center justify-between p-2 rounded border text-sm ${feed.isActive ? 'bg-slate-50 dark:bg-slate-900' : 'bg-slate-100 dark:bg-slate-800 opacity-75'}`}>
                            <div className="truncate max-w-[400px] flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${feed.isActive ? 'bg-green-500' : 'bg-slate-400'}`} />
                                    <span className="font-medium truncate" title={feed.url}>{feed.url}</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground ml-4">{feed.format} • Last Sync: {feed.lastSyncAt ? new Date(feed.lastSyncAt).toLocaleDateString() + ' ' + new Date(feed.lastSyncAt).toLocaleTimeString() : 'Never'}</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 mr-2">
                                    <Switch
                                        checked={feed.isActive}
                                        onCheckedChange={() => handleToggle(feed.id, feed.isActive)}
                                    />
                                    <span className="text-[10px] text-muted-foreground w-8">{feed.isActive ? 'Active' : 'Paused'}</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-700" onClick={() => handleDelete(feed.id)}>
                                    <Trash className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
