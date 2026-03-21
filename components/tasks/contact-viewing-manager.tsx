'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Plus, Trash2, CheckCircle2, Clock3, AlertCircle, Ban, Pencil, Minus, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    createViewing,
    updateViewing,
    deleteViewing,
} from '@/app/(main)/admin/contacts/actions';
import { improveInternalNoteText } from '@/app/(main)/admin/conversations/actions';
import { getContactViewings, getPropertiesForSelect, getUsersForSelect } from '@/app/(main)/admin/contacts/fetch-helpers';
import { SearchableSelect } from '@/app/(main)/admin/contacts/_components/searchable-select';
import {
    formatDateTimeLocalInTimeZone,
    formatViewingDateTimeWithTimeZoneLabel,
    getTimeZoneShortLabel,
} from '@/lib/viewings/datetime';
import { toast } from 'sonner';

// Reuse the badge logic from Tasks, adapting it for viewings
const VIEWING_SYNC_MAX_ATTEMPTS = 6;
const VIEWING_DURATION_DEFAULT = 30;
const VIEWING_DURATION_STEP = 15;
const VIEWING_DURATION_MIN = 15;
const VIEWING_DURATION_MAX = 480;

type SyncRecord = { provider: string; status?: string | null; lastSyncedAt?: string | Date | null; lastError?: string | null };
type OutboxJob = { provider: string; status?: string | null; operation?: string | null; attemptCount?: number | null; scheduledAt?: string | Date | null; lastError?: string | null; createdAt?: string | Date | null };
type ProviderSyncStatus = 'synced' | 'error' | 'pending' | 'processing' | 'retrying' | 'dead' | 'disabled';
type ProviderBadge = { provider: string; key: string; status: ProviderSyncStatus; attemptsText?: string; title?: string };

const PROVIDER_ICON_SOURCES: Record<string, { src: string; alt: string }> = {
    ghl: { src: 'https://www.gohighlevel.com/favicon.ico', alt: 'GoHighLevel' },
    google: { src: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg', alt: 'Google Calendar' },
};

function formatDueLabel(input?: Date | string | null) {
    if (!input) return null;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return null;
    return format(date, 'PPp');
}

function normalizeViewingDuration(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return VIEWING_DURATION_DEFAULT;
    const snapped = Math.round(parsed / VIEWING_DURATION_STEP) * VIEWING_DURATION_STEP;
    return Math.min(VIEWING_DURATION_MAX, Math.max(VIEWING_DURATION_MIN, snapped));
}

function formatViewingDuration(value: number): string {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function getProviderSyncTone(status: ProviderSyncStatus) {
    if (status === 'synced') return 'bg-emerald-50 border-emerald-200';
    if (status === 'processing') return 'bg-blue-50 border-blue-200';
    if (status === 'pending') return 'bg-sky-50 border-sky-200';
    if (status === 'retrying') return 'bg-amber-50 border-amber-200';
    if (status === 'dead' || status === 'error') return 'bg-red-50 border-red-200';
    if (status === 'disabled') return 'bg-zinc-50 border-zinc-200';
    return 'bg-slate-50 border-slate-200';
}

function getProviderName(provider: string) {
    const normalized = String(provider || '').toLowerCase();
    if (normalized === 'ghl') return 'GoHighLevel';
    if (normalized === 'google') return 'Google Calendar';
    return provider.toUpperCase();
}

function getProviderStatusLabel(status: ProviderSyncStatus, attemptsText?: string) {
    if (status === 'synced') return 'synced';
    if (status === 'processing') return 'syncing now';
    if (status === 'retrying') return attemptsText ? `retrying (${attemptsText})` : 'retrying';
    if (status === 'pending') return 'queued';
    if (status === 'disabled') return 'disabled';
    if (status === 'dead') return 'attention required';
    return 'sync error';
}

function renderProviderStatusIcon(status: ProviderSyncStatus) {
    if (status === 'synced') return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
    if (status === 'processing') return <Loader2 className="h-3 w-3 animate-spin text-blue-600" />;
    if (status === 'pending') return <Clock3 className="h-3 w-3 text-sky-600" />;
    if (status === 'retrying') return <Clock3 className="h-3 w-3 text-amber-600" />;
    if (status === 'disabled') return <Ban className="h-3 w-3 text-zinc-600" />;
    return <AlertCircle className="h-3 w-3 text-red-600" />;
}

function ProviderPlatformIcon({ provider }: { provider: string }) {
    const normalized = String(provider || '').toLowerCase();
    const source = PROVIDER_ICON_SOURCES[normalized];
    const [failedToLoad, setFailedToLoad] = useState(false);

    if (!source || failedToLoad) {
        return (
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-slate-200 text-[9px] font-semibold text-slate-700">
                {normalized.slice(0, 2).toUpperCase() || '?'}
            </span>
        );
    }

    return (
        <img src={source.src} alt={source.alt} className="h-3.5 w-3.5 shrink-0 rounded-[2px]" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedToLoad(true)} />
    );
}

function pickProviderOutboxState(outboxJobs: OutboxJob[]) {
    if (!outboxJobs.length) return null;
    const byPriority = ['dead', 'failed', 'processing', 'pending'];
    for (const status of byPriority) {
        const match = outboxJobs.filter((job) => (job.status || '').toLowerCase() === status).sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0))[0];
        if (match) return match;
    }
    return null;
}

function buildProviderBadges(syncRecords: SyncRecord[], outboxJobs: OutboxJob[]): ProviderBadge[] {
    const providers = new Set<string>();
    syncRecords.forEach((record) => providers.add(String(record.provider || '').toLowerCase()));
    outboxJobs.forEach((job) => providers.add(String(job.provider || '').toLowerCase()));

    const badges: ProviderBadge[] = [];

    for (const provider of providers) {
        if (!provider) continue;
        const syncRecord = syncRecords.find((record) => String(record.provider || '').toLowerCase() === provider);
        const providerOutbox = outboxJobs.filter((job) => String(job.provider || '').toLowerCase() === provider);
        const outboxState = pickProviderOutboxState(providerOutbox);

        if (outboxState) {
            const status = String(outboxState.status || '').toLowerCase();

            if (status === 'dead') {
                badges.push({ provider, key: `${provider}-dead`, status: 'dead', title: outboxState.lastError || 'Sync is dead; requires manual intervention' });
                continue;
            }
            if (status === 'failed') {
                const attempts = Math.max(1, Number(outboxState.attemptCount || 1));
                const nextRetry = formatDueLabel(outboxState.scheduledAt || null);
                const retryTitle = nextRetry ? `Retry ${attempts}/${VIEWING_SYNC_MAX_ATTEMPTS} scheduled for ${nextRetry}` : `Retry ${attempts}/${VIEWING_SYNC_MAX_ATTEMPTS} scheduled`;
                badges.push({ provider, key: `${provider}-retrying`, status: 'retrying', attemptsText: `${attempts}/${VIEWING_SYNC_MAX_ATTEMPTS}`, title: outboxState.lastError ? `${retryTitle}\n${outboxState.lastError}` : retryTitle });
                continue;
            }
            if (status === 'processing') {
                badges.push({ provider, key: `${provider}-processing`, status: 'processing', title: 'Sync operation in progress' });
                continue;
            }
            badges.push({ provider, key: `${provider}-pending`, status: 'pending', title: 'Sync queued' });
            continue;
        }

        const syncStatus = String(syncRecord?.status || '').toLowerCase();
        if (syncStatus === 'synced') {
            badges.push({ provider, key: `${provider}-synced`, status: 'synced', title: syncRecord?.lastSyncedAt ? `Last synced ${formatDueLabel(syncRecord.lastSyncedAt)}` : 'Synced' });
            continue;
        }
        if (syncStatus === 'disabled') {
            continue; // hide completely if disabled by rule for viewings
        }
        if (syncStatus === 'error') {
            badges.push({ provider, key: `${provider}-error`, status: 'error', title: syncRecord?.lastError || 'Last sync attempt failed' });
            continue;
        }
        badges.push({ provider, key: `${provider}-pending`, status: 'pending', title: 'Awaiting first successful sync' });
    }

    return badges.sort((a, b) => a.provider.localeCompare(b.provider));
}

function normalizeViewing(viewing: any) {
    return {
        ...viewing,
        syncRecords: Array.isArray(viewing?.syncRecords) ? viewing.syncRecords : [],
        outboxJobs: Array.isArray(viewing?.outboxJobs) ? viewing.outboxJobs : [],
    };
}

export function ContactViewingManager({
    contactId,
    locationId,
    compact = false,
    className,
    title = null,
    isEditing = true
}: {
    contactId: string;
    locationId: string;
    compact?: boolean;
    className?: string;
    title?: string | null;
    isEditing?: boolean;
}) {
    const [viewings, setViewings] = useState<any[]>([]);
    const [properties, setProperties] = useState<{ id: string; title: string; unitNumber?: string | null }[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string | null; email: string; ghlCalendarId?: string | null; timeZone?: string | null; effectiveTimeZone?: string | null }[]>([]);
    const [loading, setLoading] = useState(true);

    const [modalOpen, setModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [viewingDate, setViewingDate] = useState('');
    const [viewingPropertyId, setViewingPropertyId] = useState('');
    const [viewingUserId, setViewingUserId] = useState('');
    const [viewingTitle, setViewingTitle] = useState('');
    const [viewingDescription, setViewingDescription] = useState('');
    const [improvingViewingDescription, setImprovingViewingDescription] = useState(false);
    const [viewingLocation, setViewingLocation] = useState('');
    const [viewingDuration, setViewingDuration] = useState<number>(VIEWING_DURATION_DEFAULT);
    const [editingViewingId, setEditingViewingId] = useState<string | null>(null);

    // Deletion Modal
    const [viewingToDeleteId, setViewingToDeleteId] = useState<string | null>(null);

    // Initial Defaults
    const [defaultUserId, setDefaultUserId] = useState('');
    const [interestedProps, setInterestedProps] = useState<string[]>([]);

    const loadRequestIdRef = useRef(0);
    const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

    const loadData = useCallback(async (options?: { silent?: boolean }) => {
        const silent = options?.silent ?? false;
        if (!contactId) return;
        const requestId = ++loadRequestIdRef.current;

        if (!silent) setLoading(true);

        try {
            const [viewingsRes, props, usrs] = await Promise.all([
                getContactViewings(contactId),
                getPropertiesForSelect(locationId),
                getUsersForSelect(locationId)
            ]);

            if (requestId !== loadRequestIdRef.current) return;

            const res = viewingsRes || { viewings: [], currentUserId: null, interestedProperties: [] };
            setViewings((res.viewings || []).map(normalizeViewing));
            setProperties(props);
            setUsers(usrs);
            setError(null);

            // Set Defaults
            if (res.currentUserId) setDefaultUserId(res.currentUserId);
            if (res.interestedProperties) setInterestedProps(res.interestedProperties);
        } catch (e: any) {
            if (requestId !== loadRequestIdRef.current) return;
            setError(e?.message || 'Failed to load viewings');
        } finally {
            if (requestId !== loadRequestIdRef.current) return;
            setLoading(false);
        }
    }, [contactId, locationId]);

    useEffect(() => {
        void loadData();
        // No specific viewing mutated event logic yet, could add window event listener here
    }, [loadData]);

    const selectedViewingAgentTimeZone = useMemo(() => {
        const selectedUser = users.find((user) => user.id === viewingUserId);
        return selectedUser?.effectiveTimeZone || selectedUser?.timeZone || null;
    }, [users, viewingUserId]);

    const selectedViewingAgentTimeZoneLabel = useMemo(() => {
        if (!selectedViewingAgentTimeZone) return null;
        try {
            return getTimeZoneShortLabel(new Date(), selectedViewingAgentTimeZone);
        } catch {
            return null;
        }
    }, [selectedViewingAgentTimeZone]);

    const selectedViewingPropertyReference = useMemo(() => {
        const selected = properties.find((property) => property.id === viewingPropertyId);
        if (!selected) return "";
        if (selected.unitNumber) return `[${selected.unitNumber}] ${selected.title}`;
        return selected.title;
    }, [properties, viewingPropertyId]);

    const canSubmit = useMemo(
        () => Boolean(viewingDate && viewingPropertyId && viewingUserId && selectedViewingAgentTimeZone && !submitting),
        [viewingDate, viewingPropertyId, viewingUserId, selectedViewingAgentTimeZone, submitting]
    );

    const handleImproveViewingDescription = async () => {
        const sourceText = viewingDescription.trim();
        if (!sourceText || improvingViewingDescription) return;

        setImprovingViewingDescription(true);
        setError(null);
        try {
            const result = await improveInternalNoteText({
                text: sourceText,
                noteType: "viewing",
                contactId,
                context: {
                    propertyReference: selectedViewingPropertyReference || undefined,
                    scheduledLocal: viewingDate || undefined,
                },
            });
            if (!result.success) {
                setError(result.error || "Failed to improve viewing notes.");
                return;
            }
            setViewingDescription(result.improvedText);
            toast.success("Viewing notes improved");
        } catch (error: any) {
            setError(error?.message || "Failed to improve viewing notes.");
        } finally {
            setImprovingViewingDescription(false);
        }
    };

    const handleSubmit = async () => {
        if (!canSubmit) return;

        if (!contactId) {
            setError("No contact associated with this conversation. Please link a contact first.");
            return;
        }

        setSubmitting(true);
        setError(null);

        const formData = new FormData();
        formData.append('contactId', contactId);
        formData.append('propertyId', viewingPropertyId);
        formData.append('userId', viewingUserId);
        formData.append('scheduledLocal', viewingDate);
        if (selectedViewingAgentTimeZone) {
            formData.append('scheduledTimeZone', selectedViewingAgentTimeZone);
        }
        // Legacy fallback field still accepted by server action.
        formData.append('date', viewingDate);
        formData.append('title', viewingTitle);
        formData.append('description', viewingDescription);
        formData.append('location', viewingLocation);
        formData.append('duration', String(viewingDuration));

        try {
            let result;
            if (editingViewingId) {
                formData.append('viewingId', editingViewingId);
                result = await updateViewing(null, formData);
            } else {
                result = await createViewing(null, formData);
            }

            if (result.success) {
                setModalOpen(false);
                void loadData({ silent: true });
                // Don't fully reset form — let onOpen logic handle defaults next time
            } else {
                setError(result.message || 'Operation failed');
            }
        } catch (e: any) {
            setError(e?.message || 'Unexpected error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = (viewing: any) => {
        setEditingViewingId(viewing.id);
        const fallbackTimeZone = users.find((user) => user.id === viewing.userId)?.effectiveTimeZone
            || users.find((user) => user.id === viewing.userId)?.timeZone
            || browserTimeZone;
        const targetTimeZone = viewing.scheduledTimeZone || fallbackTimeZone;

        let localISOTime = '';
        try {
            localISOTime = formatDateTimeLocalInTimeZone(viewing.date, targetTimeZone);
        } catch {
            const dateObj = new Date(viewing.date);
            const offset = dateObj.getTimezoneOffset() * 60000;
            localISOTime = (new Date(dateObj.getTime() - offset)).toISOString().slice(0, 16);
        }

        setViewingDate(localISOTime);
        setViewingPropertyId(viewing.propertyId);
        setViewingUserId(viewing.userId);
        setViewingTitle(viewing.title || '');
        setViewingDescription(viewing.description || viewing.notes || '');
        setViewingLocation(viewing.location || '');
        setViewingDuration(normalizeViewingDuration(viewing.duration));
        setModalOpen(true);
    };

    const handleDelete = async (viewingId: string) => {
        setViewingToDeleteId(viewingId);
    };

    const confirmDelete = async () => {
        if (!viewingToDeleteId) return;

        try {
            const result = await deleteViewing(viewingToDeleteId);
            if (result.success) {
                void loadData({ silent: true });
            } else {
                setError(result.message || 'Failed to delete viewing.');
            }
        } catch (e) {
            setError('Error deleting viewing');
            console.error(e);
        } finally {
            setViewingToDeleteId(null);
        }
    };

    const resetForm = () => {
        setViewingDate('');
        setViewingTitle('');
        setViewingDescription('');
        setViewingLocation('');
        setViewingDuration(VIEWING_DURATION_DEFAULT);
        setEditingViewingId(null);

        // Apply smart defaults for New Viewings
        setViewingUserId(defaultUserId || '');
        // Pre-select first interested property if one exists and isn't already selected
        if (interestedProps.length > 0) {
            setViewingPropertyId(interestedProps[0]);
        } else {
            setViewingPropertyId('');
        }
    };

    return (
        <div className={cn('space-y-3', className)}>
            {title && (
                <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{title}</div>
                    {isEditing && (
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { resetForm(); setModalOpen(true); }}>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Add Viewing
                        </Button>
                    )}
                </div>
            )}

            {!title && isEditing && (
                <div className="flex items-center justify-end">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { resetForm(); setModalOpen(true); }}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add Viewing
                    </Button>
                </div>
            )}

            {error && <div className="text-xs text-red-600">{error}</div>}

            <div className="space-y-2">
                {loading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading viewings...
                    </div>
                ) : viewings.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">No viewings recorded.</div>
                ) : (
                    viewings.map((viewing) => {
                        const fallbackTimeZone = users.find((user) => user.id === viewing.userId)?.effectiveTimeZone
                            || users.find((user) => user.id === viewing.userId)?.timeZone
                            || browserTimeZone;
                        const viewingTimeZone = viewing.scheduledTimeZone || fallbackTimeZone;
                        let dateLabel = formatDueLabel(viewing.date);
                        try {
                            dateLabel = formatViewingDateTimeWithTimeZoneLabel(viewing.date, viewingTimeZone);
                        } catch {
                            // Keep local browser fallback if timezone metadata is missing/invalid.
                        }
                        const providerBadges = buildProviderBadges(viewing.syncRecords, viewing.outboxJobs);
                        const propertyName = viewing.property.unitNumber ? `[${viewing.property.unitNumber}] ${viewing.property.title}` : viewing.property.title;

                        return (
                            <div key={viewing.id} className="rounded-md border bg-card p-2.5 text-xs space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-medium text-sm text-foreground">{propertyName}</span>
                                        <span className="text-muted-foreground">{viewing.user.name}</span>
                                    </div>

                                    {isEditing && (
                                        <div className="flex items-center gap-1">
                                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => handleEdit(viewing)}>
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(viewing.id)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {viewing.description && (
                                    <div className="text-muted-foreground whitespace-pre-wrap text-[11px] bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded p-1.5 pt-0 mt-0">{viewing.description}</div>
                                )}
                                {!viewing.description && viewing.notes && (
                                    <div className="text-muted-foreground whitespace-pre-wrap text-[11px] bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded p-1.5 pt-0 mt-0">{viewing.notes}</div>
                                )}

                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    {dateLabel && (
                                        <span className="inline-flex h-5 items-center px-1.5 rounded-md border text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                            <Clock3 className="h-3 w-3 mr-1" />
                                            {dateLabel}
                                        </span>
                                    )}
                                    {providerBadges.map((badge) => (
                                        <span key={`${viewing.id}-${badge.key}`} className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px]', getProviderSyncTone(badge.status))} title={badge.title}>
                                            <ProviderPlatformIcon provider={badge.provider} />
                                            {renderProviderStatusIcon(badge.status)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <Dialog open={modalOpen} onOpenChange={(open) => { setModalOpen(open); if (!open) resetForm(); }}>
                <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingViewingId ? 'Edit Viewing' : 'Schedule Viewing'}</DialogTitle>
                        <DialogDescription>
                            {editingViewingId ? 'Update the details of the viewing below.' : 'Enter the details for the new viewing. It will sync automatically to Google Calendar and GHL if configured.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {/* Title */}
                        <div className="space-y-2">
                            <Label>Title <span className="text-muted-foreground text-[10px]">(optional — auto-generated from property if blank)</span></Label>
                            <Input value={viewingTitle} onChange={e => setViewingTitle(e.target.value)} placeholder="e.g. Viewing: 3BR Villa in Limassol" />
                        </div>

                        {/* Property & Agent */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Property <span className="text-red-500">*</span></Label>
                                {!locationId ? (
                                    <div className="text-xs text-amber-600 py-2">No location configured</div>
                                ) : (
                                    <SearchableSelect
                                        name="viewingPropertyId"
                                        value={viewingPropertyId}
                                        onChange={setViewingPropertyId}
                                        options={properties.map(p => ({
                                            value: p.id,
                                            label: (p as any).reference ? `[${(p as any).reference}] ${p.title}` : (p as any).unitNumber ? `[${(p as any).unitNumber}] ${p.title}` : p.title
                                        }))}
                                        placeholder="Select Property..."
                                        searchPlaceholder="Search Property... (+ Ref)"
                                    />
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label>Assigned Agent <span className="text-red-500">*</span></Label>
                                {!locationId ? (
                                    <div className="text-xs text-amber-600 py-2">No location configured</div>
                                ) : (
                                    <Select value={viewingUserId} onValueChange={setViewingUserId}>
                                        <SelectTrigger><SelectValue placeholder="Select Agent" /></SelectTrigger>
                                        <SelectContent>
                                            {users.map(u => (
                                                <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </div>

                        {/* Date/Time & Duration */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Date & Time <span className="text-red-500">*</span></Label>
                                <Input
                                    type="datetime-local"
                                    step={300}
                                    value={viewingDate}
                                    onChange={e => setViewingDate(e.target.value)}
                                />
                                <div className={cn(
                                    "text-[11px]",
                                    selectedViewingAgentTimeZone ? "text-muted-foreground" : "text-red-600"
                                )}>
                                    {selectedViewingAgentTimeZone
                                        ? `Interpreted in ${selectedViewingAgentTimeZoneLabel || "local"} (${selectedViewingAgentTimeZone}).`
                                        : "Missing timezone for selected agent/location. Configure timezone before saving."}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Duration</Label>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9"
                                        onClick={() => setViewingDuration((prev) => Math.max(VIEWING_DURATION_MIN, prev - VIEWING_DURATION_STEP))}
                                        disabled={viewingDuration <= VIEWING_DURATION_MIN}
                                    >
                                        <Minus className="h-4 w-4" />
                                    </Button>
                                    <div className="flex h-9 min-w-[120px] items-center justify-center rounded-md border bg-background px-3 text-sm font-medium">
                                        {formatViewingDuration(viewingDuration)}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9"
                                        onClick={() => setViewingDuration((prev) => Math.min(VIEWING_DURATION_MAX, prev + VIEWING_DURATION_STEP))}
                                        disabled={viewingDuration >= VIEWING_DURATION_MAX}
                                    >
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">Adjust by {VIEWING_DURATION_STEP}-minute increments.</p>
                            </div>
                        </div>

                        {/* Location */}
                        <div className="space-y-2">
                            <Label>Location <span className="text-muted-foreground text-[10px]">(address or meeting point)</span></Label>
                            <Input value={viewingLocation} onChange={e => setViewingLocation(e.target.value)} placeholder="e.g. 25 Makarios Ave, Limassol" />
                        </div>

                        {/* Description */}
                        <div className="space-y-2">
                            <Label>Description <span className="text-muted-foreground text-[10px]">(synced to calendar)</span></Label>
                            <textarea
                                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                value={viewingDescription}
                                onChange={e => setViewingDescription(e.target.value)}
                                placeholder="Detailed agenda, access codes, or pre-viewing notes..."
                                rows={3}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={handleImproveViewingDescription}
                                disabled={improvingViewingDescription || !viewingDescription.trim()}
                            >
                                {improvingViewingDescription ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}
                                {improvingViewingDescription ? "Improving..." : "Improve Notes"}
                            </Button>
                        </div>
                    </div>
                    {error && <div className="text-xs text-red-600 pb-2">{error}</div>}
                    <DialogFooter>
                        <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editingViewingId ? 'Update Viewing' : 'Save Viewing'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!viewingToDeleteId} onOpenChange={(open) => !open && setViewingToDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to delete this viewing?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the viewing record and automatically cancel any linked Google Calendar or GoHighLevel appointments. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 focus:ring-red-600 hover:bg-red-700">Continue</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
