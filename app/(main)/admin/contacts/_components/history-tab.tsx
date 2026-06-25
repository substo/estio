'use client';

import { useEffect, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CalendarIcon, Check, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addContactHistoryEntry, deleteManualActivityEntry, updateManualActivityEntry } from '../actions';
import { improveInternalNoteText } from '@/app/(main)/admin/conversations/actions';
import { toast } from 'sonner';
import { LeadScoreBadge } from './lead-score-badge';
import {
    formatHistoryFieldName,
    formatHistoryValue,
    isRequirementHistoryAction,
    parseHistoryChanges,
    summarizeRequirementChanges,
} from '@/lib/contacts/history-formatting';

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

function toDatetimeLocalValue(value: unknown): string {
    const date = value ? new Date(String(value)) : new Date();
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    const offsetMs = safeDate.getTimezoneOffset() * 60_000;
    return new Date(safeDate.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function HistoryTab({ history, loading, contact }: HistoryTabProps) {
    const [localHistory, setLocalHistory] = useState<HistoryItem[]>(history || []);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [editDate, setEditDate] = useState('');

    // Derive Publishing Info
    // Creator: Find first CREATED action
    const createdAction = localHistory.find(h => h.action === 'CREATED');
    const createdBy = createdAction?.user?.name || createdAction?.user?.email || 'System';
    const createdAt = contact?.createdAt ? new Date(contact.createdAt) : (createdAction ? new Date(createdAction.createdAt) : null);

    // Updater: Find first UPDATED action (history is desc) or use latest history item
    const lastUpdate = localHistory[0];
    const updatedBy = lastUpdate?.user?.name || lastUpdate?.user?.email || 'System';
    const updatedAt = contact?.updatedAt ? new Date(contact.updatedAt) : (lastUpdate ? new Date(lastUpdate.createdAt) : null);

    const [noteText, setNoteText] = useState('');
    const [noteDate, setNoteDate] = useState<Date | undefined>(new Date());
    const [isPending, startTransition] = useTransition();
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [isImprovingNote, setIsImprovingNote] = useState(false);

    useEffect(() => {
        setLocalHistory(history || []);
    }, [history]);

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

    const handleImproveNote = async () => {
        const sourceText = noteText.trim();
        if (!sourceText || !contact?.id || isImprovingNote) return;

        setIsImprovingNote(true);
        try {
            const result = await improveInternalNoteText({
                text: sourceText,
                noteType: 'activity',
                contactId: contact.id,
            });
            if (!result.success) {
                toast.error(result.error || 'Failed to improve note');
                return;
            }
            setNoteText(result.improvedText);
            toast.success('Entry improved');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to improve note');
        } finally {
            setIsImprovingNote(false);
        }
    };

    const openEdit = (item: HistoryItem, changes: Change[]) => {
        setEditingId(item.id);
        setEditText(String(changes.find((change) => change.field === 'entry')?.new || ''));
        setEditDate(toDatetimeLocalValue(changes.find((change) => change.field === 'date')?.new || item.createdAt));
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditText('');
        setEditDate('');
    };

    const handleSaveEdit = (item: HistoryItem) => {
        const nextText = editText.trim();
        if (!nextText || !editDate) return;

        startTransition(async () => {
            const result = await updateManualActivityEntry(item.id, nextText, new Date(editDate).toISOString());
            if (!result.success || !result.activityEntry) {
                toast.error(result.message || 'Failed to update entry');
                return;
            }
            setLocalHistory((prev) => prev.map((historyItem) => (
                historyItem.id === item.id
                    ? { ...historyItem, changes: result.activityEntry.changes }
                    : historyItem
            )));
            cancelEdit();
            toast.success('Entry updated');
        });
    };

    const handleDeleteEntry = (item: HistoryItem) => {
        if (!window.confirm('Delete this history entry?')) return;

        startTransition(async () => {
            const result = await deleteManualActivityEntry(item.id, 'Deleted by user');
            if (!result.success) {
                toast.error(result.message || 'Failed to delete entry');
                return;
            }
            setLocalHistory((prev) => prev.filter((historyItem) => historyItem.id !== item.id));
            toast.success('Entry deleted');
        });
    };

    if (loading) {
        return <div className="p-4 text-sm text-muted-foreground">Loading history...</div>;
    }

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
                                    variant="outline"
                                    className="w-full h-7 text-xs"
                                    onClick={handleImproveNote}
                                    disabled={isPending || isImprovingNote || !noteText.trim()}
                                >
                                    {isImprovingNote ? <><Wand2 className="mr-1 h-3 w-3 animate-pulse" />Improving...</> : <><Wand2 className="mr-1 h-3 w-3" />Improve</>}
                                </Button>
                                <Button
                                    size="sm"
                                    className="w-full h-7 text-xs"
                                    onClick={handleAddNote}
                                    disabled={isPending || isImprovingNote || !noteText.trim()}
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
                    {localHistory.length === 0 && (
                        <div className="p-4 text-sm text-muted-foreground">No history recorded yet.</div>
                    )}
                    {localHistory.map((item) => {
                        const changes = parseHistoryChanges(item.changes, item.action) as Change[];
                        const isRequirementsUpdate = isRequirementHistoryAction(item.action);
                        const isManualEntry = item.action === 'MANUAL_ENTRY';
                        const isEditing = editingId === item.id;

                        return (
                            <div key={item.id} className="flex flex-col gap-2 p-3 border rounded-lg bg-card text-card-foreground shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div className="flex gap-2 items-center">
                                        <Badge variant="outline" className="font-mono text-xs">
                                            {isRequirementsUpdate ? "REQUIREMENTS_UPDATED" : item.action}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            by {item.user?.name || item.user?.email || 'System'}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {format(new Date(item.createdAt), 'PP pp')}
                                    </span>
                                </div>

                                {isManualEntry && (
                                    <div className="flex justify-end gap-1">
                                        {isEditing ? (
                                            <>
                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit} disabled={isPending} title="Cancel edit">
                                                    <X className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(item)} disabled={isPending || !editText.trim() || !editDate} title="Save edit">
                                                    <Check className="h-3.5 w-3.5" />
                                                </Button>
                                            </>
                                        ) : (
                                            <>
                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item, changes)} disabled={isPending} title="Edit entry">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => handleDeleteEntry(item)} disabled={isPending} title="Delete entry">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                )}

                                {isEditing ? (
                                    <div className="space-y-2">
                                        <Input
                                            type="datetime-local"
                                            value={editDate}
                                            onChange={(event) => setEditDate(event.target.value)}
                                            className="h-8 text-xs"
                                        />
                                        <Textarea
                                            value={editText}
                                            onChange={(event) => setEditText(event.target.value)}
                                            className="min-h-[90px] resize-none text-xs"
                                        />
                                    </div>
                                ) : changes && changes.length > 0 && (
                                    isRequirementsUpdate ? (
                                        <div className="mt-1 space-y-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2">
                                            <div className="text-xs font-medium text-emerald-800">{summarizeRequirementChanges(changes)}</div>
                                            <div className="grid gap-1.5">
                                                {changes.map((change, idx) => (
                                                    <div key={idx} className="rounded border border-emerald-100 bg-white px-2 py-1 text-xs">
                                                        <div className="font-medium text-emerald-700">{formatHistoryFieldName(change.field)}</div>
                                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                            <span className="text-muted-foreground line-through break-words [overflow-wrap:anywhere]">{formatHistoryValue(change.old)}</span>
                                                            <span className="text-emerald-600">→</span>
                                                            <span className="font-medium break-words [overflow-wrap:anywhere]">{formatHistoryValue(change.new)}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm mt-1 space-y-1 pl-1 border-l-2 border-muted">
                                            {changes.map((change, idx) => (
                                                <div key={idx} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-xs">
                                                    <span className="font-medium text-muted-foreground text-right">{formatHistoryFieldName(change.field)}:</span>
                                                    <span className="text-muted-foreground">→</span>
                                                    <span className={change.field === 'status' || change.field === 'leadStage' ? 'font-semibold' : ''}>
                                                        {item.action === 'CREATED'
                                                            ? formatHistoryValue(change.new)
                                                            : item.action === 'VIEWING_ADDED' || item.action === 'VIEWING_UPDATED'
                                                                ? (
                                                                    <div className="flex flex-col gap-1 ml-2">
                                                                        {change.field === 'property' && <span className="text-foreground font-medium">{formatHistoryValue(change.new)}</span>}
                                                                        {change.field === 'date' && <span className="text-xs">{new Date(String(change.new)).toLocaleString()}</span>}
                                                                        {change.field === 'notes' && change.new && <span className="italic text-xs">"{formatHistoryValue(change.new)}"</span>}
                                                                        {!['property', 'date', 'notes'].includes(change.field) && formatHistoryValue(change.new)}
                                                                    </div>
                                                                )
                                                                : item.action === 'STAGE_CHANGED'
                                                                    ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <Badge variant="outline">{String(change.old || 'None')}</Badge>
                                                                            <span>→</span>
                                                                            <Badge variant="default">{String(change.new)}</Badge>
                                                                        </div>
                                                                    )
                                                                : item.action === 'SCORE_UPDATED'
                                                                    ? (
                                                                        <div className="flex items-center gap-2">
                                                                            {change.field === 'leadScore' ? (
                                                                                <>
                                                                                    <LeadScoreBadge score={Number(change.old || 0)} />
                                                                                    <span>→</span>
                                                                                    <LeadScoreBadge score={Number(change.new || 0)} />
                                                                                </>
                                                                            ) : change.field === 'reason' ? (
                                                                                <span className="text-xs italic text-muted-foreground">{formatHistoryValue(change.new)}</span>
                                                                            ) : (
                                                                                <>{formatHistoryValue(change.old)} <span className="text-muted-foreground mx-1">to</span> {formatHistoryValue(change.new)}</>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                : item.action === 'MANUAL_ENTRY'
                                                                    ? (
                                                                        <div className="flex flex-col gap-1 w-full pl-2">
                                                                            {change.field === 'date' && <span className="text-xs text-muted-foreground font-mono mb-1">{format(new Date(String(change.new)), 'PPP')}</span>}
                                                                            {change.field === 'entry' && <span className="text-foreground text-sm whitespace-pre-wrap">{formatHistoryValue(change.new)}</span>}
                                                                        </div>
                                                                    )
                                                                    : <>{formatHistoryValue(change.old)} <span className="text-muted-foreground mx-1">to</span> {formatHistoryValue(change.new)}</>
                                                        }
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )
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
