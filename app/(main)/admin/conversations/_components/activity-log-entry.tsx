'use client';

import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pencil, UserPlus, Home, Merge, Import, NotebookPen, HelpCircle, Languages, ListChecks, Phone, PhoneCall, PhoneOff, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { memo, useEffect, useMemo, useState } from 'react';
import { formatViewingDateTimeWithTimeZoneLabel } from '@/lib/viewings/datetime';
import { LinkifiedText } from './linkified-text';
import {
    formatHistoryFieldName,
    formatHistoryValue,
    isRequirementHistoryAction,
    parseHistoryChanges,
    summarizeRequirementChanges,
} from '@/lib/contacts/history-formatting';
import { getConversationSurfaceTheme, type ConversationSurfaceTheme } from './message-bubble-theme';

const HIDDEN_WHATSAPP_CALL_DEBUG_ACTIONS = new Set([
    'WHATSAPP_CALL_REQUESTED',
    'WHATSAPP_CALL_READINESS_CHECKED',
    'WHATSAPP_CALL_CONSENTED',
    'WHATSAPP_CALL_ATTEMPTED',
    'WHATSAPP_CALL_SIGNALING_STARTED',
    'WHATSAPP_CALL_PROVIDER_RESULT',
]);

interface ActivityLogEntryProps {
    item: {
        id: string;
        createdAt: string | Date; // ISO string typically from server
        action: string;
        changes?: any;
        user?: { name: string | null; email: string | null } | null;
    };
    contactName?: string;
    surfaceTheme?: ConversationSurfaceTheme;
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

function formatQuickSessionKind(sessionKind: string | null | undefined) {
    if (sessionKind === "listen_only") return "Listen";
    if (sessionKind === "two_way_interpreter") return "Two-way interpreter";
    if (sessionKind === "quick_translate") return "Quick translate";
    return "Viewing";
}

function parseActivityPayload(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function formatVerificationStatus(value: unknown): string {
    switch (value) {
        case "verified_lead": return "Verified lead";
        case "likely_agent": return "Likely agent";
        case "likely_owner": return "Likely owner";
        case "not_a_lead": return "Not a lead";
        case "needs_review": return "Needs review";
        default: return value ? String(value) : "Verified lead";
    }
}

function formatContactVerificationFieldName(field: string): string {
    switch (field) {
        case "name": return "Display name";
        case "firstName": return "First name";
        case "lastName": return "Last name";
        case "contactType": return "Type";
        case "leadGoal": return "Goal";
        case "qualificationStage": return "Qualification stage";
        case "requirementSummary": return "Requirements";
        default: return formatHistoryFieldName(field);
    }
}

function ActivityLogEntryComponent({ item, contactName, surfaceTheme }: ActivityLogEntryProps) {
    const [expanded, setExpanded] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewPending, setPreviewPending] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [preview, setPreview] = useState<any | null>(null);
    
    const changes = useMemo(
        () => parseHistoryChanges(item.changes, item.action),
        [item.action, item.changes]
    );
    const rawPayload = useMemo(() => parseActivityPayload(item.changes), [item.changes]);
    const changeMap = useMemo(
        () => Object.fromEntries(changes.map((change) => [String(change.field || ''), change.new])),
        [changes]
    );
    const isRequirementsUpdate = isRequirementHistoryAction(item.action);
    const isContactVerificationUpdate = item.action === 'AI_CONTACT_VERIFICATION_AUTO_APPLIED' || item.action === 'CONTACT_VERIFIED';

    // Determine config based on action
    let Icon = HelpCircle;
    const resolvedSurfaceTheme = surfaceTheme || getConversationSurfaceTheme(null);
    let iconColor = "text-slate-500 bg-slate-100";
    let actionLabel = item.action;
    let description = "";

    const userLabel = item.user?.name || item.user?.email || 'System';
    const sessionThreadId = typeof changeMap.sessionThreadId === "string" ? changeMap.sessionThreadId : null;
    const hasSessionPreview = (
        (item.action === 'VIEWING_SESSION_SAVED' || item.action === 'VIEWING_SESSION_ATTACHED')
        && !!sessionThreadId
    );

    switch (item.action) {
        case 'MANUAL_ENTRY':
            Icon = NotebookPen;
            iconColor = resolvedSurfaceTheme.activityManualIconClassName;
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

        case 'VIEWING_SESSION_SAVED':
            Icon = Languages;
            iconColor = "text-cyan-700 bg-cyan-100";
            actionLabel = "Quick Session Saved";
            description = `${formatQuickSessionKind(String(changeMap.sessionKind || ""))} transcript saved`;
            break;

        case 'VIEWING_SESSION_ATTACHED':
            Icon = Languages;
            iconColor = "text-indigo-700 bg-indigo-100";
            actionLabel = "Quick Session Attached";
            description = `${formatQuickSessionKind(String(changeMap.sessionKind || ""))} linked back into CRM context`;
            break;

        case 'AI_REQUIREMENTS_UPDATED':
            Icon = ListChecks;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "Requirements Updated";
            description = summarizeRequirementChanges(changes);
            break;

        case 'CONTACT_VERIFIED':
            Icon = ShieldCheck;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "Contact Verified";
            description = "Marked as a verified buyer/renter lead";
            break;

        case 'AI_CONTACT_VERIFICATION_AUTO_APPLIED':
            Icon = ShieldCheck;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "Contact Verification Applied";
            const verificationStatus = formatVerificationStatus(rawPayload?.status);
            const verificationConfidence = rawPayload?.confidence;
            const confidence = typeof verificationConfidence === "number"
                ? ` · ${Math.round(verificationConfidence * 100)}% confidence`
                : "";
            const changedFields = changes.length > 0
                ? changes.slice(0, 2).map((change) => formatContactVerificationFieldName(change.field)).join(", ")
                : "";
            description = changedFields
                ? `${verificationStatus}${confidence} · Updated ${changedFields}${changes.length > 2 ? ` and ${changes.length - 2} more` : ""}`
                : `${verificationStatus}${confidence}`;
            break;

        case 'WHATSAPP_CALL_REQUESTED':
            Icon = Phone;
            iconColor = "text-cyan-700 bg-cyan-100";
            actionLabel = "WhatsApp Call Requested";
            description = String(changes.find(c => c.field === 'prompt')?.new || '');
            break;

        case 'WHATSAPP_CALL_READINESS_CHECKED':
            Icon = Phone;
            iconColor = "text-sky-700 bg-sky-100";
            actionLabel = "WhatsApp Calling Readiness Checked";
            description = String(
                changes.find(c => c.field === 'provider')?.new
                || changes.find(c => c.field === 'phoneNumberId')?.new
                || changes.find(c => c.field === 'mediaStatus')?.new
                || ''
            );
            break;

        case 'WHATSAPP_CALL_CONSENTED':
            Icon = PhoneCall;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "WhatsApp Call Consent";
            description = String(changes.find(c => c.field === 'reply')?.new || '');
            break;

        case 'WHATSAPP_CALL_ATTEMPTED':
            Icon = PhoneCall;
            iconColor = "text-blue-700 bg-blue-100";
            actionLabel = "WhatsApp Call Offer Attempted";
            description = String(
                changes.find(c => c.field === 'mediaStatus')?.new
                || changes.find(c => c.field === 'provider')?.new
                || 'meta_calling_api'
            );
            break;

        case 'WHATSAPP_CALL_SIGNALING_STARTED':
            Icon = PhoneCall;
            iconColor = "text-blue-700 bg-blue-100";
            actionLabel = "WhatsApp Call Signaling Started";
            description = String(
                changes.find(c => c.field === 'event')?.new
                || changes.find(c => c.field === 'callId')?.new
                || ''
            );
            break;

        case 'WHATSAPP_CALL_RINGING':
            Icon = PhoneCall;
            iconColor = "text-sky-700 bg-sky-100";
            actionLabel = "WhatsApp Call Ringing";
            description = String(changes.find(c => c.field === 'callId')?.new || '');
            break;

        case 'WHATSAPP_CALL_ACCEPTED':
            Icon = PhoneCall;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "WhatsApp Call Accepted";
            description = String(changes.find(c => c.field === 'callId')?.new || '');
            break;

        case 'WHATSAPP_CALL_REJECTED':
            Icon = PhoneOff;
            iconColor = "text-rose-700 bg-rose-100";
            actionLabel = "WhatsApp Call Rejected";
            description = String(changes.find(c => c.field === 'callId')?.new || '');
            break;

        case 'WHATSAPP_CALL_TIMEOUT':
            Icon = PhoneOff;
            iconColor = "text-amber-700 bg-amber-100";
            actionLabel = "WhatsApp Call Timeout";
            description = String(changes.find(c => c.field === 'callId')?.new || '');
            break;

        case 'WHATSAPP_CALL_MEDIA_UNKNOWN':
            Icon = Phone;
            iconColor = "text-amber-700 bg-amber-100";
            actionLabel = "WhatsApp Call Media Unknown";
            description = String(changes.find(c => c.field === 'mediaStatus')?.new || 'signaling_only');
            break;

        case 'WHATSAPP_CALL_MEDIA_CONNECTED':
            Icon = PhoneCall;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "WhatsApp Call Audio Connected";
            description = String(changes.find(c => c.field === 'callId')?.new || '');
            break;

        case 'WHATSAPP_CALL_PROVIDER_RESULT':
            Icon = PhoneCall;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "WhatsApp Call Bridge Event";
            description = String(changes.find(c => c.field === 'status')?.new || '');
            break;

        case 'WHATSAPP_CALL_STARTED':
            Icon = PhoneCall;
            iconColor = "text-emerald-700 bg-emerald-100";
            actionLabel = "WhatsApp Call Started";
            description = String(changes.find(c => c.field === 'providerCallId')?.new || changes.find(c => c.field === 'status')?.new || '');
            break;

        case 'WHATSAPP_CALL_ENDED':
            Icon = PhoneOff;
            iconColor = "text-slate-700 bg-slate-100";
            actionLabel = "WhatsApp Call Ended";
            description = String(changes.find(c => c.field === 'status')?.new || '');
            break;

        case 'WHATSAPP_CALL_FAILED':
            Icon = PhoneOff;
            iconColor = "text-rose-700 bg-rose-100";
            actionLabel = "WhatsApp Call Failed";
            description = String(changes.find(c => c.field === 'errorMessage')?.new || changes.find(c => c.field === 'status')?.new || '');
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

    useEffect(() => {
        if (!previewOpen || !sessionThreadId || preview || previewPending) return;

        let cancelled = false;
        setPreviewPending(true);
        setPreviewError(null);

        fetch(`/api/viewings/sessions/thread/${encodeURIComponent(sessionThreadId)}/preview`)
            .then(async (response) => {
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || "Failed to load viewing session preview.");
                }
                if (!cancelled) {
                    setPreview(payload.preview || null);
                }
            })
            .catch((error: any) => {
                if (!cancelled) {
                    setPreviewError(error?.message || "Failed to load viewing session preview.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setPreviewPending(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [previewOpen, preview, previewPending, sessionThreadId]);

    if (HIDDEN_WHATSAPP_CALL_DEBUG_ACTIONS.has(item.action)) {
        return null;
    }

    return (
        <div className="flex flex-col items-center justify-center my-2.5 sm:my-3 group">
            {/* Horizontal Line Container */}
            <div className="flex items-center w-full justify-center opacity-50 relative">
                <div className={cn("flex-1 border-t", resolvedSurfaceTheme.activityDividerClassName)}></div>
                <div className="px-2 min-w-0 max-w-full">
                    <div className={cn("flex flex-wrap sm:flex-nowrap items-center gap-1.5 px-2.5 py-0.5 rounded-full border shadow-sm transition-all hover:shadow min-w-0 max-w-full overflow-hidden", resolvedSurfaceTheme.activityPillClassName, resolvedSurfaceTheme.activityPillHoverClassName)} onClick={() => hasChanges ? setExpanded(!expanded) : null} style={{ cursor: hasChanges ? 'pointer' : 'default' }}>
                        <div className={cn("flex items-center justify-center p-0.5 rounded-full", iconColor)}>
                            <Icon className="w-3 h-3" />
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
                <div className={cn("flex-1 border-t", resolvedSurfaceTheme.activityDividerClassName)}></div>
            </div>

            {/* Content Payload (If any) */}
            {(description || expanded || hasSessionPreview) && (
                <div className={cn("mt-1.5 max-w-[80%] mx-auto relative z-10 w-full animate-in fade-in slide-in-from-top-2 duration-200 text-sm border shadow-sm rounded-lg px-2.5 py-1.5", resolvedSurfaceTheme.activityContentClassName)}>
                    {description && isManualEntry && (
                        <div className="text-slate-700 text-xs whitespace-pre-wrap leading-snug">
                            <LinkifiedText text={description} />
                        </div>
                    )}
                    
                    {description && !isManualEntry && !expanded && (
                         <div className="text-slate-500 text-xs text-center cursor-pointer" onClick={() => setExpanded(true)}>
                            {description}
                        </div>
                    )}

                    {hasSessionPreview && (
                        <div className="mt-1.5 flex justify-center">
                            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPreviewOpen(true)}>
                                View Session Preview
                            </Button>
                        </div>
                    )}

                    {expanded && hasChanges && (
                        isRequirementsUpdate ? (
                            <div className="mt-2 grid gap-1.5">
                                {changes.map((change, idx) => (
                                    <div key={idx} className="rounded-md border border-emerald-100 bg-emerald-50/60 px-2.5 py-1.5">
                                        <div className="text-[10px] font-semibold uppercase text-emerald-700">
                                            {formatHistoryFieldName(change.field)}
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                            <span className="max-w-full break-words text-slate-400 line-through [overflow-wrap:anywhere]">{formatHistoryValue(change.old)}</span>
                                            <span className="text-emerald-600">→</span>
                                            <span className="max-w-full break-words font-medium text-slate-800 [overflow-wrap:anywhere]">{formatHistoryValue(change.new)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs space-y-1 mt-1 border-l-2 border-slate-200 pl-2">
                                {changes.map((change, idx) => (
                                    <div key={idx} className="flex flex-col gap-0.5">
                                        {item.action === 'UPDATED' ? (
                                            <div className="grid min-w-0 grid-cols-[minmax(72px,auto)_minmax(0,1fr)] sm:grid-cols-[minmax(100px,auto)_minmax(0,1fr)] items-baseline gap-2">
                                                <span className="font-semibold text-slate-500 min-w-[72px] sm:min-w-[100px] text-right">{isContactVerificationUpdate ? formatContactVerificationFieldName(change.field) : formatHistoryFieldName(change.field)}:</span>
                                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                                    <span className="text-slate-400 line-through break-words [overflow-wrap:anywhere]">{formatHistoryValue(change.old)}</span>
                                                    <span className="text-slate-400">→</span>
                                                    <span className="text-slate-700 font-medium break-words [overflow-wrap:anywhere]">{formatHistoryValue(change.new)}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid min-w-0 grid-cols-[minmax(72px,auto)_minmax(0,1fr)] sm:grid-cols-[minmax(100px,auto)_minmax(0,1fr)] items-baseline gap-2">
                                                <span className="font-semibold text-slate-500 min-w-[72px] sm:min-w-[100px] text-right">{isContactVerificationUpdate ? formatContactVerificationFieldName(change.field) : formatHistoryFieldName(change.field)}:</span>
                                                <span className="text-slate-700 font-medium break-words [overflow-wrap:anywhere]">{formatHistoryValue(change.new)}</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            )}

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Viewing Session Preview</DialogTitle>
                        <DialogDescription>
                            Thread {sessionThreadId || "preview"} • {preview?.sessionCount || 1} chained session{preview?.sessionCount === 1 ? "" : "s"}
                        </DialogDescription>
                    </DialogHeader>

                    {previewPending && (
                        <div className="text-sm text-muted-foreground">Loading preview…</div>
                    )}

                    {previewError && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {previewError}
                        </div>
                    )}

                    {preview && (
                        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">{formatQuickSessionKind(preview.sessionKind)}</Badge>
                                <Badge variant="outline">{preview.participantMode === "agent_only" ? "Private" : "Shared"}</Badge>
                                <Badge variant="outline">{preview.savePolicy}</Badge>
                            </div>

                            {preview.contextSnapshot?.primaryProperty && (
                                <div className="rounded-md border px-3 py-2 text-sm">
                                    <div className="font-medium">{String(preview.contextSnapshot.primaryProperty.title || "Property")}</div>
                                    <div className="text-muted-foreground">
                                        {String(
                                            preview.contextSnapshot.leadProfile?.name
                                            || preview.contextSnapshot.leadProfile?.firstName
                                            || "No contact attached"
                                        )}
                                    </div>
                                </div>
                            )}

                            {preview.summary?.sessionSummary && (
                                <div className="space-y-1">
                                    <div className="text-sm font-medium">Summary</div>
                                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                                        {preview.summary.sessionSummary}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="text-sm font-medium">Transcript</div>
                                <div className="space-y-2">
                                    {Array.isArray(preview.messages) && preview.messages.length > 0 ? preview.messages.map((message: any) => (
                                        <div key={message.id} className="rounded-md border px-3 py-2 text-sm">
                                            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                                                <span>{message.speaker}</span>
                                                <span>{message.timestamp ? format(new Date(message.timestamp), 'MMM d, h:mm a') : ''}</span>
                                            </div>
                                            <div>{message.translatedText || message.originalText}</div>
                                            {message.translatedText && message.translatedText !== message.originalText && (
                                                <div className="mt-1 text-muted-foreground">{message.originalText}</div>
                                            )}
                                        </div>
                                    )) : (
                                        <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                                            No transcript saved for this session.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

export const ActivityLogEntry = memo(ActivityLogEntryComponent);
