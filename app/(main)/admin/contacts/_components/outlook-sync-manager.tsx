"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Mail, RefreshCw, Inbox, Send, Calendar, AlertTriangle, CheckCircle } from "lucide-react";
import { fetchOutlookEmailsForContactAction, syncOutlookEmailsAction, getOutlookStatusAction, OutlookEmail } from "../outlook-actions";
import { useToast } from "@/components/ui/use-toast";
import { formatDistanceToNow } from "date-fns";

interface OutlookSyncManagerProps {
    contactEmail: string;
    contactName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OutlookSyncManager({ contactEmail, contactName, open, onOpenChange }: OutlookSyncManagerProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [emails, setEmails] = useState<OutlookEmail[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; method?: string; email?: string; lastSyncedAt?: Date }>({ connected: false });
    const [filter, setFilter] = useState<'all' | 'inbox' | 'sent'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        console.log('[OutlookSyncManager] Effect Triggered', { open, contactEmail });
        if (open) {
            checkConnection();
            fetchEmails();
        }
        return () => console.log('[OutlookSyncManager] Unmounting or Dep Change');
    }, [open, contactEmail]);

    const checkConnection = async () => {
        const status = await getOutlookStatusAction();
        setConnectionStatus(status);
    };

    const fetchEmails = async () => {
        if (!contactEmail) return;

        setLoading(true);
        try {
            const result = await fetchOutlookEmailsForContactAction(contactEmail);
            if (result.success && result.data) {
                setEmails(result.data);
            } else {
                toast({ title: "Error", description: result.error || "Failed to fetch emails", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            // Pass contactEmail to trigger targeted search sync
            const result = await syncOutlookEmailsAction(contactEmail);
            if (result.success) {
                toast({ title: "Sync Complete", description: `Synced ${result.count} emails` });
                await fetchEmails(); // Refresh the list
            } else {
                toast({ title: "Sync Failed", description: result.error, variant: "destructive" });
            }
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } finally {
            setSyncing(false);
        }
    };

    const filteredEmails = emails.filter(email => {
        const matchesFilter = filter === 'all' || email.folder === filter;
        const matchesSearch = !searchQuery ||
            email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
            email.preview.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesFilter && matchesSearch;
    });

    const getStatusBadge = () => {
        if (!connectionStatus.connected) {
            return (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 p-3 rounded-md mb-4 border border-amber-200">
                    <AlertTriangle className="h-5 w-5" />
                    <div className="text-sm">
                        <span className="font-semibold block">Not Connected</span>
                        <a href="/admin/settings/integrations/microsoft" className="text-blue-600 hover:underline">
                            Connect Outlook to sync emails
                        </a>
                    </div>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-md mb-4 border border-green-200">
                <CheckCircle className="h-5 w-5" />
                <div className="text-sm flex-1">
                    <span className="font-semibold block">Connected</span>
                    via {connectionStatus.method === 'puppeteer' ? 'Browser Login' : 'OAuth'} ({connectionStatus.email})
                    {connectionStatus.lastSyncedAt && (
                        <span className="block text-xs text-green-600 mt-1">
                            Last synced: {formatDistanceToNow(new Date(connectionStatus.lastSyncedAt), { addSuffix: true })}
                        </span>
                    )}
                </div>
                <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-1">Sync Now</span>
                </Button>
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5" />
                        Outlook Emails - {contactName}
                    </DialogTitle>
                    <DialogDescription>
                        View and sync emails with {contactEmail}
                    </DialogDescription>
                </DialogHeader>

                {getStatusBadge()}

                {/* Filter Bar */}
                <div className="flex gap-2 items-center">
                    <div className="flex border rounded-md overflow-hidden">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-3 py-1.5 text-sm ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                            All ({emails.length})
                        </button>
                        <button
                            onClick={() => setFilter('inbox')}
                            className={`px-3 py-1.5 text-sm flex items-center gap-1 ${filter === 'inbox' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                            <Inbox className="h-3 w-3" /> Inbox ({emails.filter(e => e.folder === 'inbox').length})
                        </button>
                        <button
                            onClick={() => setFilter('sent')}
                            className={`px-3 py-1.5 text-sm flex items-center gap-1 ${filter === 'sent' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                            <Send className="h-3 w-3" /> Sent ({emails.filter(e => e.folder === 'sent').length})
                        </button>
                    </div>
                    <div className="flex-1">
                        <Input
                            placeholder="Search emails..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="h-8"
                        />
                    </div>
                </div>

                {/* Email List */}
                <div className="flex-1 overflow-y-auto border rounded-md mt-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredEmails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Mail className="h-12 w-12 mb-2 opacity-50" />
                            <p>No emails found</p>
                            {connectionStatus.connected && (
                                <Button variant="link" onClick={handleSync} disabled={syncing}>
                                    Sync from Outlook
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y">
                            {filteredEmails.map(email => (
                                <div
                                    key={email.id}
                                    className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {email.folder === 'inbox' ? (
                                                    <Inbox className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                                ) : (
                                                    <Send className="h-4 w-4 text-green-500 flex-shrink-0" />
                                                )}
                                                <span className="font-medium truncate">{email.subject}</span>
                                            </div>
                                            <p className="text-sm text-muted-foreground truncate mt-1">
                                                {email.preview}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                                            <Calendar className="h-3 w-3" />
                                            {formatDistanceToNow(new Date(email.date), { addSuffix: true })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
