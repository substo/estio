'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CalendarIcon, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addContactHistoryEntry } from '../actions';
import { toast } from 'sonner';

type Change = {
    field: string;
    old: any;
    new: any;
};

type HistoryItem = {
    id: string;
    createdAt: Date;
    action: string;
    changes: any; // JSON
    user?: { name: string | null; email: string | null } | null;
};

interface HistoryTabProps {
    history: HistoryItem[];
    loading?: boolean;
    contact?: { id?: string; createdAt?: Date | string | null; updatedAt?: Date | string | null };
}

function formatChangeValue(val: any): string {
    if (val === null || val === undefined) return 'Empty';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function formatFieldName(field: string): string {
    // Convert camelCase to Title Case
    const result = field.replace(/([A-Z])/g, " $1");
    const final = result.charAt(0).toUpperCase() + result.slice(1);
    return final;
}

export function HistoryTab({ history, loading, contact }: HistoryTabProps) {
    if (loading) {
        return <div className="p-4 text-sm text-muted-foreground">Loading history...</div>;
    }

    if (!history || history.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground">No history recorded yet.</div>;
    }



    // Derive Publishing Info
    // Creator: Find first CREATED action
    const createdAction = history.find(h => h.action === 'CREATED');
    const createdBy = createdAction?.user?.name || createdAction?.user?.email || 'System';
    const createdAt = contact?.createdAt ? new Date(contact.createdAt) : (createdAction ? new Date(createdAction.createdAt) : null);

    // Updater: Find first UPDATED action (history is desc) or use latest history item
    const lastUpdate = history[0];
    const updatedBy = lastUpdate?.user?.name || lastUpdate?.user?.email || 'System';
    const updatedAt = contact?.updatedAt ? new Date(contact.updatedAt) : (lastUpdate ? new Date(lastUpdate.createdAt) : null);

    const [noteText, setNoteText] = useState('');
    const [noteDate, setNoteDate] = useState<Date | undefined>(new Date());
    const [isPending, startTransition] = useTransition();
    const [isAddingNote, setIsAddingNote] = useState(false);

    const handleAddNote = () => {
        if (!noteText.trim() || !contact?.id) return;

        startTransition(async () => {
            const dateStr = noteDate ? noteDate.toISOString() : new Date().toISOString();
            const result = await addContactHistoryEntry(contact.id!, noteText, dateStr);
            if (result.success) {
                toast.success('Entry added');
                setNoteText('');
                setIsAddingNote(false);
            } else {
                toast.error(result.message);
            }
        });
    };

    return (
        <div className="flex flex-col h-[600px]">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium">Activity Log</h3>
                <Popover open={isAddingNote} onOpenChange={setIsAddingNote}>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1">
                            <Plus className="h-3.5 w-3.5" />
                            Add History Entry
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-3" align="end">
                        <div className="space-y-3">
                            <h4 className="font-medium text-xs leading-none">Add History Entry</h4>
                            <div className="space-y-2">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                                "w-full justify-start text-left font-normal h-8 text-xs",
                                                !noteDate && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-3 w-3" />
                                            {noteDate ? format(noteDate, "PPP") : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={noteDate}
                                            onSelect={setNoteDate}
                                            disabled={(date) =>
                                                date > new Date() || date < new Date("1900-01-01")
                                            }
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <Textarea
                                    placeholder="Enter history details..."
                                    className="h-20 text-xs resize-none"
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                />
                                <Button
                                    size="sm"
                                    className="w-full h-7 text-xs"
                                    onClick={handleAddNote}
                                    disabled={isPending || !noteText.trim()}
                                >
                                    {isPending ? 'Saving...' : 'Save Entry'}
                                </Button>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            <div className="flex-1 pr-4 overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                    {history.map((item) => {
                        let changes: Change[] = [];
                        // Parse changes if string, or use as is if already object (Prisma Json)
                        if (typeof item.changes === 'string') {
                            try {
                                changes = JSON.parse(item.changes);
                                // Adjust for VIEWING_ADDED which might store object directly not array
                                if (!Array.isArray(changes)) {
                                    changes = Object.entries(changes).map(([k, v]) => ({ field: k, old: null, new: v }));
                                }
                            } catch (e) {
                                // fallback
                                console.error("Failed to parse history changes", e);
                            }
                        } else if (item.changes && typeof item.changes === 'object') {
                            if (Array.isArray(item.changes)) {
                                changes = item.changes;
                            } else {
                                // Handle single object case (e.g. Viewing) which might be stored as { propertyId: ... }
                                changes = Object.entries(item.changes).map(([k, v]) => ({ field: k, old: null, new: v }));
                            }
                        }

                        return (
                            <div key={item.id} className="flex flex-col gap-2 p-3 border rounded-lg bg-card text-card-foreground shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div className="flex gap-2 items-center">
                                        <Badge variant="outline" className="font-mono text-xs">
                                            {item.action}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            by {item.user?.name || item.user?.email || 'System'}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {format(new Date(item.createdAt), 'PP pp')}
                                    </span>
                                </div>

                                {changes && changes.length > 0 && (
                                    <div className="text-sm mt-1 space-y-1 pl-1 border-l-2 border-muted">
                                        {changes.map((change, idx) => (
                                            <div key={idx} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-xs">
                                                <span className="font-medium text-muted-foreground text-right">{formatFieldName(change.field)}:</span>
                                                <span className="text-muted-foreground">→</span>
                                                <span className={change.field === 'status' || change.field === 'leadStage' ? 'font-semibold' : ''}>
                                                    {item.action === 'CREATED'
                                                        ? formatChangeValue(change.new)
                                                        : item.action === 'VIEWING_ADDED' || item.action === 'VIEWING_UPDATED'
                                                            ? (
                                                                <div className="flex flex-col gap-1 ml-2">
                                                                    {/* For viewings, we expect specific fields like Property and Date */}
                                                                    {change.field === 'property' && <span className="text-foreground font-medium">{formatChangeValue(change.new)}</span>}
                                                                    {change.field === 'date' && <span className="text-xs">{new Date(change.new).toLocaleString()}</span>}
                                                                    {change.field === 'notes' && change.new && <span className="italic text-xs">"{formatChangeValue(change.new)}"</span>}
                                                                    {/* Fallback for other fields */}
                                                                    {!['property', 'date', 'notes'].includes(change.field) && formatChangeValue(change.new)}
                                                                </div>
                                                            )
                                                            : item.action === 'MANUAL_ENTRY'
                                                                ? (
                                                                    <div className="flex flex-col gap-1 w-full pl-2">
                                                                        {change.field === 'date' && <span className="text-xs text-muted-foreground font-mono mb-1">{format(new Date(change.new), 'PPP')}</span>}
                                                                        {change.field === 'entry' && <span className="text-foreground text-sm whitespace-pre-wrap">{formatChangeValue(change.new)}</span>}
                                                                    </div>
                                                                )
                                                                : <>{formatChangeValue(change.old)} <span className="text-muted-foreground mx-1">to</span> {formatChangeValue(change.new)}</>
                                                    }
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Publishing Info Footer */}
            <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg">
                <div>
                    <span className="font-medium text-foreground block mb-1">Created by</span>
                    <div className="flex flex-col">
                        <span>{createdBy}</span>
                        <span>{createdAt ? format(createdAt, 'PP pp') : '-'}</span>
                    </div>
                </div>
                <div>
                    <span className="font-medium text-foreground block mb-1">Updated by</span>
                    <div className="flex flex-col">
                        <span>{updatedBy}</span>
                        <span>{updatedAt ? format(updatedAt, 'PP pp') : '-'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
