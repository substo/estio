"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ArrowLeft, ArrowRight, Link2, AlertTriangle, Link as LinkIcon, Unlink, CheckCircle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { searchGoogleContactsAction, resolveSyncConflict, unlinkGoogleContact, getGoogleContactAction } from "../actions";
import { useToast } from "@/components/ui/use-toast";
import { ContactData } from "./contact-form";

type ContactWithSync = ContactData & { error?: string | null; googleContactId?: string | null; lastGoogleSync?: Date | null };

interface GoogleSyncManagerProps {
    // Single contact mode (backward compatible)
    contact?: ContactWithSync;
    // Multi-contact mode (for navigation)
    contacts?: ContactWithSync[];
    initialIndex?: number;
    onNavigate?: (index: number) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function GoogleSyncManager({ contact: singleContact, contacts, initialIndex = 0, onNavigate, open, onOpenChange }: GoogleSyncManagerProps) {
    const { toast } = useToast();
    const [step, setStep] = useState<'view' | 'search'>('view');
    const [loading, setLoading] = useState(false);
    const [resolving, setResolving] = useState(false);

    // Navigation state for multi-contact mode
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const isMultiMode = !!contacts && contacts.length > 0;
    const contact = isMultiMode ? contacts[currentIndex] : singleContact!;
    const totalContacts = isMultiMode ? contacts.length : 1;

    // Google Data State
    const [googleData, setGoogleData] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState(contact?.email || contact?.name || "");
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const isLinked = !!contact?.googleContactId;
    const hasError = !!contact?.error;

    // Navigation handlers
    const goToPrevious = useCallback(() => {
        if (!isMultiMode || currentIndex <= 0) return;
        const newIndex = currentIndex - 1;
        setCurrentIndex(newIndex);
        setGoogleData(null);
        setSearchResults([]);
        setStep('view');
        onNavigate?.(newIndex);
    }, [isMultiMode, currentIndex, onNavigate]);

    const goToNext = useCallback(() => {
        if (!isMultiMode || currentIndex >= totalContacts - 1) return;
        const newIndex = currentIndex + 1;
        setCurrentIndex(newIndex);
        setGoogleData(null);
        setSearchResults([]);
        setStep('view');
        onNavigate?.(newIndex);
    }, [isMultiMode, currentIndex, totalContacts, onNavigate]);

    // Keyboard navigation
    useEffect(() => {
        if (!open || !isMultiMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goToPrevious();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                goToNext();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, isMultiMode, goToPrevious, goToNext]);

    // Initial Fetch logic
    useEffect(() => {
        if (!open) return;

        if (isLinked && contact.googleContactId) {
            fetchLinkedContact(contact.googleContactId);
        }
        else {
            // Not linked: Auto-search by Phone (Priority) or Email
            const initialQuery = contact.phone || contact.email;
            if (initialQuery) {
                setSearchQuery(initialQuery);
                handleSearch(initialQuery, true); // true = auto-fetch
            }
            // Always go to search mode if not linked
            setStep('search');
        }
    }, [open, isLinked, contact.googleContactId]); // removed contact.email dependency to avoid flapping

    const [notConnected, setNotConnected] = useState(false);

    const fetchLinkedContact = async (resourceName: string) => {
        setLoading(true);
        setNotConnected(false);
        try {
            const res = await getGoogleContactAction(resourceName);
            if (res.success && res.data) {
                setGoogleData(res.data);
            } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                setNotConnected(true);
            } else {
                // 404 or error - Link broken. Auto-recover UI.
                toast({ title: "Sync Issue", description: "Linked contact not found. Searching for match...", variant: "default" });
                setGoogleData(null);
                const fallbackQuery = contact.phone || contact.email;
                if (fallbackQuery) {
                    setSearchQuery(fallbackQuery);
                    handleSearch(fallbackQuery, true);
                    setStep('search');
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query: string, isAutoFetch = false) => {
        setLoading(true);
        setNotConnected(false);
        try {
            const res = await searchGoogleContactsAction(query);
            if (res.success && res.data) {
                setSearchResults(res.data);

                // Logic to auto-select if we are just fetching for comparison
                const exactMatch = res.data.find((p: any) =>
                    p.resourceName === contact.googleContactId ||
                    p.email === contact.email
                );

                if (exactMatch) {
                    setGoogleData(exactMatch);
                } else if (!isLinked && res.data.length > 0 && isAutoFetch) {
                    // Don't auto-select for unlinked if multiple results, let user choose
                }
            } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                setNotConnected(true);
                setSearchResults([]);
            } else {
                setSearchResults([]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (action: 'use_google' | 'use_local' | 'link_only' | 'unlink') => {
        setResolving(true);
        try {
            let res;
            if (action === 'unlink') {
                res = await unlinkGoogleContact(contact.id);
            } else {
                res = await resolveSyncConflict(contact.id, action, googleData);
            }

            if (res.success) {
                toast({ title: "Success", description: res.message });
                onOpenChange(false);
            } else {
                toast({ title: "Error", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Action failed.", variant: "destructive" });
        } finally {
            setResolving(false);
        }
    };

    const renderComparisonRow = (label: string, localVal: any, googleVal: any) => {
        const mismatch = String(localVal || '').trim() !== String(googleVal || '').trim();
        return (
            <div className={`grid grid-cols-2 gap-4 py-2 border-b last:border-0 ${mismatch ? 'bg-yellow-50/50' : ''}`}>
                <div className="text-sm">
                    <span className="text-xs text-muted-foreground block">{label}</span>
                    <span className={mismatch ? 'font-medium text-blue-700' : ''}>{localVal || '-'}</span>
                </div>
                <div className="text-sm">
                    <span className="text-xs text-muted-foreground block">{label}</span>
                    <span className={mismatch ? 'font-medium text-green-700' : ''}>{googleVal || '-'}</span>
                </div>
            </div>
        );
    };

    const getStatusHeader = () => {
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
        if (hasError) return (
            <div className="flex items-center gap-2 text-yellow-700 bg-yellow-50 p-3 rounded-md mb-4 border border-yellow-200">
                <AlertTriangle className="h-5 w-5" />
                <div className="text-sm">
                    <span className="font-semibold block">Sync Error Detected</span>
                    {contact.error}
                </div>
            </div>
        );
        if (isLinked) return (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-md mb-4 border border-green-200">
                <CheckCircle className="h-5 w-5" />
                <div className="text-sm">
                    <span className="font-semibold block">Contact Synced</span>
                    Linked to Google Contact.
                </div>
            </div>
        );
        return (
            <div className="flex items-center gap-2 text-gray-700 bg-gray-50 p-3 rounded-md mb-4 border border-gray-200">
                <Link2 className="h-5 w-5" />
                <div className="text-sm">
                    <span className="font-semibold block">Not Linked</span>
                    Search to link or create a new contact in Google.
                </div>
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px]">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle>Google Sync Manager</DialogTitle>
                            <DialogDescription>
                                Manage synchronization between Estio CRM and Google Contacts.
                            </DialogDescription>
                        </div>

                        {/* Navigation Controls */}
                        {isMultiMode && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={goToPrevious}
                                    disabled={currentIndex <= 0 || loading}
                                    title="Previous (←)"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                                    {currentIndex + 1} of {totalContacts}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={goToNext}
                                    disabled={currentIndex >= totalContacts - 1 || loading}
                                    title="Next (→)"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogHeader>

                {/* Current Contact Name */}
                {isMultiMode && (
                    <div className="text-sm font-medium text-center border-b pb-2 mb-2">
                        {contact?.name || contact?.phone || contact?.email || 'Unknown Contact'}
                    </div>
                )}

                {getStatusHeader()}

                <div className="grid grid-cols-2 gap-4 border rounded-md p-4 bg-muted/10">
                    <div className="font-semibold text-center border-b pb-2 text-blue-700">Estio CRM (Local)</div>
                    <div className="font-semibold text-center border-b pb-2 text-green-700 flex justify-between items-center">
                        <span>Google Contacts</span>
                        <Button variant="ghost" size="sm" onClick={() => {
                            const defaultQuery = contact.phone || contact.email || "";
                            setSearchQuery(defaultQuery);
                            if (defaultQuery) handleSearch(defaultQuery);
                            setStep('search');
                        }} className="h-6">
                            <Search className="h-3 w-3 mr-1" /> {googleData ? 'Find Different' : 'Find Match'}
                        </Button>
                    </div>

                    {/* Comparison Area */}
                    <div className="col-span-2 space-y-1">
                        {googleData ? (
                            <>
                                {renderComparisonRow("Name", contact.name, googleData.name)}
                                {renderComparisonRow("Email", contact.email, googleData.email)}
                                {renderComparisonRow("Phone", contact.phone, googleData.phone)}
                            </>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                {loading ? (
                                    <span>Searching Google...</span>
                                ) : searchQuery ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <span>No matching contact found in Google.</span>
                                        <Button size="sm" variant="outline" onClick={() => handleAction('use_local')}>
                                            Create New Contact
                                        </Button>
                                    </div>
                                ) : (
                                    <span>Enter a name, email or phone to search.</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Search Area */}
                {step === 'search' && (
                    <div className="border rounded-md p-4 bg-white dark:bg-gray-900 mt-4">
                        <h4 className="text-sm font-semibold mb-2">Search Google Contacts</h4>
                        <div className="flex gap-2 mb-4">
                            <Input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search by name or email..."
                            />
                            <Button onClick={() => handleSearch(searchQuery)} disabled={loading}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto space-y-2">
                            {searchResults.map((res: any) => (
                                <div key={res.resourceName} className="flex justify-between items-center p-2 border rounded hover:bg-gray-50 cursor-pointer"
                                    onClick={() => { setGoogleData(res); setStep('view'); }}>
                                    <div>
                                        <div className="font-medium">{res.name}</div>
                                        <div className="text-xs text-muted-foreground">{res.email}</div>
                                    </div>
                                    <Button size="sm" variant="secondary">Select</Button>
                                </div>
                            ))}
                            {searchResults.length === 0 && !loading && (
                                <p className="text-sm text-muted-foreground text-center py-2">No results found.</p>
                            )}
                        </div>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:justify-center mt-6">
                    <div className="flex flex-col gap-2 w-full">
                        <div className="flex gap-2 w-full justify-between">
                            {/* Push Local */}
                            <Button
                                variant="outline"
                                className="flex-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                onClick={() => handleAction('use_local')}
                                disabled={resolving}
                            >
                                {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                                Push Local {'>'} Google
                            </Button>

                            {/* Pull Google */}
                            <Button
                                variant="outline"
                                className="flex-1 border-green-200 hover:bg-green-50 text-green-700"
                                onClick={() => handleAction('use_google')}
                                disabled={resolving || !googleData}
                            >
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                Google {'>'} Local
                            </Button>
                        </div>

                        <div className="flex gap-2 w-full justify-center mt-2">
                            {/* Unlink */}
                            {isLinked && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleAction('unlink')}
                                    disabled={resolving}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                    <Unlink className="h-4 w-4 mr-2" />
                                    Unlink Contact
                                </Button>
                            )}

                            {/* Link / Relink */}
                            {googleData && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleAction('link_only')}
                                    disabled={resolving}
                                >
                                    <LinkIcon className="h-4 w-4 mr-2" />
                                    {isLinked ? 'Relink Only' : 'Link Only'}
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
