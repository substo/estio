'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronLeft, Link2, List, Loader2, Megaphone, Pencil, Search, Send, StopCircle, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
    cancelPropertyMatchCampaignBatchAction,
    createPropertyMatchCampaignAction,
    createPropertyMatchCampaignFromSourceAction,
    deletePropertyMatchCampaignAction,
    generatePropertyMatchCandidateDraftAction,
    getPropertyMatchCampaignDetailAction,
    listPropertyMatchCampaignsAction,
    processPropertyMatchCampaignBatchAction,
    reviewPropertyMatchCandidateAction,
    savePropertyMatchCandidateDraftAction,
    searchPropertyMatchCampaignPropertiesAction,
    sendPropertyMatchCandidateAction,
    updatePropertyMatchCampaignAction,
} from "../actions";

type PropertyResult = {
    id: string;
    title: string;
    reference?: string | null;
    goal?: string | null;
    type?: string | null;
    price?: number | null;
    bedrooms?: number | null;
    city?: string | null;
    propertyLocation?: string | null;
};

type Campaign = {
    id: string;
    title: string;
    status: string;
    property?: { title?: string | null; reference?: string | null } | null;
    totalCandidates: number;
    processedCandidates: number;
    yesCount: number;
    maybeCount: number;
    noCount: number;
    approvedCount: number;
    sentCount: number;
    queueCounts?: QueueCounts | null;
    priorityNote?: string | null;
    collectionStatus?: string | null;
    lastError?: string | null;
};

type QueueCounts = {
    allCount: number;
    pendingAiCount: number;
    reviewCount: number;
    approvedCount: number;
    sentCount: number;
    skippedCount: number;
    rejectedCount: number;
    notMatchCount: number;
    alreadySharedCount: number;
};

type Candidate = {
    id: string;
    contactId: string;
    conversationId?: string | null;
    aiVerdict: "yes" | "maybe" | "no";
    aiReviewStatus?: string | null;
    reviewerStatus: string;
    confidence?: number | null;
    matchSummary?: string | null;
    reasoning?: string | null;
    evidence?: {
        structured?: {
            dimensions?: Array<{
                key?: string;
                label?: string;
                propertyValue?: string | number | null;
                requirementValue?: string | number | null;
                status?: "yes" | "maybe" | "no" | "unknown";
                reason?: string;
            }>;
            overallScore?: number;
            disqualifiers?: string[];
            hardMismatches?: string[];
        };
    } | null;
    preferredChannel?: "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" | string | null;
    draftBody?: string;
    reviewedAt?: string | null;
    sentAt?: string | null;
    rejectedReason?: string | null;
    lastError?: string | null;
    contact?: {
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        contactType?: string | null;
        leadGoal?: string | null;
        requirementStatus?: string | null;
        requirementBedrooms?: string | null;
        requirementMaxPrice?: string | null;
        requirementPropertyTypes?: string[];
        requirementPropertyLocations?: string[];
        requirementSummary?: string | null;
    } | null;
};

type CampaignDetail = {
    campaign: Campaign;
    candidates: Candidate[];
};

type Queue = "review" | "approved" | "sent" | "skipped" | "rejected" | "not_match" | "already_shared" | "all";
type MobileCampaignView = "campaigns" | "review";
type BatchProgress = {
    campaignId: string;
    phase: "collecting" | "analyzing" | "stopped" | "done" | "failed";
    collected: number;
    analyzed: number;
    failed: number;
    lastProcessed: number;
    lastCollected: number;
    message: string;
};

const QUEUE_OPTIONS: Array<{ value: Queue; label: string; countKey: keyof QueueCounts }> = [
    { value: "review", label: "Review", countKey: "reviewCount" },
    { value: "approved", label: "Approved", countKey: "approvedCount" },
    { value: "sent", label: "Sent", countKey: "sentCount" },
    { value: "skipped", label: "Skipped", countKey: "skippedCount" },
    { value: "rejected", label: "Rejected", countKey: "rejectedCount" },
    { value: "not_match", label: "Not match", countKey: "notMatchCount" },
    { value: "already_shared", label: "Already shared", countKey: "alreadySharedCount" },
    { value: "all", label: "All", countKey: "allCount" },
];

const PROPERTY_SEARCH_LIMIT = 12;
const MIN_PROPERTY_SEARCH_LENGTH = 2;
const PROPERTY_SEARCH_DEBOUNCE_MS = 350;
const LIVE_BATCH_LIMIT = 20;

function formatMoney(value?: number | null) {
    return Number.isFinite(Number(value)) ? `€${Number(value).toLocaleString()}` : "No price";
}

function confidenceLabel(value?: number | null) {
    if (!Number.isFinite(Number(value))) return "";
    return `${Math.round(Number(value) * 100)}%`;
}

function campaignLabel(campaign?: Campaign | null) {
    return campaign?.title || campaign?.property?.title || "Untitled campaign";
}

function candidateRequirementLine(candidate: Candidate) {
    return [
        candidate.contact?.requirementStatus,
        candidate.contact?.requirementBedrooms,
        candidate.contact?.requirementMaxPrice,
        candidate.contact?.requirementPropertyLocations?.join(", "),
    ].filter(Boolean).join(" · ");
}

function candidateStructuredDimensions(candidate: Candidate) {
    return (candidate.evidence?.structured?.dimensions || [])
        .filter((dimension) => dimension?.label && ["goal", "location", "price", "bedrooms", "type", "size", "features", "condition", "sparse", "status"].includes(String(dimension.key || "")))
        .slice(0, 9);
}

function dimensionStatusClass(status?: string) {
    if (status === "yes") return "border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status === "no") return "border-red-200 bg-red-50 text-red-800";
    if (status === "maybe") return "border-amber-200 bg-amber-50 text-amber-800";
    return "border-slate-200 bg-white text-slate-700";
}

function formatDimensionValue(value: unknown) {
    if (value == null || value === "") return "Any";
    return String(value);
}

function campaignQueueCounts(campaign?: Campaign | null): QueueCounts {
    return {
        allCount: campaign?.queueCounts?.allCount ?? campaign?.totalCandidates ?? 0,
        pendingAiCount: campaign?.queueCounts?.pendingAiCount ?? Math.max(0, Number(campaign?.totalCandidates || 0) - Number(campaign?.processedCandidates || 0)),
        reviewCount: campaign?.queueCounts?.reviewCount ?? Math.max(0, Number(campaign?.yesCount || 0) + Number(campaign?.maybeCount || 0) - Number(campaign?.approvedCount || 0) - Number(campaign?.sentCount || 0)),
        approvedCount: campaign?.queueCounts?.approvedCount ?? campaign?.approvedCount ?? 0,
        sentCount: campaign?.queueCounts?.sentCount ?? campaign?.sentCount ?? 0,
        skippedCount: campaign?.queueCounts?.skippedCount ?? 0,
        rejectedCount: campaign?.queueCounts?.rejectedCount ?? 0,
        notMatchCount: campaign?.queueCounts?.notMatchCount ?? campaign?.noCount ?? 0,
        alreadySharedCount: campaign?.queueCounts?.alreadySharedCount ?? 0,
    };
}

function campaignIsStopped(campaign?: Campaign | null) {
    return campaign?.status === "canceled" || campaign?.collectionStatus === "canceled";
}

function campaignCanStop(campaign?: Campaign | null) {
    if (!campaign || campaignIsStopped(campaign)) return false;
    return campaign.status === "processing" || campaign.collectionStatus === "processing" || campaignQueueCounts(campaign).pendingAiCount > 0;
}

function queueEmptyLabel(queue: Queue) {
    if (queue === "review") return "No contacts need review.";
    if (queue === "approved") return "No approved drafts waiting to send.";
    if (queue === "sent") return "No sent contacts yet.";
    if (queue === "skipped") return "No skipped contacts yet.";
    if (queue === "rejected") return "No rejected contacts yet.";
    if (queue === "not_match") return "No contacts were marked as not a match.";
    if (queue === "already_shared") return "No contacts already had this property shared.";
    return "No candidates in this campaign.";
}

function reviewedCandidateShouldStayVisible(queue: Queue) {
    return queue === "all";
}

function formatDecisionDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function progressPercent(campaign?: Campaign | null) {
    const total = Math.max(0, Number(campaign?.totalCandidates || 0));
    if (!total) return 0;
    const processed = Math.max(0, Math.min(total, Number(campaign?.processedCandidates || 0)));
    return Math.round((processed / total) * 100);
}

export function PropertyMatchCampaignsDialog({
    open,
    onOpenChange,
    onOpenConversation,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenConversation?: (conversationId: string) => void;
}) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CampaignDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [queue, setQueue] = useState<Queue>("review");
    const [propertyQuery, setPropertyQuery] = useState("");
    const [properties, setProperties] = useState<PropertyResult[]>([]);
    const [propertySearchLoading, setPropertySearchLoading] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
    const [propertyUrl, setPropertyUrl] = useState("");
    const [propertyText, setPropertyText] = useState("");
    const [priorityNote, setPriorityNote] = useState("");
    const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editPriorityNote, setEditPriorityNote] = useState("");
    const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
    const [processingCampaignId, setProcessingCampaignId] = useState<string | null>(null);
    const [cancelingCampaignId, setCancelingCampaignId] = useState<string | null>(null);
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
    const [error, setError] = useState("");
    const [mobileView, setMobileView] = useState<MobileCampaignView>("campaigns");
    const [isPending, startTransition] = useTransition();
    const propertySearchRequestIdRef = useRef(0);
    const detailRequestIdRef = useRef(0);
    const campaignPrefetchStartedRef = useRef(false);
    const processingRunRef = useRef(0);

    const selectedProperty = useMemo(
        () => properties.find((property) => property.id === selectedPropertyId) || null,
        [properties, selectedPropertyId],
    );

    const refreshCampaigns = useCallback(async () => {
        const rows = await listPropertyMatchCampaignsAction();
        const campaignRows = rows as Campaign[];
        setCampaigns(campaignRows);
        return campaignRows;
    }, []);

    const loadCampaigns = useCallback(() => {
        startTransition(async () => {
            const rows = await refreshCampaigns();
            setSelectedCampaignId((current) => {
                if (current && rows.some((campaign) => campaign.id === current)) return current;
                return rows[0]?.id || null;
            });
        });
    }, [refreshCampaigns]);

    useEffect(() => {
        if (open || campaignPrefetchStartedRef.current) return;
        campaignPrefetchStartedRef.current = true;
        const timeout = window.setTimeout(() => {
            loadCampaigns();
        }, 750);
        return () => window.clearTimeout(timeout);
    }, [loadCampaigns, open]);

    const applyCampaignDetail = useCallback((res: {
        campaign: unknown;
        candidates: unknown[];
    }) => {
        setDetail({ campaign: res.campaign as Campaign, candidates: res.candidates as Candidate[] });
        setDrafts((current) => {
            const next = { ...current };
            for (const candidate of res.candidates as Candidate[]) {
                if (candidate.draftBody && (!next[candidate.id] || !next[candidate.id].trim())) {
                    next[candidate.id] = candidate.draftBody;
                }
            }
            return next;
        });
    }, []);

    const refreshDetail = useCallback(async (campaignId: string, nextQueue = queue) => {
        const requestId = detailRequestIdRef.current + 1;
        detailRequestIdRef.current = requestId;
        setDetailLoading(true);
        try {
            const res = await getPropertyMatchCampaignDetailAction(campaignId, nextQueue);
            if (detailRequestIdRef.current !== requestId) return null;
            if (!res.success) {
                setError(res.error || "Could not load campaign.");
                return null;
            }
            setError("");
            applyCampaignDetail({ campaign: res.campaign, candidates: res.candidates as unknown[] });
            return { campaign: res.campaign as Campaign, candidates: res.candidates as Candidate[] };
        } finally {
            if (detailRequestIdRef.current === requestId) {
                setDetailLoading(false);
            }
        }
    }, [applyCampaignDetail, queue]);

    const loadDetail = useCallback((campaignId: string, nextQueue = queue) => {
        startTransition(() => {
            void refreshDetail(campaignId, nextQueue);
        });
    }, [queue, refreshDetail]);

    const loadPropertyOptions = useCallback(async (query: string, limit = PROPERTY_SEARCH_LIMIT) => {
        const trimmed = query.trim();
        if (trimmed.length < MIN_PROPERTY_SEARCH_LENGTH) {
            propertySearchRequestIdRef.current += 1;
            setProperties([]);
            setSelectedPropertyId(null);
            setPropertySearchLoading(false);
            return;
        }
        const requestId = propertySearchRequestIdRef.current + 1;
        propertySearchRequestIdRef.current = requestId;
        setPropertySearchLoading(true);
        const rows = await searchPropertyMatchCampaignPropertiesAction(trimmed, limit);
        if (propertySearchRequestIdRef.current !== requestId) return;
        setProperties(rows as PropertyResult[]);
        setSelectedPropertyId((current) => {
            if (current && rows.some((property) => property.id === current)) return current;
            return null;
        });
        setPropertySearchLoading(false);
    }, []);

    const clearPropertyPicker = useCallback(() => {
        propertySearchRequestIdRef.current += 1;
        setPropertyQuery("");
        setProperties([]);
        setPropertySearchLoading(false);
        setSelectedPropertyId(null);
    }, []);

    useEffect(() => {
        if (!open) return;
        setMobileView("campaigns");
        clearPropertyPicker();
        loadCampaigns();
    }, [clearPropertyPicker, loadCampaigns, open]);

    useEffect(() => {
        if (!open || !selectedCampaignId) return;
        loadDetail(selectedCampaignId, queue);
    }, [loadDetail, open, queue, selectedCampaignId]);

    useEffect(() => {
        if (!open) return;
        const trimmed = propertyQuery.trim();
        if (trimmed.length < MIN_PROPERTY_SEARCH_LENGTH) {
            propertySearchRequestIdRef.current += 1;
            setPropertySearchLoading(false);
            setProperties([]);
            setSelectedPropertyId(null);
            return;
        }
        const timeout = window.setTimeout(() => {
            void loadPropertyOptions(trimmed, PROPERTY_SEARCH_LIMIT);
        }, PROPERTY_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timeout);
    }, [loadPropertyOptions, open, propertyQuery]);

    const searchProperties = () => {
        void loadPropertyOptions(propertyQuery, PROPERTY_SEARCH_LIMIT);
    };

    const runCampaignBatchLive = useCallback(async (campaignId: string, nextQueue = queue) => {
        const runId = processingRunRef.current + 1;
        processingRunRef.current = runId;
        setProcessingCampaignId(campaignId);
        setBatchProgress({
            campaignId,
            phase: "collecting",
            collected: 0,
            analyzed: 0,
            failed: 0,
            lastCollected: 0,
            lastProcessed: 0,
            message: "Collecting matching leads...",
        });
        setError("");

        let collected = 0;
        let analyzed = 0;
        let failed = 0;

        try {
            for (;;) {
                const res = await processPropertyMatchCampaignBatchAction(campaignId, LIVE_BATCH_LIMIT);
                if (processingRunRef.current !== runId) return;
                if (!res.success) {
                    setError(res.error || "Batch processing failed.");
                    setBatchProgress((current) => current?.campaignId === campaignId ? {
                        ...current,
                        phase: "failed",
                        message: res.error || "Batch processing failed.",
                    } : current);
                    return;
                }

                const stepCollected = Number(res.collected || 0);
                const stepProcessed = Number(res.processed || 0);
                const stepFailed = Number(res.failed || 0);
                collected += stepCollected;
                analyzed += stepProcessed;
                failed += stepFailed;

                const [rows, refreshed] = await Promise.all([
                    refreshCampaigns(),
                    refreshDetail(campaignId, nextQueue),
                ]);
                if (processingRunRef.current !== runId) return;

                const refreshedCampaign = refreshed?.campaign || rows.find((campaign) => campaign.id === campaignId) || null;
                const counts = campaignQueueCounts(refreshedCampaign);
                const pending = counts.pendingAiCount;
                const phase = res.stopped ? "stopped" : res.remaining ? "analyzing" : "done";
                const message = res.stopped
                    ? "Processing stopped."
                    : res.remaining
                        ? `Analyzing leads... ${Math.max(0, Number(refreshedCampaign?.processedCandidates || 0))}/${Math.max(0, Number(refreshedCampaign?.totalCandidates || 0))} processed`
                        : "Analysis complete.";

                setBatchProgress({
                    campaignId,
                    phase,
                    collected,
                    analyzed,
                    failed,
                    lastCollected: stepCollected,
                    lastProcessed: stepProcessed,
                    message: pending > 0 && !res.stopped ? `${message} · ${pending} AI pending` : message,
                });

                if (res.stopped || !res.remaining) return;
                await new Promise((resolve) => window.setTimeout(resolve, 250));
                if (processingRunRef.current !== runId) return;
            }
        } finally {
            if (processingRunRef.current === runId) {
                setProcessingCampaignId(null);
            }
        }
    }, [queue, refreshCampaigns, refreshDetail]);

    const createCampaignFromProperty = () => {
        if (!selectedPropertyId) return;
        setError("");
        startTransition(async () => {
            const res = await createPropertyMatchCampaignAction({
                propertyId: selectedPropertyId,
                priorityNote,
            });
            if (!res.success) {
                setError(res.error || "Could not create campaign.");
                return;
            }
            setSelectedCampaignId(res.campaignId);
            setMobileView("review");
            setPriorityNote("");
            await refreshCampaigns();
            await runCampaignBatchLive(res.campaignId, "review");
        });
    };

    const createCampaignFromSource = () => {
        if (!propertyUrl.trim() && !propertyText.trim()) return;
        setError("");
        startTransition(async () => {
            const res = await createPropertyMatchCampaignFromSourceAction({
                propertyUrl,
                propertyText,
                priorityNote,
            });
            if (!res.success) {
                setError(res.error || "Could not create campaign.");
                return;
            }
            setSelectedCampaignId(res.campaignId);
            setMobileView("review");
            setPriorityNote("");
            setPropertyUrl("");
            setPropertyText("");
            await refreshCampaigns();
            await runCampaignBatchLive(res.campaignId, "review");
        });
    };

    const processMore = () => {
        if (!selectedCampaignId) return;
        void runCampaignBatchLive(selectedCampaignId, queue);
    };

    const stopProcessing = () => {
        if (!selectedCampaignId) return;
        setError("");
        const campaignId = selectedCampaignId;
        processingRunRef.current += 1;
        setCancelingCampaignId(campaignId);
        startTransition(async () => {
            try {
                const res = await cancelPropertyMatchCampaignBatchAction(campaignId);
                if (!res.success) setError(res.error || "Could not stop batch processing.");
                setBatchProgress((current) => current?.campaignId === campaignId ? {
                    ...current,
                    phase: "stopped",
                    message: "Processing stopped.",
                } : current);
                setProcessingCampaignId((current) => (current === campaignId ? null : current));
                await refreshCampaigns();
                await refreshDetail(campaignId, queue);
            } finally {
                setCancelingCampaignId(null);
            }
        });
    };

    const startEditCampaign = (campaign: Campaign) => {
        setSelectedCampaignId(campaign.id);
        setMobileView("campaigns");
        setEditingCampaignId(campaign.id);
        setEditTitle(campaignLabel(campaign));
        setEditPriorityNote(campaign.priorityNote || "");
        setError("");
    };

    const saveCampaignEdit = () => {
        if (!editingCampaignId) return;
        setError("");
        startTransition(async () => {
            const res = await updatePropertyMatchCampaignAction(editingCampaignId, {
                title: editTitle,
                priorityNote: editPriorityNote,
            });
            if (!res.success) {
                setError(res.error || "Could not update campaign.");
                return;
            }
            setEditingCampaignId(null);
            await refreshCampaigns();
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
        });
    };

    const requestDeleteCampaign = (campaign: Campaign) => {
        setCampaignToDelete(campaign);
        setError("");
    };

    const confirmDeleteCampaign = () => {
        if (!campaignToDelete) return;
        const campaign = campaignToDelete;
        setError("");
        startTransition(async () => {
            const res = await deletePropertyMatchCampaignAction(campaign.id);
            if (!res.success) {
                setError(res.error || "Could not delete campaign.");
                return;
            }
            const rows = await refreshCampaigns();
            const nextSelected = selectedCampaignId === campaign.id ? (rows[0]?.id || null) : selectedCampaignId;
            setSelectedCampaignId(nextSelected);
            if (!nextSelected) setMobileView("campaigns");
            setEditingCampaignId(null);
            setCampaignToDelete(null);
            if (nextSelected) loadDetail(nextSelected, queue);
            else setDetail(null);
        });
    };

    const selectCampaign = (campaignId: string) => {
        setSelectedCampaignId(campaignId);
        setMobileView("review");
    };

    const setQueueAndReload = (nextQueue: Queue) => {
        setQueue(nextQueue);
    };

    const generateDraft = (candidate: Candidate) => {
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await generatePropertyMatchCandidateDraftAction(candidate.id);
            if (!res.success) setError(res.error || "Draft generation failed.");
            if (res.success) {
                setError("");
                setDrafts((current) => ({ ...current, [candidate.id]: res.draft }));
                setDetail((current) => current ? {
                    ...current,
                    candidates: current.candidates.map((item) => (
                        item.id === candidate.id ? { ...item, draftBody: res.draft } : item
                    )),
                } : current);
            }
            setBusyCandidateId(null);
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
        });
    };

    const refreshCampaignCountsInBackground = (campaignId: string) => {
        void refreshCampaigns().then((rows) => {
            const updatedCampaign = rows.find((campaign) => campaign.id === campaignId);
            if (!updatedCampaign) return;
            setDetail((current) => (
                current?.campaign.id === campaignId
                    ? { ...current, campaign: updatedCampaign }
                    : current
            ));
        });
    };

    const reviewCandidateWithoutSending = (
        candidate: Candidate,
        reviewerStatus: "skipped" | "rejected",
        reason: string,
        errorMessage: string,
    ) => {
        const campaignId = selectedCampaignId;
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await reviewPropertyMatchCandidateAction(candidate.id, reviewerStatus, reason);
            if (!res.success) {
                setError(res.error || errorMessage);
                setBusyCandidateId(null);
                return;
            }
            setError("");
            setDetail((current) => current ? {
                ...current,
                candidates: reviewedCandidateShouldStayVisible(queue)
                    ? current.candidates.map((item) => (
                        item.id === candidate.id
                            ? {
                                ...item,
                                reviewerStatus,
                                reviewedAt: new Date().toISOString(),
                                rejectedReason: reason,
                                lastError: null,
                            }
                            : item
                    ))
                    : current.candidates.filter((item) => item.id !== candidate.id),
            } : current);
            setBusyCandidateId(null);
            if (campaignId) refreshCampaignCountsInBackground(campaignId);
        });
    };

    const skipCandidate = (candidate: Candidate) => {
        reviewCandidateWithoutSending(
            candidate,
            "skipped",
            "Skipped for now during campaign review",
            "Could not skip contact.",
        );
    };

    const rejectCandidate = (candidate: Candidate) => {
        reviewCandidateWithoutSending(
            candidate,
            "rejected",
            "Rejected as not a suitable match during campaign review",
            "Could not reject contact.",
        );
    };

    const saveDraft = (candidate: Candidate) => {
        const draftBody = drafts[candidate.id] || "";
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await savePropertyMatchCandidateDraftAction(candidate.id, draftBody);
            if (!res.success) setError(res.error || "Could not save draft.");
            if (res.success) {
                setError("");
                setDrafts((current) => ({ ...current, [candidate.id]: draftBody }));
                setDetail((current) => current ? {
                    ...current,
                    candidates: current.candidates.map((item) => (
                        item.id === candidate.id
                            ? {
                                ...item,
                                draftBody,
                                reviewerStatus: "approved",
                                reviewedAt: new Date().toISOString(),
                                lastError: null,
                            }
                            : item
                    )),
                } : current);
                void refreshCampaigns();
            }
            setBusyCandidateId(null);
        });
    };

    const sendCandidate = (candidate: Candidate) => {
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await sendPropertyMatchCandidateAction(
                candidate.id,
                drafts[candidate.id] || candidate.draftBody || "",
                candidate.preferredChannel as any,
            );
            if (!res.success) setError((res as any).error || "Message send failed.");
            setBusyCandidateId(null);
            if (selectedCampaignId) {
                await refreshCampaigns();
                loadDetail(selectedCampaignId, queue);
            }
        });
    };

    const openCandidateConversation = (candidate: Candidate) => {
        if (!candidate.conversationId) return;
        if (onOpenConversation) {
            onOpenConversation(candidate.conversationId);
            return;
        }
        window.location.href = `/admin/conversations?id=${encodeURIComponent(candidate.conversationId)}`;
    };

    const activeCampaign = (detail?.campaign.id === selectedCampaignId ? detail.campaign : null)
        || campaigns.find((campaign) => campaign.id === selectedCampaignId)
        || null;
    const activeDetail = detail?.campaign.id === activeCampaign?.id ? detail : null;
    const activeCampaignIsProcessing = processingCampaignId === activeCampaign?.id || campaignCanStop(activeCampaign);
    const activeCampaignIsCanceling = cancelingCampaignId === activeCampaign?.id;
    const activeCampaignIsStopped = campaignIsStopped(activeCampaign);
    const activeCampaignIsBatchBusy = processingCampaignId === activeCampaign?.id;
    const activeBatchProgress = batchProgress?.campaignId === activeCampaign?.id ? batchProgress : null;
    const activeProgressPercent = progressPercent(activeCampaign);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(92dvh,820px)] sm:w-[calc(100vw-2rem)] sm:max-w-6xl sm:rounded-lg">
                <DialogHeader className="border-b px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
                    <div className="flex items-center gap-2 pr-8">
                        {mobileView === "review" ? (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 md:hidden"
                                onClick={() => setMobileView("campaigns")}
                                aria-label="Back to campaigns"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                        ) : null}
                        <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
                            <Megaphone className="h-4 w-4 shrink-0" />
                            <span className="truncate">Property campaigns</span>
                        </DialogTitle>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
                        <Button
                            type="button"
                            size="sm"
                            variant={mobileView === "campaigns" ? "default" : "outline"}
                            className="h-9 text-xs"
                            onClick={() => setMobileView("campaigns")}
                        >
                            <List className="mr-1.5 h-3.5 w-3.5" />
                            Campaigns
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={mobileView === "review" ? "default" : "outline"}
                            className="h-9 text-xs"
                            onClick={() => setMobileView("review")}
                        >
                            <Users className="mr-1.5 h-3.5 w-3.5" />
                            Review
                        </Button>
                    </div>
                </DialogHeader>

                <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
                    <aside className={`${mobileView === "campaigns" ? "flex" : "hidden"} min-h-0 flex-col overflow-y-auto border-r bg-slate-50/70 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:flex`}>
                        <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
                            <div className="rounded-md border bg-white p-3">
                                <div className="text-xs font-semibold uppercase text-slate-500">New campaign</div>
                                <div className="mt-2 flex gap-1">
                                    <input
                                        value={propertyQuery}
                                        onChange={(event) => setPropertyQuery(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") searchProperties();
                                        }}
                                        className="h-8 min-w-0 flex-1 rounded-md border px-2 text-xs"
                                        placeholder="Search ref, title, area"
                                    />
                                    <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={searchProperties}>
                                        {propertySearchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto md:max-h-36">
                                    {properties.map((property) => (
                                        <button
                                            key={property.id}
                                            type="button"
                                            onClick={() => setSelectedPropertyId(property.id)}
                                            className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${selectedPropertyId === property.id ? "border-emerald-400 bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
                                        >
                                            <div className="truncate font-medium text-slate-900">{property.title}</div>
                                            <div className="truncate text-[11px] text-slate-500">
                                                {[property.reference, property.type, property.bedrooms != null ? `${property.bedrooms} bed` : null, property.propertyLocation || property.city, formatMoney(property.price)].filter(Boolean).join(" · ")}
                                            </div>
                                        </button>
                                    ))}
                                    {!propertySearchLoading && propertyQuery.trim().length > 0 && propertyQuery.trim().length < MIN_PROPERTY_SEARCH_LENGTH ? (
                                        <div className="rounded-md border border-dashed px-2 py-2 text-[11px] text-slate-500">Type at least 2 characters.</div>
                                    ) : null}
                                    {!propertySearchLoading && propertyQuery.trim().length === 0 && properties.length === 0 ? (
                                        <div className="rounded-md border border-dashed px-2 py-2 text-[11px] text-slate-500">Search by reference, title, or area.</div>
                                    ) : null}
                                    {!propertySearchLoading && propertyQuery.trim().length >= 2 && properties.length === 0 ? (
                                        <div className="rounded-md border border-dashed px-2 py-2 text-[11px] text-slate-500">No matching properties.</div>
                                    ) : null}
                                </div>
                                <Textarea
                                    value={priorityNote}
                                    onChange={(event) => setPriorityNote(event.target.value)}
                                    rows={2}
                                    className="mt-2 min-h-14 text-xs"
                                    placeholder="Optional priority note"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    className="mt-2 h-8 w-full text-xs"
                                    disabled={!selectedProperty || isPending}
                                    onClick={createCampaignFromProperty}
                                >
                                    {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Megaphone className="mr-1.5 h-3 w-3" />}
                                    Create campaign
                                </Button>
                                <div className="my-3 border-t" />
                                <div className="text-xs font-semibold uppercase text-slate-500">Website source</div>
                                <input
                                    value={propertyUrl}
                                    onChange={(event) => setPropertyUrl(event.target.value)}
                                    className="mt-2 h-8 w-full rounded-md border px-2 text-xs"
                                    placeholder="Official property URL"
                                />
                                <Textarea
                                    value={propertyText}
                                    onChange={(event) => setPropertyText(event.target.value)}
                                    rows={3}
                                    className="mt-2 min-h-20 text-xs"
                                    placeholder="Paste property text if the page cannot be read"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 h-8 w-full text-xs"
                                    disabled={(!propertyUrl.trim() && !propertyText.trim()) || isPending}
                                    onClick={createCampaignFromSource}
                                >
                                    {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Link2 className="mr-1.5 h-3 w-3" />}
                                    Create from URL/text
                                </Button>
                            </div>

                            <div className="flex flex-col space-y-1 md:min-h-0 md:flex-1">
                                <div className="px-1 text-xs font-semibold uppercase text-slate-500">Campaigns</div>
                                <div className="space-y-1 pr-1 md:min-h-0 md:flex-1 md:overflow-y-auto">
                                    {campaigns.map((campaign) => (
                                        <div
                                            key={campaign.id}
                                            className={`rounded-md border text-xs ${selectedCampaignId === campaign.id ? "border-indigo-300 bg-indigo-50" : "bg-white hover:bg-slate-50"}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => selectCampaign(campaign.id)}
                                                className="w-full px-2 py-2 text-left"
                                            >
                                                <div className="truncate font-medium text-slate-900">{campaignLabel(campaign)}</div>
                                                <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{campaign.status}</Badge>
                                                    <span>{campaignQueueCounts(campaign).reviewCount} review</span>
                                                    <span>{campaignQueueCounts(campaign).sentCount} sent</span>
                                                    <span>{campaignQueueCounts(campaign).notMatchCount} no</span>
                                                </div>
                                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                                                    <span>{campaignQueueCounts(campaign).approvedCount} approved</span>
                                                    <span>{campaignQueueCounts(campaign).skippedCount} skipped</span>
                                                    <span>{campaignQueueCounts(campaign).rejectedCount} rejected</span>
                                                    <span>{campaignQueueCounts(campaign).alreadySharedCount} shared</span>
                                                </div>
                                            </button>
                                            <div className="flex justify-end gap-1 border-t border-slate-100 px-1 py-1">
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditCampaign(campaign)} title="Edit campaign">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => requestDeleteCampaign(campaign)} title="Delete campaign">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </aside>

                    <main className={`${mobileView === "review" ? "block" : "hidden"} min-h-0 overflow-hidden md:block`}>
                        {!activeCampaign ? (
                            <div className="flex h-full items-center justify-center text-sm text-slate-500">Create or select a campaign.</div>
                        ) : (
                            <div className="flex h-full min-h-0 flex-col">
                                <div className="border-b px-4 py-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-slate-900">{campaignLabel(activeCampaign)}</div>
                                            <div className="mt-1 text-xs text-slate-500">
                                                {activeCampaign.processedCandidates}/{activeCampaign.totalCandidates} processed
                                                {campaignQueueCounts(activeCampaign).pendingAiCount ? ` · ${campaignQueueCounts(activeCampaign).pendingAiCount} AI pending` : ""}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {QUEUE_OPTIONS.filter((item) => item.value !== "all").map((item) => {
                                                    const count = campaignQueueCounts(activeCampaign)[item.countKey];
                                                    return (
                                                        <Badge key={item.value} variant="outline" className="h-5 px-1.5 text-[10px]">
                                                            {item.label} {count}
                                                        </Badge>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-none sm:flex">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs"
                                                onClick={processMore}
                                                disabled={activeCampaignIsBatchBusy || activeCampaignIsCanceling}
                                            >
                                                {activeCampaignIsBatchBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                                                {activeCampaignIsStopped ? "Resume batch" : "Process batch"}
                                            </Button>
                                            {activeCampaignIsProcessing ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 text-xs text-red-600 hover:text-red-700"
                                                    onClick={stopProcessing}
                                                    disabled={activeCampaignIsCanceling}
                                                >
                                                    {activeCampaignIsCanceling ? (
                                                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <StopCircle className="mr-1.5 h-3 w-3" />
                                                    )}
                                                    {activeCampaignIsCanceling ? "Stopping..." : "Stop"}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {activeBatchProgress ? (
                                        <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-indigo-900">
                                                    {activeBatchProgress.phase === "analyzing" || activeBatchProgress.phase === "collecting" ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : null}
                                                    <span className="truncate">{activeBatchProgress.message}</span>
                                                </div>
                                                <div className="shrink-0 text-[11px] text-indigo-700">
                                                    {activeProgressPercent}% complete
                                                </div>
                                            </div>
                                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                                                <div
                                                    className="h-full rounded-full bg-indigo-600 transition-all"
                                                    style={{ width: `${activeProgressPercent}%` }}
                                                />
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-indigo-800">
                                                <span>{activeBatchProgress.collected} collected this run</span>
                                                <span>{activeBatchProgress.analyzed} analyzed this run</span>
                                                {activeBatchProgress.failed ? <span>{activeBatchProgress.failed} failed</span> : null}
                                                {campaignQueueCounts(activeCampaign).pendingAiCount ? (
                                                    <span>{campaignQueueCounts(activeCampaign).pendingAiCount} pending AI</span>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}
                                    {editingCampaignId === activeCampaign.id ? (
                                        <div className="mt-3 rounded-md border bg-slate-50 p-3">
                                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                                <input
                                                    value={editTitle}
                                                    onChange={(event) => setEditTitle(event.target.value)}
                                                    className="h-8 min-w-0 rounded-md border bg-white px-2 text-xs"
                                                    placeholder="Campaign title"
                                                />
                                                <input
                                                    value={editPriorityNote}
                                                    onChange={(event) => setEditPriorityNote(event.target.value)}
                                                    className="h-8 min-w-0 rounded-md border bg-white px-2 text-xs"
                                                    placeholder="Priority note"
                                                />
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                                                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingCampaignId(null)}>
                                                    Cancel
                                                </Button>
                                                <Button type="button" size="sm" className="h-8 text-xs" onClick={saveCampaignEdit} disabled={!editTitle.trim() || isPending}>
                                                    {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
                                                    Save
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}
                                    <div className="-mx-4 mt-2 overflow-x-auto px-4">
                                        <div className="flex min-w-max gap-1">
                                            {QUEUE_OPTIONS.map((item) => (
                                                <Button
                                                    key={item.value}
                                                    type="button"
                                                    size="sm"
                                                    variant={queue === item.value ? "default" : "outline"}
                                                    className="h-7 px-2 text-xs"
                                                    onClick={() => setQueueAndReload(item.value)}
                                                >
                                                    {item.label} {campaignQueueCounts(activeCampaign)[item.countKey]}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                    {error ? <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</div> : null}
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                                    {detailLoading && !activeDetail ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">
                                            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                                            Loading campaign contacts...
                                        </div>
                                    ) : null}
                                    {!detailLoading && activeDetail?.candidates.length === 0 ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">{queueEmptyLabel(queue)}</div>
                                    ) : null}
                                    <div className="space-y-3">
                                        {activeDetail?.candidates.map((candidate) => {
                                            const draft = drafts[candidate.id] ?? candidate.draftBody ?? "";
                                            const savedDraft = candidate.draftBody || "";
                                            const dimensions = candidateStructuredDimensions(candidate);
                                            const canSend = candidate.reviewerStatus === "approved"
                                                && !!savedDraft.trim()
                                                && draft.trim() === savedDraft.trim();
                                            const isBusy = busyCandidateId === candidate.id;
                                            const canReview = candidate.reviewerStatus === "pending"
                                                && (candidate.aiVerdict === "yes" || candidate.aiVerdict === "maybe")
                                                && (candidate.aiReviewStatus === "done" || candidate.aiReviewStatus === "failed" || !candidate.aiReviewStatus);
                                            const showDraftControls = canReview || candidate.reviewerStatus === "approved";
                                            const decisionDate = candidate.sentAt || candidate.reviewedAt;
                                            return (
                                                <div key={candidate.id} className="rounded-md border bg-white p-3">
                                                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                <div className="truncate text-sm font-medium text-slate-900">{candidate.contact?.name || "Unnamed contact"}</div>
                                                                <Badge variant="outline" className="h-5 text-[10px]">
                                                                    {candidate.reviewerStatus}
                                                                </Badge>
                                                                <Badge variant={candidate.aiVerdict === "yes" ? "default" : candidate.aiVerdict === "maybe" ? "secondary" : "outline"} className="h-5 text-[10px]">
                                                                    {candidate.aiVerdict} {confidenceLabel(candidate.confidence)}
                                                                </Badge>
                                                                {candidate.aiReviewStatus ? <Badge variant="outline" className="h-5 text-[10px]">AI {candidate.aiReviewStatus}</Badge> : null}
                                                                {candidate.preferredChannel ? <Badge variant="outline" className="h-5 text-[10px]">{candidate.preferredChannel}</Badge> : null}
                                                            </div>
                                                            <div className="mt-1 text-xs text-slate-500">
                                                                {candidateRequirementLine(candidate)}
                                                            </div>
                                                            {decisionDate ? (
                                                                <div className="mt-1 text-[11px] text-slate-500">
                                                                    {candidate.sentAt ? "Sent" : "Reviewed"} {formatDecisionDate(decisionDate)}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        <div className="grid grid-cols-1 items-center gap-1 sm:flex">
                                                            {candidate.conversationId ? (
                                                                <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs sm:h-7" onClick={() => openCandidateConversation(candidate)}>
                                                                    Open conversation
                                                                </Button>
                                                            ) : null}
                                                            {canReview ? (
                                                                <>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="h-8 px-2 text-xs sm:h-7"
                                                                        onClick={() => skipCandidate(candidate)}
                                                                        disabled={isBusy}
                                                                        title="Skip keeps this out of sending for now without marking the match as wrong."
                                                                    >
                                                                        <X className="mr-1.5 h-3.5 w-3.5" />
                                                                        Skip for now
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="h-8 px-2 text-xs text-red-600 hover:text-red-700 sm:h-7"
                                                                        onClick={() => rejectCandidate(candidate)}
                                                                        disabled={isBusy}
                                                                        title="Reject marks this candidate as not a suitable match."
                                                                    >
                                                                        Reject match
                                                                    </Button>
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                    {canReview ? (
                                                        <div className="mt-1 text-[11px] text-slate-500">
                                                            Skip keeps it out of this send for now. Reject marks it as a bad match.
                                                        </div>
                                                    ) : null}

                                                    <div className="mt-2 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-700">
                                                        <div className="font-medium">{candidate.matchSummary || "Match review"}</div>
                                                        {dimensions.length > 0 ? (
                                                            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                                                {dimensions.map((dimension) => (
                                                                    <div
                                                                        key={`${candidate.id}-${dimension.key || dimension.label}`}
                                                                        className={`min-w-0 rounded-md border px-2 py-1.5 ${dimensionStatusClass(dimension.status)}`}
                                                                        title={dimension.reason || undefined}
                                                                    >
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="truncate font-medium">{dimension.label}</span>
                                                                            <span className="shrink-0 text-[10px] uppercase">{dimension.status || "unknown"}</span>
                                                                        </div>
                                                                        <div className="mt-0.5 truncate text-[11px] opacity-85">
                                                                            {formatDimensionValue(dimension.propertyValue)} vs {formatDimensionValue(dimension.requirementValue)}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                        {candidate.reasoning ? <div className="mt-1 text-slate-600">{candidate.reasoning}</div> : null}
                                                        {candidate.rejectedReason ? <div className="mt-1 text-slate-600">Decision note: {candidate.rejectedReason}</div> : null}
                                                        {candidate.lastError ? <div className="mt-1 text-red-600">{candidate.lastError}</div> : null}
                                                    </div>

                                                    {showDraftControls ? (
                                                        <div className="mt-2 space-y-2">
                                                            <Textarea
                                                                value={draft}
                                                                onChange={(event) => setDrafts((current) => ({ ...current, [candidate.id]: event.target.value }))}
                                                                rows={4}
                                                                className="min-h-24 text-sm"
                                                                placeholder="Generate or write the message draft"
                                                            />
                                                            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                                                                <Button type="button" size="sm" variant="outline" className="h-9 text-xs sm:h-8" onClick={() => generateDraft(candidate)} disabled={isBusy || isPending}>
                                                                    {isBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                                                                    Generate draft
                                                                </Button>
                                                                <Button type="button" size="sm" variant="outline" className="h-9 text-xs sm:h-8" onClick={() => saveDraft(candidate)} disabled={!draft.trim() || isBusy}>
                                                                    <Check className="mr-1.5 h-3 w-3" />
                                                                    Approve
                                                                </Button>
                                                                <Button type="button" size="sm" className="h-9 text-xs sm:h-8" onClick={() => sendCandidate(candidate)} disabled={!canSend || isBusy}>
                                                                    <Send className="mr-1.5 h-3 w-3" />
                                                                    Send
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </DialogContent>
            <AlertDialog open={!!campaignToDelete} onOpenChange={(nextOpen) => {
                if (!nextOpen && !isPending) setCampaignToDelete(null);
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will delete "{campaignLabel(campaignToDelete)}" and remove its candidate review rows. Sent messages and contact records will not be deleted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                confirmDeleteCampaign();
                            }}
                            disabled={isPending}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            {isPending ? "Deleting..." : "Delete campaign"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}
