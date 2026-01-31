"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, ArrowLeft, ArrowRight, RefreshCw, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { searchGoogleContactsAction, resolveSyncConflict } from "../actions";
import { useToast } from "@/components/ui/use-toast";
import { ContactData } from "./contact-form";

interface SyncConflictModalProps {
    contact: ContactData & { error?: string | null };
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SyncConflictModal({ contact, open, onOpenChange }: SyncConflictModalProps) {
    const { toast } = useToast();
    const [step, setStep] = useState<'compare' | 'search'>('compare');
    const [loading, setLoading] = useState(false);
    const [resolving, setResolving] = useState(false);

    // Google Data State
    const [googleData, setGoogleData] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState(contact.email || contact.name || "");
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Initial Fetch (Auto-search by email)
    useEffect(() => {
        if (open && contact.email && !googleData) {
            handleSearch(contact.email);
        }
    }, [open, contact.email]);

    const handleSearch = async (query: string) => {
        setLoading(true);
        try {
            const res = await searchGoogleContactsAction(query);
            if (res.success && res.data) {
                setSearchResults(res.data);
                // If exact email match found, set it as default googleData
                const exactMatch = res.data.find((p: any) => p.email === contact.email);
                if (exactMatch && !googleData) {
                    setGoogleData(exactMatch);
                } else if (!googleData && res.data.length > 0) {
                    // Default to first result if safe? Maybe not. Let user choose.
                    // setGoogleData(res.data[0]); 
                }
            } else {
                setSearchResults([]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleResolve = async (resolution: 'use_google' | 'use_local' | 'link_only') => {
        setResolving(true);
        try {
            const res = await resolveSyncConflict(contact.id, resolution, googleData);
            if (res.success) {
                toast({ title: "Resolved", description: res.message });
                onOpenChange(false);
            } else {
                toast({ title: "Error", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to resolve.", variant: "destructive" });
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        Resolve Sync Conflict
                    </DialogTitle>
                    <DialogDescription>
                        There is a sync issue with this contact. Please review the data below and choose the source of truth.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 border rounded-md p-4 bg-muted/10">
                    <div className="font-semibold text-center border-b pb-2 text-blue-700">Estio CRM (Local)</div>
                    <div className="font-semibold text-center border-b pb-2 text-green-700 flex justify-between items-center">
                        <span>Google Contacts</span>
                        <Button variant="ghost" size="sm" onClick={() => setStep('search')} className="h-6">
                            <Search className="h-3 w-3 mr-1" /> Find
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
                                {loading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> :
                                    "No Google Contact selected. Search to find a match."}
                            </div>
                        )}
                    </div>
                </div>

                {/* Search Area (Overlay or separate section) */}
                {step === 'search' && (
                    <div className="border rounded-md p-4 bg-white dark:bg-gray-900 mt-4">
                        <h4 className="text-sm font-semibold mb-2">Find Matching Google Contact</h4>
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
                                    onClick={() => { setGoogleData(res); setStep('compare'); }}>
                                    <div>
                                        <div className="font-medium">{res.name}</div>
                                        <div className="text-xs text-muted-foreground">{res.email}</div>
                                    </div>
                                    <Button size="sm" variant="secondary">Select</Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:justify-center mt-6">
                    <div className="flex flex-col gap-2 w-full">
                        <div className="flex gap-2 w-full justify-between">
                            {/* Use Local */}
                            <Button
                                variant="outline"
                                className="flex-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                onClick={() => handleResolve('use_local')}
                                disabled={resolving}
                            >
                                {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                                Push Local to Google
                            </Button>

                            {/* Link Only */}
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => handleResolve('link_only')}
                                disabled={resolving || !googleData}
                            >
                                <LinkIcon className="h-4 w-4 mr-2" />
                                Link Only (No Data Change)
                            </Button>

                            {/* Use Google */}
                            <Button
                                variant="outline"
                                className="flex-1 border-green-200 hover:bg-green-50 text-green-700"
                                onClick={() => handleResolve('use_google')}
                                disabled={resolving || !googleData}
                            >
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                Pull Google to Local
                            </Button>
                        </div>
                        <p className="text-xs text-center text-muted-foreground mt-2">
                            "Push Local" will create a new contact in Google if none is selected.
                        </p>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
