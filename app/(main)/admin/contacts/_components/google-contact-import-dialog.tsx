"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ArrowRight, MessageCircle, AlertTriangle } from "lucide-react";
import { searchGoogleContactsAction, importNewGoogleContactAction } from "../actions";
import { useToast } from "@/components/ui/use-toast";
import { openOrStartConversationForContact } from "@/app/(main)/admin/contacts/actions";

interface GoogleContactImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
}

export function GoogleContactImportDialog({
    open,
    onOpenChange,
    locationId
}: GoogleContactImportDialogProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [importingId, setImportingId] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const [notConnected, setNotConnected] = useState(false);
    const [authExpired, setAuthExpired] = useState(false);

    // Reset when opened
    useEffect(() => {
        if (open) {
            setSearchQuery("");
            setSearchResults([]);
            setNotConnected(false);
            setAuthExpired(false);
        }
    }, [open]);

    const handleSearch = async (query: string) => {
        if (!query.trim()) return;
        setLoading(true);
        setNotConnected(false);
        try {
            const res = await searchGoogleContactsAction(query);
            if (res.success && res.data) {
                setSearchResults(res.data);
            } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                setNotConnected(true);
                setSearchResults([]);
            } else if (res.message === 'GOOGLE_AUTH_EXPIRED') {
                setAuthExpired(true);
                setSearchResults([]);
            } else {
                setSearchResults([]);
                toast({ title: "Search Failed", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Search failed.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async (resourceName: string, thenMessage: boolean) => {
        setImportingId(resourceName);
        try {
            const res = await importNewGoogleContactAction(resourceName, locationId);

            if (res.success && res.contactId) {
                toast({ title: "Success", description: res.message });
                onOpenChange(false);

                if (thenMessage) {
                    // Try to start conversation
                    try {
                        const convRes = await openOrStartConversationForContact(res.contactId);
                        if (convRes?.success && convRes?.conversationId) {
                            router.push(`/admin/conversations?id=${encodeURIComponent(convRes.conversationId)}`);
                            return; // Stop here, redirecting
                        } else {
                            toast({ title: "Conversation Error", description: convRes?.error || "Could not start conversation.", variant: "destructive" });
                        }
                    } catch (err: any) {
                        toast({ title: "Conversation Error", description: err.message || "Failed to start conversation.", variant: "destructive" });
                    }
                }

                // If not messaging or messaging failed, go to contact view
                router.push(`/admin/contacts/${res.contactId}/view`);

            } else {
                toast({ title: "Import Failed", description: res.message, variant: "destructive" });
                // If it already exists and returned the ID, we could offer to open it
                if (res.contactId && !res.success) {
                    setSearchResults(prev => prev.map(p =>
                        p.resourceName === resourceName ? { ...p, existingContactId: res.contactId } : p
                    ));
                }
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Import failed unexpectedly.", variant: "destructive" });
        } finally {
            setImportingId(null);
        }
    };

    const getStatusHeader = () => {
        if (authExpired) return (
            <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-md mb-4 border border-red-200">
                <AlertTriangle className="h-5 w-5" />
                <div className="text-sm">
                    <span className="font-semibold block">Google Session Expired</span>
                    <span>Your connection to Google has expired. </span>
                    <a href="/api/google/auth" className="underline font-medium hover:text-red-900">Reconnect Account</a>
                </div>
            </div>
        );
        if (notConnected) return (
            <div className="flex items-center gap-2 text-orange-700 bg-orange-50 p-3 rounded-md mb-4 border border-orange-200">
                <AlertTriangle className="h-5 w-5" />
                <div className="text-sm">
                    <span className="font-semibold block">Google Not Connected</span>
                    <span>This feature requires Google Contacts integration. </span>
                    <a href="/admin/integrations" className="underline font-medium hover:text-orange-900">Connect in Integrations</a>
                </div>
            </div>
        );
        return null;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Import from Google Contacts</DialogTitle>
                    <DialogDescription>
                        Search your Google Contacts and import them as new leads.
                    </DialogDescription>
                </DialogHeader>

                {getStatusHeader()}

                {/* Search Area */}
                <div className="border rounded-md p-4 bg-white dark:bg-gray-900 mt-2">
                    <div className="flex gap-2 mb-4">
                        <Input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearch(searchQuery)}
                            placeholder="Search by name, email, or phone..."
                            autoFocus
                        />
                        <Button type="button" onClick={() => handleSearch(searchQuery)} disabled={loading || !searchQuery.trim()}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                    </div>

                    <div className="max-h-[300px] overflow-y-auto space-y-2">
                        {searchResults.map((res: any) => {
                            const isImportingThis = importingId === res.resourceName;
                            const hasExisting = !!res.existingContactId;

                            return (
                                <div key={res.resourceName} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border rounded hover:bg-gray-50 gap-2">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        {res.photo ? (
                                            <img src={res.photo} alt={res.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                                                <span className="text-slate-500 font-medium">{res.name?.charAt(0) || '?'}</span>
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{res.name || 'Unnamed'}</div>
                                            <div className="text-xs text-muted-foreground truncate flex gap-2">
                                                {res.email && <span>{res.email}</span>}
                                                {res.phone && <span>{res.phone}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                                        {hasExisting ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="w-full sm:w-auto"
                                                onClick={() => {
                                                    onOpenChange(false);
                                                    router.push(`/admin/contacts/${res.existingContactId}/view`);
                                                }}
                                            >
                                                View Existing
                                            </Button>
                                        ) : (
                                            <>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={importingId !== null}
                                                    onClick={() => handleImport(res.resourceName, false)}
                                                    className="flex-1 sm:flex-none"
                                                    title="Import contact and view profile"
                                                >
                                                    {isImportingThis ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                                                    Import
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={importingId !== null || !res.phone}
                                                    onClick={() => handleImport(res.resourceName, true)}
                                                    className="flex-1 sm:flex-none"
                                                    title={res.phone ? "Import and start conversation" : "Phone number required for messaging"}
                                                >
                                                    {isImportingThis ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                                                    Message
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {searchResults.length === 0 && !loading && searchQuery && (
                            <div className="text-center py-8 text-muted-foreground">
                                No contacts found matching "{searchQuery}".
                            </div>
                        )}
                        {searchResults.length === 0 && !loading && !searchQuery && (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                                Enter a name or number to search your Google Contacts.
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="sm:justify-between mt-4 text-xs text-muted-foreground">
                    <div>Powered by Google People API</div>
                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
