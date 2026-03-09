'use client';

import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Pencil, UserPlus, Home, Merge, Import, NotebookPen, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { formatViewingDateTimeWithTimeZoneLabel } from '@/lib/viewings/datetime';

interface ActivityLogEntryProps {
    item: {
        id: string;
        createdAt: string | Date; // ISO string typically from server
        action: string;
        changes?: any;
        user?: { name: string | null; email: string | null } | null;
    };
    contactName?: string;
}

function formatChangeValue(val: any): string {
    if (val === null || val === undefined) return 'Empty';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function formatFieldName(field: string): string {
    const result = field.replace(/([A-Z])/g, " $1");
    const final = result.charAt(0).toUpperCase() + result.slice(1);
    return final;
}

function formatViewingWhen(changes: Array<{ field?: string; new?: unknown }>): string | null {
    const rawDate = changes.find((change) => change.field === "date")?.new;
    if (!rawDate) return null;

    const rawTimeZone = changes.find((change) => change.field === "timeZone")?.new;
    if (!rawTimeZone || typeof rawTimeZone !== "string") {
        return String(rawDate);
    }

    try {
        return formatViewingDateTimeWithTimeZoneLabel(new Date(String(rawDate)), rawTimeZone);
    } catch {
        return String(rawDate);
    }
}

export function ActivityLogEntry({ item, contactName }: ActivityLogEntryProps) {
    const [expanded, setExpanded] = useState(false);
    
    // Parse changes safely
    let changes: any[] = [];
    if (typeof item.changes === 'string') {
        try {
            changes = JSON.parse(item.changes);
            if (!Array.isArray(changes)) {
                changes = Object.entries(changes).map(([k, v]) => ({ field: k, old: null, new: v }));
            }
        } catch (e) {
            // ignore parse errors
        }
    } else if (item.changes && typeof item.changes === 'object') {
        if (Array.isArray(item.changes)) {
            changes = item.changes;
        } else {
            changes = Object.entries(item.changes).map(([k, v]) => ({ field: k, old: null, new: v }));
        }
    }

    // Determine config based on action
    let Icon = HelpCircle;
    let iconColor = "text-slate-500 bg-slate-100";
    let actionLabel = item.action;
    let description = "";

    const userLabel = item.user?.name || item.user?.email || 'System';

    switch (item.action) {
        case 'MANUAL_ENTRY':
            Icon = NotebookPen;
            iconColor = "text-blue-600 bg-blue-100";
            actionLabel = "Added Note";
            
            // Extract the note text and actual date if present
            const noteEntry = changes.find(c => c.field === 'entry')?.new;
            const actualDate = changes.find(c => c.field === 'date')?.new;
            
            if (noteEntry) {
                description = String(noteEntry);
            }
            break;
            
        case 'CREATED':
            Icon = UserPlus;
            iconColor = "text-emerald-600 bg-emerald-100";
            actionLabel = "Contact Created";
            break;
            
        case 'CREATED_FROM_GOOGLE':
            Icon = Import;
            iconColor = "text-teal-600 bg-teal-100";
            actionLabel = "Imported from Google";
            break;
            
        case 'UPDATED':
            Icon = Pencil;
            iconColor = "text-amber-600 bg-amber-100";
            actionLabel = "Contact Updated";
            if (changes.length > 0) {
                description = `${changes.length} field${changes.length > 1 ? 's' : ''} modified`;
            }
            break;
            
        case 'VIEWING_ADDED':
            Icon = Home;
            iconColor = "text-purple-600 bg-purple-100";
            actionLabel = "Viewing Scheduled";
            
            const p = changes.find(c => c.field === 'property')?.new;
            const whenAdded = formatViewingWhen(changes as any);
            if (p && whenAdded) description = `${String(p)} at ${whenAdded}`;
            else if (p) description = String(p);
            else if (whenAdded) description = whenAdded;
            break;
            
        case 'VIEWING_UPDATED':
            Icon = Home;
            iconColor = "text-purple-600 bg-purple-100";
            actionLabel = "Viewing Updated";
            const whenUpdated = formatViewingWhen(changes as any);
            if (whenUpdated) description = whenUpdated;
            break;

        case 'VIEWING_SCHEDULED':
            Icon = Home;
            iconColor = "text-purple-600 bg-purple-100";
            actionLabel = "Viewing Scheduled";
            const propertyScheduled = String(changes.find(c => c.field === 'property')?.new || '');
            const whenScheduled = formatViewingWhen(changes as any);
            if (propertyScheduled && whenScheduled) description = `${propertyScheduled} at ${whenScheduled}`;
            else description = propertyScheduled || whenScheduled || '';
            break;

        case 'VIEWING_COMPLETED':
            Icon = Home;
            iconColor = "text-emerald-600 bg-emerald-100";
            actionLabel = "Viewing Completed";
            description = String(changes.find(c => c.field === 'property')?.new || '');
            break;

        case 'VIEWING_CANCELLED':
            Icon = Home;
            iconColor = "text-rose-600 bg-rose-100";
            actionLabel = "Viewing Cancelled";
            description = String(changes.find(c => c.field === 'property')?.new || '');
            break;

        case 'TASK_OPEN':
            Icon = NotebookPen;
            iconColor = "text-amber-700 bg-amber-100";
            actionLabel = "Task Open";
            description = String(changes.find(c => c.field === 'title')?.new || '');
            break;

        case 'TASK_DONE':
            Icon = NotebookPen;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "Task Done";
            description = String(changes.find(c => c.field === 'title')?.new || '');
            break;
            
        case 'MERGED_FROM':
            Icon = Merge;
            iconColor = "text-slate-600 bg-slate-100";
            actionLabel = "Contact Merged";
            
            const sourceName = changes.find(c => c.field === 'sourceName')?.new;
            if (sourceName) description = `Merged data from ${sourceName}`;
            break;
    }

    const hasChanges = changes.length > 0 && item.action !== 'MANUAL_ENTRY';
    const isManualEntry = item.action === 'MANUAL_ENTRY';

    return (
        <div className="flex flex-col items-center justify-center my-6 group">
            {/* Horizontal Line Container */}
            <div className="flex items-center w-full justify-center opacity-50 relative">
                <div className="flex-1 border-t border-slate-300"></div>
                <div className="px-3 min-w-0 max-w-full">
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 px-3 py-1 bg-white rounded-full border border-slate-200 shadow-sm transition-all hover:bg-slate-50 hover:shadow min-w-0 max-w-full overflow-hidden" onClick={() => hasChanges ? setExpanded(!expanded) : null} style={{ cursor: hasChanges ? 'pointer' : 'default' }}>
                        <div className={cn("flex items-center justify-center p-1 rounded-full", iconColor)}>
                            <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-[11px] font-medium text-slate-700 sm:whitespace-nowrap">
                            {actionLabel}
                        </span>
                        <span className="text-[10px] text-slate-400 capitalize min-w-0 truncate max-w-[36vw] sm:max-w-[180px]">
                            by {userLabel}
                        </span>
                        {contactName ? (
                            <span className="text-[10px] text-slate-400 min-w-0 flex-1 truncate" title={contactName}>
                                · {contactName}
                            </span>
                        ) : null}
                        <span className="text-[10px] tabular-nums font-mono text-slate-400 ml-1 shrink-0 sm:whitespace-nowrap">
                            {format(new Date(item.createdAt), 'MMM d, h:mm a')}
                        </span>
                    </div>
                </div>
                <div className="flex-1 border-t border-slate-300"></div>
            </div>

            {/* Content Payload (If any) */}
            {(description || expanded) && (
                <div className="mt-2 max-w-[80%] mx-auto relative z-10 w-full animate-in fade-in slide-in-from-top-2 duration-200 text-sm bg-white border border-slate-200 shadow-sm rounded-lg px-3 py-2">
                    {description && isManualEntry && (
                        <div className="text-slate-700 text-xs whitespace-pre-wrap leading-relaxed py-0.5">
                            {description}
                        </div>
                    )}
                    
                    {description && !isManualEntry && !expanded && (
                         <div className="text-slate-500 text-xs text-center cursor-pointer" onClick={() => setExpanded(true)}>
                            {description}
                        </div>
                    )}

                    {expanded && hasChanges && (
                        <div className="text-xs space-y-1.5 mt-1 border-l-2 border-slate-200 pl-2">
                            {changes.map((change, idx) => (
                                <div key={idx} className="flex flex-col gap-0.5">
                                    {item.action === 'UPDATED' ? (
                                        <div className="grid min-w-0 grid-cols-[minmax(72px,auto)_minmax(0,1fr)] sm:grid-cols-[minmax(100px,auto)_minmax(0,1fr)] items-baseline gap-2">
                                            <span className="font-semibold text-slate-500 min-w-[72px] sm:min-w-[100px] text-right">{formatFieldName(change.field)}:</span>
                                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                                <span className="text-slate-400 line-through break-words [overflow-wrap:anywhere]">{formatChangeValue(change.old)}</span>
                                                <span className="text-slate-400">→</span>
                                                <span className="text-slate-700 font-medium break-words [overflow-wrap:anywhere]">{formatChangeValue(change.new)}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid min-w-0 grid-cols-[minmax(72px,auto)_minmax(0,1fr)] sm:grid-cols-[minmax(100px,auto)_minmax(0,1fr)] items-baseline gap-2">
                                            <span className="font-semibold text-slate-500 min-w-[72px] sm:min-w-[100px] text-right">{formatFieldName(change.field)}:</span>
                                            <span className="text-slate-700 font-medium break-words [overflow-wrap:anywhere]">{formatChangeValue(change.new)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
