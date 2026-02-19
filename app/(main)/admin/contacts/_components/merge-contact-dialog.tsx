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
import { AlertCircle, Check, ChevronsUpDown, Merge } from "lucide-react";
import { toast } from "sonner";
import { mergeContacts, searchContactsAction } from "@/app/(main)/admin/contacts/actions";
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
}

export function MergeContactDialog({ sourceContactId, sourceName, trigger }: MergeContactDialogProps) {
    const [open, setOpen] = useState(false);
    const [targetContactId, setTargetContactId] = useState<string | null>(null);
    const [isMerging, setIsMerging] = useState(false);

    // Search State
    const [searchOpen, setSearchOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

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

    const handleMerge = async () => {
        if (!targetContactId) {
            toast.error("Please select a contact to merge into.");
            return;
        }

        setIsMerging(true);
        try {
            const result = await mergeContacts(sourceContactId, targetContactId);
            if (result.success) {
                toast.success("Contacts merged successfully!");
                setOpen(false);
                // Force hard refresh to update UI and redirect
                // Use window.location.assign to avoid issues with space injection
                window.location.assign(`/admin/contacts/${targetContactId}/view`);
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
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Merge className="mr-2 h-4 w-4" />
                        Merge
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
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
                                    className="w-full justify-between"
                                >
                                    {targetContactId
                                        ? results.find((c) => c.id === targetContactId)?.name || results.find((c) => c.id === targetContactId)?.phone || "Selected Contact"
                                        : "Search contact..."}
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
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isMerging}>Cancel</Button>
                    <Button variant="destructive" onClick={handleMerge} disabled={!targetContactId || isMerging}>
                        {isMerging ? "Merging..." : "Confirm Merge"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
