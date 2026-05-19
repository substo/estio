'use client';

import * as React from "react"
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertCircle, Check, ChevronsUpDown, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";
import { mergeContacts, previewMergeContacts, searchContactsAction, type MergeContactPreview } from "@/app/(main)/admin/contacts/actions";
import { cn } from "@/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface MergeContactDialogProps {
    sourceContactId: string;
    sourceName: string;
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onMergeSuccess?: (targetContactId: string, targetConversationId?: string | null) => void;
}

export function MergeContactDialog({ sourceContactId, sourceName, trigger, open, onOpenChange, onMergeSuccess }: MergeContactDialogProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isControlled = typeof open === 'boolean';
    const resolvedOpen = isControlled ? open : uncontrolledOpen;
    const setOpen = onOpenChange || setUncontrolledOpen;
    const shouldRenderTrigger = trigger !== undefined || !isControlled;
    const [targetContactId, setTargetContactId] = useState<string | null>(null);
    const [isMerging, setIsMerging] = useState(false);
    const [preview, setPreview] = useState<MergeContactPreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const previewRequestRef = React.useRef(0);

    // Search State
    const [searchOpen, setSearchOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const hasCurrentPreview = !!preview && preview.source.id === sourceContactId && preview.target.id === targetContactId;

    // Debounced search effect
    React.useEffect(() => {
        const timer = setTimeout(async () => {
            if (query.length < 2) {
                setResults([]);
                return;
            }
            setLoading(true);
            try {
                const data = await searchContactsAction(query);
                // Filter out self
                setResults(data.filter((c: any) => c.id !== sourceContactId));
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [query, sourceContactId]);

    React.useEffect(() => {
        previewRequestRef.current += 1;
        const requestId = previewRequestRef.current;

        setPreview(null);
        setPreviewError(null);

        if (!resolvedOpen || !targetContactId) {
            setPreviewLoading(false);
            return;
        }

        setPreviewLoading(true);
        previewMergeContacts(sourceContactId, targetContactId)
            .then((result) => {
                if (previewRequestRef.current !== requestId) return;

                if (result.success && result.preview) {
                    setPreview(result.preview);
                    setPreviewError(null);
                } else if (result.message?.startsWith("already_merged:")) {
                    setPreviewError("This source contact was already merged. Confirm is disabled.");
                } else {
                    setPreviewError(result.message || "Could not load merge preview.");
                }
            })
            .catch((error) => {
                if (previewRequestRef.current !== requestId) return;
                console.error(error);
                setPreviewError("Could not load merge preview.");
            })
            .finally(() => {
                if (previewRequestRef.current !== requestId) return;
                setPreviewLoading(false);
            });
    }, [resolvedOpen, sourceContactId, targetContactId]);

    React.useEffect(() => {
        if (!resolvedOpen) {
            setTargetContactId(null);
            setQuery("");
            setResults([]);
            setPreview(null);
            setPreviewError(null);
            setPreviewLoading(false);
        }
    }, [resolvedOpen]);

    const handleMerge = async () => {
        if (!targetContactId) {
            toast.error("Please select a contact to merge into.");
            return;
        }
        if (!hasCurrentPreview) {
            toast.error("Wait for the merge preview to load before confirming.");
            return;
        }

        setIsMerging(true);
        try {
            const result = await mergeContacts(sourceContactId, targetContactId);
            if (result.success) {
                toast.success("Contacts merged successfully!");
                setOpen(false);
                if (onMergeSuccess) {
                    onMergeSuccess(targetContactId, (result as any).targetConversationId || null);
                } else {
                    // Force hard refresh to update UI and redirect
                    // Use window.location.assign to avoid issues with space injection
                    window.location.assign(`/admin/contacts/${targetContactId}/view`);
                }
            } else if (result.message?.startsWith("already_merged:")) {
                const mergedIntoId = result.message.split(":")[1];
                toast.info("This contact was already merged automatically. Redirecting...");
                setOpen(false);
                window.location.assign(`/admin/contacts/${mergedIntoId}/view`);
            } else if (result.message === "Contact not found") {
                toast.info("This contact no longer exists. It may have been merged automatically.");
                setOpen(false);
                window.location.assign('/admin/contacts');
            } else {
                toast.error(result.message || "Failed to merge contacts.");
            }
        } catch (error) {
            toast.error("An error occurred.");
            console.error(error);
        } finally {
            setIsMerging(false);
        }
    };

    return (
        <Dialog open={resolvedOpen} onOpenChange={setOpen}>
            {shouldRenderTrigger ? (
                <DialogTrigger asChild>
                    {trigger || (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Merge className="mr-2 h-4 w-4" />
                            Merge
                        </Button>
                    )}
                </DialogTrigger>
            ) : null}
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Merge Contact</DialogTitle>
                    <DialogDescription>
                        Merge <strong>{sourceName || 'Unknown'}</strong> into another contact.
                        <div className="mt-2 text-red-500 text-xs flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            This action cannot be undone. <strong>{sourceName || 'Unknown'}</strong> will be deleted.
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Target Contact</Label>
                        <Popover open={searchOpen} onOpenChange={setSearchOpen} modal={true}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={searchOpen}
                                    className="w-full justify-between min-w-0"
                                >
                                    <span className="truncate">
                                        {targetContactId
                                            ? results.find((c) => c.id === targetContactId)?.name || results.find((c) => c.id === targetContactId)?.phone || "Selected Contact"
                                            : "Search contact..."}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0">
                                <Command shouldFilter={false}>
                                    <CommandInput placeholder="Search name or phone..." value={query} onValueChange={setQuery} />
                                    <CommandList>
                                        {loading && <div className="py-6 text-center text-sm">Searching...</div>}
                                        {!loading && results.length === 0 && <CommandEmpty>No contact found.</CommandEmpty>}
                                        {results.map((contact) => (
                                            <CommandItem
                                                key={contact.id}
                                                value={contact.id}
                                                onSelect={(currentValue) => {
                                                    setTargetContactId(currentValue === targetContactId ? null : currentValue)
                                                    setSearchOpen(false)
                                                }}
                                                className="cursor-pointer"
                                            >
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        targetContactId === contact.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                <div className="flex flex-col">
                                                    <span>{contact.name || 'Unnamed'}</span>
                                                    <span className="text-xs text-muted-foreground">{contact.phone}</span>
                                                    <span className="text-xs text-muted-foreground">{contact.email}</span>
                                                </div>
                                            </CommandItem>
                                        ))}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    {targetContactId && (
                        <MergePreviewPanel
                            preview={preview}
                            loading={previewLoading}
                            error={previewError}
                        />
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isMerging}>Cancel</Button>
                    <Button variant="destructive" onClick={handleMerge} disabled={!targetContactId || !hasCurrentPreview || previewLoading || isMerging}>
                        {isMerging ? "Merging..." : "Merge and delete source contact"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MergePreviewPanel({
    preview,
    loading,
    error,
}: {
    preview: MergeContactPreview | null;
    loading: boolean;
    error: string | null;
}) {
    if (loading) {
        return (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading merge preview...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
            </div>
        );
    }

    if (!preview) return null;

    const filledFields = [
        ...preview.blankFieldsFilled.map((field) => field.label),
        ...preview.arrayFieldsMerged.map((field) => `${field.label} (+${field.addedCount})`),
    ];
    const providers = preview.providerCleanupWarning.providers.join(", ");
    const childEffects = preview.conversations.childEffects;
    const messageAdjacentUpdated =
        childEffects.messageSyncRecordsUpdated +
        childEffects.messageTranslationCachesUpdated +
        childEffects.providerOutboxJobsUpdated +
        childEffects.whatsappOutboundOutboxJobsUpdated +
        childEffects.smsRelayOutboxJobsUpdated;

    return (
        <div className="rounded-md border bg-muted/20 p-3 text-sm space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <ContactSummary title="Source deleted" contact={preview.source} />
                <ContactSummary title="Target kept" contact={preview.target} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <PreviewStat label="Source conversations" value={`${preview.conversations.sourceCount}`} />
                <PreviewStat label="Messages affected" value={`${preview.conversations.messagesAffected}`} />
                <PreviewStat label="Conversations moved" value={`${preview.conversations.movedCount}`} />
                <PreviewStat label="Conversations merged" value={`${preview.conversations.mergedCount}`} />
                <PreviewStat label="Viewings moved" value={`${preview.viewingsAffected}`} />
                <PreviewStat label="Swipes moved" value={`${preview.swipesAffected}`} />
            </div>

            {preview.conversations.willMergeIntoExistingTargetConversation && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 space-y-1">
                    <div>A source conversation will be merged into an existing target conversation.</div>
                    <div className="text-xs">
                        Participants: {childEffects.participants.moved} moved, {childEffects.participants.deduped} deduped.
                    </div>
                    <div className="text-xs">
                        Sync records: {childEffects.syncRecords.moved} moved, {childEffects.syncRecords.deduped} deduped.
                    </div>
                    <div className="text-xs">
                        Tasks: {childEffects.tasksMoved} moved. Deal links: {childEffects.dealLinks.moved} moved, {childEffects.dealLinks.deduped} deduped.
                    </div>
                    <div className="text-xs">
                        Message sync/outbox/cache rows updated: {messageAdjacentUpdated}. Insights moved: {childEffects.insightsMoved}.
                    </div>
                </div>
            )}

            {childEffects.warnings.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                    <div className="font-medium">Conversation merge warnings</div>
                    <div className="mt-1 space-y-1 text-xs">
                        {childEffects.warnings.map((warning, index) => (
                            <div key={`${warning}-${index}`}>{warning}</div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid gap-1 text-muted-foreground">
                <div>
                    <span className="font-medium text-foreground">Property roles:</span>{" "}
                    {preview.roles.property.transferred} moved, {preview.roles.property.duplicatesRemoved} duplicate removed.
                </div>
                <div>
                    <span className="font-medium text-foreground">Company roles:</span>{" "}
                    {preview.roles.company.transferred} moved, {preview.roles.company.duplicatesRemoved} duplicate removed.
                </div>
                <div>
                    <span className="font-medium text-foreground">Tags added:</span>{" "}
                    {preview.tagsAdded.length > 0 ? preview.tagsAdded.join(", ") : "None"}
                </div>
                <div>
                    <span className="font-medium text-foreground">Blank target fields filled:</span>{" "}
                    {filledFields.length > 0 ? filledFields.join(", ") : "None"}
                </div>
            </div>

            {preview.providerCleanupWarning.hasProviderIds && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                    Source provider IDs exist for {providers}; external cleanup may run after the merge.
                </div>
            )}
        </div>
    );
}

function ContactSummary({
    title,
    contact,
}: {
    title: string;
    contact: MergeContactPreview["source"];
}) {
    return (
        <div className="min-w-0 rounded border bg-background p-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
            <div className="truncate font-medium">{contact.name || "Unnamed"}</div>
            <div className="truncate text-xs text-muted-foreground">{contact.phone || "No phone"}</div>
            <div className="truncate text-xs text-muted-foreground">{contact.email || "No email"}</div>
        </div>
    );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded border bg-background px-2 py-1">
            <div className="text-xs">{label}</div>
            <div className="font-medium text-foreground">{value}</div>
        </div>
    );
}
