'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Plus, Trash2, Clock3, Pencil, Minus, Wand2, Radio, MessageSquareText, Navigation, Copy, ExternalLink, CheckCircle2, Ban } from 'lucide-react';
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
    updateViewingStatus,
    updateViewingFeedback,
    generateViewingReminderDraftAction,
    queueViewingLeadRemindersAction,
    openOrStartConversationForContact,
} from '@/app/(main)/admin/contacts/actions';
import { createViewingSession } from '@/app/(main)/admin/viewings/sessions/actions';
import { improveInternalNoteText } from '@/app/(main)/admin/conversations/actions';
import { useAiModelCatalog } from '@/components/ai/use-ai-model-catalog';
import { getContactViewings, getViewingFormOptions } from '@/app/(main)/admin/contacts/fetch-helpers';
import { SearchableSelect } from '@/app/(main)/admin/contacts/_components/searchable-select';
import {
    formatDateTimeLocalInTimeZone,
    formatViewingDateTimeWithTimeZoneLabel,
    getTimeZoneShortLabel,
} from '@/lib/viewings/datetime';
import { toast } from 'sonner';
import { QuickAssistStartButton } from '@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button';
import { VIEWING_SESSION_QUICK_START_SOURCES } from '@/lib/viewings/sessions/types';

const VIEWING_DURATION_DEFAULT = 30;
const VIEWING_DURATION_STEP = 15;
const VIEWING_DURATION_MIN = 15;
const VIEWING_DURATION_MAX = 480;
const VIEWING_PRIMARY_ACTION_CLASS = "h-8 min-w-0 justify-center px-2 text-[11px] [&>svg]:mr-1.5 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0";
const VIEWING_ICON_ACTION_CLASS = "h-8 w-8 text-muted-foreground";
const VIEWING_STATUS_OPTIONS = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'lead_confirmed', label: 'Lead Confirmed' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'no_show', label: 'No Show' },
] as const;
type ViewingStatusValue = typeof VIEWING_STATUS_OPTIONS[number]['value'];

type ReminderPreviewState = {
    audience: 'lead' | 'owner';
    body: string;
    conversationId: string | null;
    contactId: string | null;
    targetName: string | null;
    canAutoSend: boolean;
    scheduledLabel: string;
    directionsUrl: string | null;
    propertyLabel: string;
    locationLabel: string | null;
    fallbackHint?: string | null;
};
type FeedbackDraftState = {
    viewingId: string;
    overallRating: string;
    interestedInOffer: 'yes' | 'no' | 'maybe' | 'unknown';
    liked: string;
    disliked: string;
    comments: string;
};
type ReminderBadge = {
    key: string;
    label: string;
    tone: string;
    title?: string;
};
type ContactViewingsResult = Awaited<ReturnType<typeof getContactViewings>>;
type ViewingFormOptions = Awaited<ReturnType<typeof getViewingFormOptions>>;
type ViewingFormUser = ViewingFormOptions['users'][number];

const contactViewingsCache = new Map<string, ContactViewingsResult>();
const contactViewingsRequestCache = new Map<string, Promise<ContactViewingsResult>>();

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

function getViewingStatusLabel(status?: string | null): string {
    return VIEWING_STATUS_OPTIONS.find((option) => option.value === status)?.label || 'Scheduled';
}

function getViewingStatusTone(status?: string | null): string {
    if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'confirmed' || status === 'lead_confirmed') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (status === 'cancelled') return 'bg-red-50 text-red-700 border-red-200';
    if (status === 'no_show') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
}

function formatReminderOffsetLabel(offsetMinutes: number): string {
    if (offsetMinutes === 1440) return '24h';
    if (offsetMinutes % 60 === 0) return `${offsetMinutes / 60}h`;
    return `${offsetMinutes}m`;
}

function getReminderStatusTone(status?: string | null): string {
    if (status === 'queued') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (status === 'suggested') return 'border-violet-200 bg-violet-50 text-violet-700';
    if (status === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-600';
    if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
    return 'border-amber-200 bg-amber-50 text-amber-700';
}

function formatReminderDueLabel(input?: string | null) {
    return formatDueLabel(input);
}

function buildReminderBadges(reminders: any): ReminderBadge[] {
    if (!reminders || typeof reminders !== 'object' || Array.isArray(reminders)) return [];
    const badges: ReminderBadge[] = [];
    const leadEntries = reminders.lead && typeof reminders.lead === 'object' && !Array.isArray(reminders.lead)
        ? reminders.lead
        : {};

    for (const [key, rawEntry] of Object.entries(leadEntries)) {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
        const entry = rawEntry as any;
        const offsetMinutes = Number(entry.offsetMinutes ?? key);
        const status = String(entry.status || 'pending').toLowerCase();
        const dueLabel = formatReminderDueLabel(entry.dueAt || null);
        const labelPrefix = Number.isFinite(offsetMinutes) ? formatReminderOffsetLabel(offsetMinutes) : 'Lead';
        const statusLabel = status === 'queued'
            ? 'queued'
            : status === 'suggested'
                ? 'draft'
                : status === 'skipped'
                    ? 'skipped'
                    : status === 'failed'
                        ? 'failed'
                        : 'pending';

        badges.push({
            key: `lead-${key}`,
            label: `${labelPrefix} ${statusLabel}`,
            tone: getReminderStatusTone(status),
            title: [
                dueLabel ? `Due ${dueLabel}` : null,
                entry.reason || entry.lastError || null,
            ].filter(Boolean).join('\n') || undefined,
        });
    }

    if (reminders.leadManualDraftedAt) {
        badges.push({
            key: 'lead-manual-draft',
            label: 'lead draft',
            tone: 'border-slate-200 bg-slate-50 text-slate-700',
            title: `Drafted ${formatReminderDueLabel(reminders.leadManualDraftedAt) || reminders.leadManualDraftedAt}`,
        });
    }

    if (reminders.owner?.manualDraftedAt) {
        badges.push({
            key: 'owner-manual-draft',
            label: 'owner draft',
            tone: 'border-slate-200 bg-slate-50 text-slate-700',
            title: `Drafted ${formatReminderDueLabel(reminders.owner.manualDraftedAt) || reminders.owner.manualDraftedAt}`,
        });
    }

    return badges.sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeViewing(viewing: any) {
    return { ...viewing };
}

function getViewingUserTimeZone(users: ViewingFormUser[], userId?: string | null) {
    const user = users.find((option) => option.id === userId);
    return user?.effectiveTimeZone || user?.timeZone || null;
}

function applyContactViewingsResult(
    result: ContactViewingsResult,
    setters: {
        setViewings: (viewings: any[]) => void;
        setDefaultUserId: (userId: string) => void;
        setInterestedProps: (propertyIds: string[]) => void;
    }
) {
    const res = result || { viewings: [], currentUserId: null, interestedProperties: [] };
    setters.setViewings((res.viewings || []).map(normalizeViewing));
    if (res.currentUserId) setters.setDefaultUserId(res.currentUserId);
    if (res.interestedProperties) setters.setInterestedProps(res.interestedProperties);
}

export function ContactViewingManager({
    contactId,
    locationId,
    compact = false,
    className,
    title = null,
    isEditing = true
}: {
    contactId?: string | null;
    locationId: string;
    compact?: boolean;
    className?: string;
    title?: string | null;
    isEditing?: boolean;
}) {
    const router = useRouter();
    const [viewings, setViewings] = useState<any[]>([]);
    const [properties, setProperties] = useState<{ id: string; title: string; unitNumber?: string | null }[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string | null; email: string; timeZone?: string | null; effectiveTimeZone?: string | null }[]>([]);
    const [contacts, setContacts] = useState<{ id: string; name: string | null }[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingFormOptions, setLoadingFormOptions] = useState(false);

    const [modalOpen, setModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [viewingDate, setViewingDate] = useState('');
    const [viewingPropertyId, setViewingPropertyId] = useState('');
    const [viewingContactId, setViewingContactId] = useState(contactId || '');
    const [viewingUserId, setViewingUserId] = useState('');
    const [viewingTitle, setViewingTitle] = useState('');
    const [viewingDescription, setViewingDescription] = useState('');
    const [improvingViewingDescription, setImprovingViewingDescription] = useState(false);
    const [viewingLocation, setViewingLocation] = useState('');
    const [viewingDuration, setViewingDuration] = useState<number>(VIEWING_DURATION_DEFAULT);
    const [viewingStatus, setViewingStatus] = useState('scheduled');
    const [editingViewingId, setEditingViewingId] = useState<string | null>(null);

    // Deletion Modal
    const [viewingToDeleteId, setViewingToDeleteId] = useState<string | null>(null);
    const [statusChangeRequest, setStatusChangeRequest] = useState<null | {
        viewingId: string;
        status: ViewingStatusValue;
        label: string;
        reasonLabel: string;
    }>(null);
    const [statusChangeReason, setStatusChangeReason] = useState('');
    const [updatingViewingStatusId, setUpdatingViewingStatusId] = useState<string | null>(null);
    const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraftState | null>(null);
    const [savingFeedback, setSavingFeedback] = useState(false);
    const [startingLiveViewingId, setStartingLiveViewingId] = useState<string | null>(null);
    const [draftingViewingKey, setDraftingViewingKey] = useState<string | null>(null);
    const [queueingViewingId, setQueueingViewingId] = useState<string | null>(null);
    const [reminderPreview, setReminderPreview] = useState<ReminderPreviewState | null>(null);
    const [newSessionShare, setNewSessionShare] = useState<null | {
        sessionId: string;
        mode: string;
        joinUrl: string | null;
        pinCode: string | null;
        expiresAt: string | null;
    }>(null);

    // Initial Defaults
    const [defaultUserId, setDefaultUserId] = useState('');
    const [interestedProps, setInterestedProps] = useState<string[]>([]);
    const { resolveModelForKind } = useAiModelCatalog();

    const loadRequestIdRef = useRef(0);
    const formOptionsLoadedRef = useRef(false);
    const formOptionsRef = useRef<ViewingFormOptions | null>(null);
    const formOptionsRequestRef = useRef<Promise<ViewingFormOptions | null> | null>(null);
    const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

    const loadData = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
        const silent = options?.silent ?? false;
        const force = options?.force ?? false;
        const requestId = ++loadRequestIdRef.current;

        if (force && contactId) {
            contactViewingsCache.delete(contactId);
        }

        const cached = contactId && !force ? contactViewingsCache.get(contactId) : null;
        if (cached) {
            applyContactViewingsResult(cached, { setViewings, setDefaultUserId, setInterestedProps });
            setError(null);
            setLoading(false);
        } else if (!silent) {
            setLoading(true);
        }

        try {
            const viewingsRes = contactId
                ? await (() => {
                    const existingRequest = force ? null : contactViewingsRequestCache.get(contactId);
                    if (existingRequest) return existingRequest;

                    const request = getContactViewings(contactId)
                        .then((result) => {
                            contactViewingsCache.set(contactId, result);
                            return result;
                        })
                        .finally(() => {
                            contactViewingsRequestCache.delete(contactId);
                        });
                    contactViewingsRequestCache.set(contactId, request);
                    return request;
                })()
                : { viewings: [], currentUserId: null, interestedProperties: [] };

            if (requestId !== loadRequestIdRef.current) return;

            applyContactViewingsResult(viewingsRes, { setViewings, setDefaultUserId, setInterestedProps });
            setError(null);
        } catch (e: any) {
            if (requestId !== loadRequestIdRef.current) return;
            setError(e?.message || 'Failed to load viewings');
        } finally {
            if (requestId !== loadRequestIdRef.current) return;
            setLoading(false);
        }
    }, [contactId, locationId]);

    const ensureFormOptions = useCallback(async () => {
        if (formOptionsLoadedRef.current) return formOptionsRef.current;
        if (formOptionsRequestRef.current) return formOptionsRequestRef.current;

        setLoadingFormOptions(true);
        const request = getViewingFormOptions(locationId)
            .then((options) => {
                setProperties(options.properties || []);
                setUsers(options.users || []);
                setContacts(options.contacts || []);
                formOptionsRef.current = options;
                formOptionsLoadedRef.current = true;
                setError(null);
                return options;
            })
            .catch((formOptionsError: any) => {
                setError(formOptionsError?.message || 'Failed to load viewing form options');
                return null;
            })
            .finally(() => {
                setLoadingFormOptions(false);
                formOptionsRequestRef.current = null;
            });

        formOptionsRequestRef.current = request;
        return request;
    }, [locationId]);

    useEffect(() => {
        void loadData();
        // No specific viewing mutated event logic yet, could add window event listener here
    }, [loadData]);

    useEffect(() => {
        formOptionsLoadedRef.current = false;
        formOptionsRef.current = null;
        formOptionsRequestRef.current = null;
        setProperties([]);
        setUsers([]);
        setContacts([]);
    }, [locationId]);

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
        () => Boolean(viewingDate && viewingUserId && selectedViewingAgentTimeZone && !submitting),
        [viewingDate, viewingUserId, selectedViewingAgentTimeZone, submitting]
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
                contactId: viewingContactId || undefined,
                modelOverride: resolveModelForKind("general") || undefined,
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

        setSubmitting(true);
        setError(null);

        const formData = new FormData();
        formData.append('locationId', locationId); // Always pass locationId
        if (viewingContactId) formData.append('contactId', viewingContactId);
        if (viewingPropertyId) formData.append('propertyId', viewingPropertyId);
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
        formData.append('status', viewingStatus);

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
                void loadData({ silent: true, force: true });
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

    const handleAddViewing = async () => {
        resetForm();
        setModalOpen(true);
        await ensureFormOptions();
    };

    const handleEdit = async (viewing: any) => {
        const formOptions = await ensureFormOptions();
        setEditingViewingId(viewing.id);
        const optionUsers = formOptions?.users || users;
        const fallbackTimeZone = getViewingUserTimeZone(optionUsers, viewing.userId) || browserTimeZone;
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
        setViewingPropertyId(viewing.propertyId || '');
        setViewingContactId(viewing.contactId || '');
        setViewingUserId(viewing.userId);
        setViewingTitle(viewing.title || '');
        setViewingDescription(viewing.description || viewing.notes || '');
        setViewingLocation(viewing.location || '');
        setViewingDuration(normalizeViewingDuration(viewing.duration));
        setViewingStatus(viewing.status || 'scheduled');
        setModalOpen(true);
    };

    const handleDelete = async (viewingId: string) => {
        setViewingToDeleteId(viewingId);
    };

    const applyViewingStatus = async (viewingId: string, status: ViewingStatusValue, reason?: string | null) => {
        if (updatingViewingStatusId) return;
        setUpdatingViewingStatusId(viewingId);
        setError(null);
        try {
            const result = await updateViewingStatus(viewingId, status, reason || null);
            if (result.success) {
                toast.success(result.message || 'Viewing status updated');
                void loadData({ silent: true, force: true });
            } else {
                setError(result.message || 'Failed to update viewing status.');
            }
        } catch (statusError: any) {
            setError(statusError?.message || 'Failed to update viewing status.');
        } finally {
            setUpdatingViewingStatusId(null);
        }
    };

    const requestViewingStatusChange = (viewingId: string, status: ViewingStatusValue) => {
        const label = getViewingStatusLabel(status);
        const reasonLabel = status === 'cancelled'
            ? 'Cancellation reason'
            : status === 'no_show'
                ? 'No-show note'
                : 'Status note';
        setStatusChangeReason('');
        setStatusChangeRequest({ viewingId, status, label, reasonLabel });
    };

    const confirmViewingStatusChange = async () => {
        if (!statusChangeRequest) return;
        const request = statusChangeRequest;
        setStatusChangeRequest(null);
        await applyViewingStatus(request.viewingId, request.status, statusChangeReason.trim() || null);
        setStatusChangeReason('');
    };

    const openFeedbackDialog = (viewing: any) => {
        const feedback = viewing?.feedback && typeof viewing.feedback === 'object' ? viewing.feedback : {};
        setFeedbackDraft({
            viewingId: viewing.id,
            overallRating: feedback.overallRating ? String(feedback.overallRating) : '',
            interestedInOffer: feedback.interestedInOffer || 'unknown',
            liked: feedback.liked || '',
            disliked: feedback.disliked || '',
            comments: feedback.comments || '',
        });
    };

    const saveFeedback = async () => {
        if (!feedbackDraft || savingFeedback) return;
        setSavingFeedback(true);
        setError(null);
        try {
            const result = await updateViewingFeedback({
                viewingId: feedbackDraft.viewingId,
                overallRating: feedbackDraft.overallRating ? Number(feedbackDraft.overallRating) : null,
                interestedInOffer: feedbackDraft.interestedInOffer,
                liked: feedbackDraft.liked,
                disliked: feedbackDraft.disliked,
                comments: feedbackDraft.comments,
            });
            if (result.success) {
                toast.success(result.message || 'Viewing feedback saved');
                setFeedbackDraft(null);
                void loadData({ silent: true, force: true });
            } else {
                setError(result.message || 'Failed to save viewing feedback.');
            }
        } catch (feedbackError: any) {
            setError(feedbackError?.message || 'Failed to save viewing feedback.');
        } finally {
            setSavingFeedback(false);
        }
    };

    const confirmDelete = async () => {
        if (!viewingToDeleteId) return;

        try {
            const result = await deleteViewing(viewingToDeleteId);
            if (result.success) {
                void loadData({ silent: true, force: true });
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

    const handleStartLiveSession = async (viewingId: string) => {
        if (!viewingId || startingLiveViewingId) return;
        setStartingLiveViewingId(viewingId);
        setError(null);
        try {
            const result = await createViewingSession(viewingId, {});
            if (!result?.success || !result?.sessionId) {
                setError(result?.message || "Failed to create live viewing session.");
                return;
            }

            setNewSessionShare({
                sessionId: result.sessionId,
                mode: result.mode || "assistant_live_tool_heavy",
                joinUrl: result.join?.url || null,
                pinCode: result.join?.pinCode || null,
                expiresAt: result.join?.expiresAt || null,
            });
            toast.success("Live viewing session created");
        } catch (sessionError: any) {
            setError(sessionError?.message || "Failed to create live viewing session.");
        } finally {
            setStartingLiveViewingId(null);
        }
    };

    const copySessionInvite = async () => {
        if (!newSessionShare?.joinUrl || !newSessionShare?.pinCode) return;
        const payload = `Viewing session link: ${newSessionShare.joinUrl}\nPIN: ${newSessionShare.pinCode}`;
        try {
            await navigator.clipboard.writeText(payload);
            toast.success("Session link and PIN copied");
        } catch {
            toast.error("Could not copy to clipboard");
        }
    };

    const resetForm = () => {
        setViewingDate('');
        setViewingTitle('');
        setViewingDescription('');
        setViewingLocation('');
        setViewingDuration(VIEWING_DURATION_DEFAULT);
        setViewingStatus('scheduled');
        setEditingViewingId(null);
        setViewingContactId(contactId || '');

        // Apply smart defaults for New Viewings
        setViewingUserId(defaultUserId || '');
        // Pre-select first interested property if one exists and isn't already selected
        if (interestedProps.length > 0) {
            setViewingPropertyId(interestedProps[0]);
        } else {
            setViewingPropertyId('');
        }
    };

    const copyReminderDraft = async () => {
        if (!reminderPreview?.body) return;
        try {
            await navigator.clipboard.writeText(reminderPreview.body);
            toast.success("Reminder draft copied");
        } catch {
            toast.error("Could not copy reminder draft");
        }
    };

    const tryInsertReminderIntoComposer = useCallback((preview: ReminderPreviewState) => {
        if (preview.audience !== 'lead') return false;
        if (typeof window === 'undefined') return false;
        const insert = (window as any).__ESTIO_INSERT_COMPOSER_DRAFT__;
        if (typeof insert !== 'function') return false;
        try {
            return Boolean(insert({
                key: `viewing-reminder:${Date.now()}`,
                body: preview.body,
                conversationId: preview.conversationId || null,
            }));
        } catch {
            return false;
        }
    }, []);

    const handleGenerateReminderDraft = async (viewingId: string, audience: 'lead' | 'owner') => {
        const draftKey = `${viewingId}:${audience}`;
        if (draftingViewingKey === draftKey) return;
        setDraftingViewingKey(draftKey);
        setError(null);
        try {
            const result = await generateViewingReminderDraftAction(viewingId, audience);
            if (!result.success) {
                setError(result.error || 'Failed to generate reminder draft.');
                return;
            }

            const preview: ReminderPreviewState = {
                audience,
                body: result.body,
                conversationId: result.conversationId,
                contactId: result.contactId,
                targetName: result.targetName,
                canAutoSend: result.canAutoSend,
                scheduledLabel: result.scheduledLabel,
                directionsUrl: result.directionsUrl,
                propertyLabel: result.propertyLabel,
                locationLabel: result.locationLabel,
                fallbackHint: result.fallbackHint,
            };

            if (audience === 'lead' && tryInsertReminderIntoComposer(preview)) {
                toast.success('Lead reminder inserted into the composer');
                return;
            }

            setReminderPreview(preview);
        } catch (draftError: any) {
            setError(draftError?.message || 'Failed to generate reminder draft.');
        } finally {
            setDraftingViewingKey(null);
        }
    };

    const handleQueueLeadReminders = async (viewingId: string) => {
        if (queueingViewingId === viewingId) return;
        setQueueingViewingId(viewingId);
        setError(null);
        try {
            const result = await queueViewingLeadRemindersAction(viewingId);
            if (!result.success) {
                setError((result as any).error || 'Failed to queue lead reminders.');
                return;
            }
            const queuedCount = (result.results || []).filter((item: any) => item.status === 'pending').length;
            const skippedCount = (result.results || []).filter((item: any) => item.status === 'skipped').length;
            if (queuedCount > 0) {
                toast.success(`Queued ${queuedCount} lead reminder${queuedCount > 1 ? 's' : ''}`);
            } else if (skippedCount > 0) {
                toast.message('Lead reminders were already past due for this viewing');
            }
            void loadData({ silent: true, force: true });
        } catch (queueError: any) {
            setError(queueError?.message || 'Failed to queue lead reminders.');
        } finally {
            setQueueingViewingId(null);
        }
    };

    const handleOpenReminderConversation = async () => {
        if (!reminderPreview?.contactId) return;
        try {
            const result = await openOrStartConversationForContact(reminderPreview.contactId);
            if (!result?.success || !result?.conversationId) {
                toast.error(result?.error || 'Could not open a conversation for this contact.');
                return;
            }
            router.push(`/admin/conversations?id=${encodeURIComponent(result.conversationId)}`);
        } catch (conversationError: any) {
            toast.error(conversationError?.message || 'Could not open a conversation for this contact.');
        }
    };

    return (
        <div className={cn('space-y-3', className)}>
            {title && (
                <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{title}</div>
                    {isEditing && (
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={handleAddViewing}>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Add Viewing
                        </Button>
                    )}
                </div>
            )}

            {!title && isEditing && (
                <div className="flex items-center justify-end">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={handleAddViewing}>
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
                        const propertyName = viewing.property?.unitNumber ? `[${viewing.property.unitNumber}] ${viewing.property.title}` : viewing.property?.title || 'No Property Linked';
                        const isStatusUpdating = updatingViewingStatusId === viewing.id;
                        const isCancelled = viewing.status === 'cancelled';
                        const isCompleted = viewing.status === 'completed';
                        const isNoShow = viewing.status === 'no_show';
                        const hasFeedback = Boolean(viewing.feedbackReceived || viewing.feedback);
                        const reminderBadges = buildReminderBadges(viewing.reminders);

                        return (
                            <div key={viewing.id} className="space-y-2 overflow-hidden rounded-md border bg-card p-2.5 text-xs">
                                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="break-words text-sm font-medium text-foreground">{viewing.title || propertyName}</span>
                                        <span className="text-muted-foreground">{viewing.user.name}</span>
                                    </div>

                                    {isEditing && (
                                        <div className="grid w-full min-w-0 grid-cols-2 gap-1.5 sm:w-auto sm:max-w-[420px] sm:grid-cols-3 lg:flex lg:flex-wrap lg:justify-end">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={VIEWING_PRIMARY_ACTION_CLASS}
                                                onClick={() => handleStartLiveSession(viewing.id)}
                                                disabled={startingLiveViewingId === viewing.id}
                                            >
                                                {startingLiveViewingId === viewing.id ? (
                                                    <Loader2 className="animate-spin" />
                                                ) : (
                                                    <Radio />
                                                )}
                                                Live
                                            </Button>
                                            <QuickAssistStartButton
                                                label="Quick Assist"
                                                locationId={locationId}
                                                viewingId={viewing.id}
                                                quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.viewing}
                                                variant="outline"
                                                size="sm"
                                                className={VIEWING_PRIMARY_ACTION_CLASS}
                                                icon="mic"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={VIEWING_PRIMARY_ACTION_CLASS}
                                                onClick={() => handleGenerateReminderDraft(viewing.id, 'lead')}
                                                disabled={draftingViewingKey === `${viewing.id}:lead`}
                                            >
                                                {draftingViewingKey === `${viewing.id}:lead`
                                                    ? <Loader2 className="animate-spin" />
                                                    : <MessageSquareText />}
                                                Lead Draft
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={VIEWING_PRIMARY_ACTION_CLASS}
                                                onClick={() => handleGenerateReminderDraft(viewing.id, 'owner')}
                                                disabled={draftingViewingKey === `${viewing.id}:owner`}
                                            >
                                                {draftingViewingKey === `${viewing.id}:owner`
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Navigation />}
                                                Owner Draft
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={VIEWING_PRIMARY_ACTION_CLASS}
                                                onClick={() => handleQueueLeadReminders(viewing.id)}
                                                disabled={queueingViewingId === viewing.id}
                                            >
                                                {queueingViewingId === viewing.id
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Clock3 />}
                                                Queue Lead
                                            </Button>
                                            <div className="col-span-2 flex min-w-0 items-center justify-end gap-1 sm:col-span-1">
                                                <Button type="button" variant="ghost" size="icon" className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-primary")} onClick={() => void handleEdit(viewing)} title="Edit details">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-primary")}
                                                    onClick={() => void handleEdit(viewing)}
                                                    title="Reschedule"
                                                >
                                                    <Clock3 className="h-3.5 w-3.5" />
                                                </Button>
                                                {!isCompleted && !isCancelled && !isNoShow ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-emerald-600")}
                                                        onClick={() => void applyViewingStatus(viewing.id, 'completed')}
                                                        disabled={isStatusUpdating}
                                                        title="Mark completed"
                                                    >
                                                        {isStatusUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                                    </Button>
                                                ) : null}
                                                {!isCancelled && !isCompleted ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-destructive")}
                                                        onClick={() => requestViewingStatusChange(viewing.id, 'cancelled')}
                                                        disabled={isStatusUpdating}
                                                        title="Cancel viewing"
                                                    >
                                                        <Ban className="h-3.5 w-3.5" />
                                                    </Button>
                                                ) : null}
                                                {!isNoShow && !isCancelled && !isCompleted ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-amber-600")}
                                                        onClick={() => requestViewingStatusChange(viewing.id, 'no_show')}
                                                        disabled={isStatusUpdating}
                                                        title="Mark no-show"
                                                    >
                                                        <Minus className="h-3.5 w-3.5" />
                                                    </Button>
                                                ) : null}
                                                {isCompleted ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-primary")}
                                                        onClick={() => openFeedbackDialog(viewing)}
                                                        title={hasFeedback ? 'Edit feedback' : 'Add feedback'}
                                                    >
                                                        <MessageSquareText className="h-3.5 w-3.5" />
                                                    </Button>
                                                ) : null}
                                                <Button type="button" variant="ghost" size="icon" className={cn(VIEWING_ICON_ACTION_CLASS, "hover:text-destructive")} onClick={() => handleDelete(viewing.id)} title="Delete viewing">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {viewing.description && (
                                    <div className="break-words whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-1.5 pt-0 text-[11px] text-muted-foreground dark:border-slate-800 dark:bg-slate-900">{viewing.description}</div>
                                )}
                                {!viewing.description && viewing.notes && (
                                    <div className="break-words whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-1.5 pt-0 text-[11px] text-muted-foreground dark:border-slate-800 dark:bg-slate-900">{viewing.notes}</div>
                                )}

                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    {dateLabel && (
                                        <span className="inline-flex h-5 items-center px-1.5 rounded-md border text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                            <Clock3 className="h-3 w-3 mr-1" />
                                            {dateLabel}
                                        </span>
                                    )}
                                    <span className={cn('inline-flex h-5 items-center rounded-md border px-1.5 text-[10px]', getViewingStatusTone(viewing.status))}>
                                        {getViewingStatusLabel(viewing.status)}
                                    </span>
                                    {hasFeedback ? (
                                        <span className="inline-flex h-5 items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                                            Feedback saved
                                        </span>
                                    ) : null}
                                    {reminderBadges.map((badge) => (
                                        <span
                                            key={`${viewing.id}-${badge.key}`}
                                            className={cn('inline-flex h-5 items-center rounded-md border px-1.5 text-[10px]', badge.tone)}
                                            title={badge.title}
                                        >
                                            {badge.label}
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
                            {editingViewingId ? 'Update the details of the viewing below.' : 'Enter the details for the new viewing.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {loadingFormOptions && (
                            <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading form options...
                            </div>
                        )}
                        {/* Title */}
                        <div className="space-y-2">
                            <Label>Title <span className="text-muted-foreground text-[10px]">(optional - auto-generated from property if blank)</span></Label>
                            <Input value={viewingTitle} onChange={e => setViewingTitle(e.target.value)} placeholder="e.g. Viewing: 3BR Villa in Limassol" />
                        </div>

                        {/* Property & Agent */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Contact <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
                                {!locationId ? (
                                    <div className="text-xs text-amber-600 py-2">No location configured</div>
                                ) : (
                                    <SearchableSelect
                                        name="viewingContactId"
                                        value={viewingContactId}
                                        onChange={setViewingContactId}
                                        options={contacts.map(c => ({
                                            value: c.id,
                                            label: c.name || 'Unknown Contact'
                                        }))}
                                        placeholder="Select Contact..."
                                        searchPlaceholder="Search Contacts..."
                                    />
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label>Property <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
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
                        </div>

                        {/* Agent */}
                        <div className="gap-4">
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

                        <div className="space-y-2">
                            <Label>Status</Label>
                            <Select value={viewingStatus} onValueChange={setViewingStatus}>
                                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                                <SelectContent>
                                    {VIEWING_STATUS_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Location */}
                        <div className="space-y-2">
                            <Label>Location <span className="text-muted-foreground text-[10px]">(address or meeting point)</span></Label>
                            <Input value={viewingLocation} onChange={e => setViewingLocation(e.target.value)} placeholder="e.g. 25 Makarios Ave, Limassol" />
                        </div>

                        {/* Description */}
                        <div className="space-y-2">
                            <Label>Description <span className="text-muted-foreground text-[10px]">(internal notes)</span></Label>
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

            <Dialog open={!!newSessionShare} onOpenChange={(open) => !open && setNewSessionShare(null)}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Live Session Ready</DialogTitle>
                        <DialogDescription>
                            Share this tenant-branded link and PIN with the client, then open the agent cockpit.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Session Link</Label>
                            <Input readOnly value={newSessionShare?.joinUrl || "No domain configured for this location."} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>PIN</Label>
                                <Input readOnly value={newSessionShare?.pinCode || "N/A"} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Expires</Label>
                                <Input
                                    readOnly
                                    value={newSessionShare?.expiresAt ? new Date(newSessionShare.expiresAt).toLocaleString() : "N/A"}
                                />
                            </div>
                        </div>
                        <div className="rounded-md border bg-slate-50 p-2 text-[11px] text-slate-600">
                            Mode: {newSessionShare?.mode || "assistant_live_tool_heavy"}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={copySessionInvite} disabled={!newSessionShare?.joinUrl || !newSessionShare?.pinCode}>
                            Copy Invite
                        </Button>
                        <Button
                            type="button"
                            onClick={() => {
                                if (!newSessionShare?.sessionId) return;
                                window.open(`/admin/viewings/sessions/${newSessionShare.sessionId}`, "_blank");
                            }}
                        >
                            Open Agent Cockpit
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!reminderPreview} onOpenChange={(open) => !open && setReminderPreview(null)}>
                <DialogContent className="sm:max-w-[620px]">
                    <DialogHeader>
                        <DialogTitle>{reminderPreview?.audience === 'owner' ? 'Owner Reminder Draft' : 'Lead Reminder Draft'}</DialogTitle>
                        <DialogDescription>
                            Review the generated reminder message before sending it.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-3 text-xs text-slate-700">
                            <div><span className="font-medium">Property:</span> {reminderPreview?.propertyLabel}</div>
                            <div><span className="font-medium">Viewing:</span> {reminderPreview?.scheduledLabel}</div>
                            {reminderPreview?.locationLabel ? (
                                <div><span className="font-medium">Location:</span> {reminderPreview.locationLabel}</div>
                            ) : null}
                            {reminderPreview?.fallbackHint ? (
                                <div><span className="font-medium">Fallback hint:</span> {reminderPreview.fallbackHint}</div>
                            ) : null}
                        </div>
                        <textarea
                            readOnly
                            className="flex min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={reminderPreview?.body || ''}
                        />
                    </div>
                    <DialogFooter className="gap-2 sm:justify-between">
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={copyReminderDraft}>
                                <Copy className="mr-2 h-4 w-4" />
                                Copy
                            </Button>
                            {reminderPreview?.audience === 'lead' ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        if (!reminderPreview) return;
                                        if (tryInsertReminderIntoComposer(reminderPreview)) {
                                            toast.success('Lead reminder inserted into the composer');
                                            setReminderPreview(null);
                                        } else {
                                            toast.message('Open the conversation composer for this contact to insert the draft directly.');
                                        }
                                    }}
                                >
                                    <MessageSquareText className="mr-2 h-4 w-4" />
                                    Insert to Composer
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex gap-2">
                            {reminderPreview?.contactId ? (
                                <Button type="button" variant="outline" onClick={handleOpenReminderConversation}>
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Open Conversation
                                </Button>
                            ) : null}
                            <Button type="button" onClick={() => setReminderPreview(null)}>Close</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!viewingToDeleteId} onOpenChange={(open) => !open && setViewingToDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to delete this viewing?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the viewing record from Estio. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 focus:ring-red-600 hover:bg-red-700">Continue</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!statusChangeRequest} onOpenChange={(open) => {
                if (!open) {
                    setStatusChangeRequest(null);
                    setStatusChangeReason('');
                }
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Mark viewing as {statusChangeRequest?.label}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This updates the viewing status inside Estio and keeps the viewing record in the contact timeline.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label>{statusChangeRequest?.reasonLabel || 'Status note'} <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
                        <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={statusChangeReason}
                            onChange={(event) => setStatusChangeReason(event.target.value)}
                            placeholder="Add a short internal note..."
                            maxLength={500}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmViewingStatusChange}>Update Status</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={!!feedbackDraft} onOpenChange={(open) => !open && setFeedbackDraft(null)}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Viewing Feedback</DialogTitle>
                        <DialogDescription>
                            Capture what happened after the viewing.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Overall Rating</Label>
                                <Select
                                    value={feedbackDraft?.overallRating || ''}
                                    onValueChange={(value) => setFeedbackDraft((draft) => draft ? { ...draft, overallRating: value } : draft)}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select rating" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="5">5 - Excellent</SelectItem>
                                        <SelectItem value="4">4 - Good</SelectItem>
                                        <SelectItem value="3">3 - Neutral</SelectItem>
                                        <SelectItem value="2">2 - Poor</SelectItem>
                                        <SelectItem value="1">1 - Bad</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Interested in Offer</Label>
                                <Select
                                    value={feedbackDraft?.interestedInOffer || 'unknown'}
                                    onValueChange={(value) => setFeedbackDraft((draft) => draft ? { ...draft, interestedInOffer: value as FeedbackDraftState['interestedInOffer'] } : draft)}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select interest" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="unknown">Unknown</SelectItem>
                                        <SelectItem value="yes">Yes</SelectItem>
                                        <SelectItem value="maybe">Maybe</SelectItem>
                                        <SelectItem value="no">No</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Liked</Label>
                            <textarea
                                className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={feedbackDraft?.liked || ''}
                                onChange={(event) => setFeedbackDraft((draft) => draft ? { ...draft, liked: event.target.value } : draft)}
                                placeholder="What did they like?"
                                maxLength={1000}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Disliked</Label>
                            <textarea
                                className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={feedbackDraft?.disliked || ''}
                                onChange={(event) => setFeedbackDraft((draft) => draft ? { ...draft, disliked: event.target.value } : draft)}
                                placeholder="What objections or issues came up?"
                                maxLength={1000}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Comments</Label>
                            <textarea
                                className="flex min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={feedbackDraft?.comments || ''}
                                onChange={(event) => setFeedbackDraft((draft) => draft ? { ...draft, comments: event.target.value } : draft)}
                                placeholder="Follow-up notes, next steps, decision makers..."
                                maxLength={2000}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setFeedbackDraft(null)}>Cancel</Button>
                        <Button type="button" onClick={saveFeedback} disabled={savingFeedback}>
                            {savingFeedback && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Feedback
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
