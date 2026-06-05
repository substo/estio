'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Check, ChevronLeft, Link2, List, Loader2, Megaphone, Pencil, Search, Send, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
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
    sentCount: number;
    priorityNote?: string | null;
};

type Candidate = {
    id: string;
    contactId: string;
    conversationId?: string | null;
    aiVerdict: "yes" | "maybe" | "no";
    reviewerStatus: string;
    confidence?: number | null;
    matchSummary?: string | null;
    reasoning?: string | null;
    preferredChannel?: "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" | string | null;
    draftBody?: string;
    lastError?: string | null;
    contact?: {
        name?: string | null;
        phone?: string | null;
        email?: string | null;
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

type Queue = "review" | "sent" | "no";
type MobileCampaignView = "campaigns" | "review";

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

export function PropertyMatchCampaignsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CampaignDetail | null>(null);
    const [queue, setQueue] = useState<Queue>("review");
    const [propertyQuery, setPropertyQuery] = useState("");
    const [properties, setProperties] = useState<PropertyResult[]>([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
    const [propertyUrl, setPropertyUrl] = useState("");
    const [propertyText, setPropertyText] = useState("");
    const [priorityNote, setPriorityNote] = useState("");
    const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editPriorityNote, setEditPriorityNote] = useState("");
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [mobileView, setMobileView] = useState<MobileCampaignView>("campaigns");
    const [isPending, startTransition] = useTransition();

    const selectedProperty = useMemo(
        () => properties.find((property) => property.id === selectedPropertyId) || null,
        [properties, selectedPropertyId],
    );

    const loadCampaigns = useCallback(() => {
        startTransition(async () => {
            const rows = await listPropertyMatchCampaignsAction();
            setCampaigns(rows as Campaign[]);
            setSelectedCampaignId((current) => {
                if (current && rows.some((campaign) => campaign.id === current)) return current;
                return rows[0]?.id || null;
            });
        });
    }, []);

    const loadDetail = useCallback((campaignId: string, nextQueue = queue) => {
        startTransition(async () => {
            const res = await getPropertyMatchCampaignDetailAction(campaignId, nextQueue);
            if (!res.success) {
                setError(res.error || "Could not load campaign.");
                return;
            }
            setError("");
            setDetail({ campaign: res.campaign as Campaign, candidates: res.candidates as Candidate[] });
            setDrafts((current) => {
                const next = { ...current };
                for (const candidate of res.candidates as Candidate[]) {
                    if (candidate.draftBody && !next[candidate.id]) next[candidate.id] = candidate.draftBody;
                }
                return next;
            });
        });
    }, [queue]);

    useEffect(() => {
        if (!open) return;
        setMobileView("campaigns");
        loadCampaigns();
        startTransition(async () => {
            const rows = await searchPropertyMatchCampaignPropertiesAction("");
            setProperties(rows as PropertyResult[]);
        });
    }, [loadCampaigns, open]);

    useEffect(() => {
        if (!open || !selectedCampaignId) return;
        loadDetail(selectedCampaignId, queue);
    }, [loadDetail, open, queue, selectedCampaignId]);

    const searchProperties = () => {
        startTransition(async () => {
            const rows = await searchPropertyMatchCampaignPropertiesAction(propertyQuery);
            setProperties(rows as PropertyResult[]);
        });
    };

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
            const rows = await listPropertyMatchCampaignsAction();
            setCampaigns(rows as Campaign[]);
            await processPropertyMatchCampaignBatchAction(res.campaignId, 5);
            loadDetail(res.campaignId, "review");
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
            const rows = await listPropertyMatchCampaignsAction();
            setCampaigns(rows as Campaign[]);
            await processPropertyMatchCampaignBatchAction(res.campaignId, 5);
            loadDetail(res.campaignId, "review");
        });
    };

    const processMore = () => {
        if (!selectedCampaignId) return;
        setError("");
        startTransition(async () => {
            const res = await processPropertyMatchCampaignBatchAction(selectedCampaignId, 5);
            if (!res.success) setError(res.error || "Batch processing failed.");
            await listPropertyMatchCampaignsAction().then((rows) => setCampaigns(rows as Campaign[]));
            loadDetail(selectedCampaignId, queue);
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
            const rows = await listPropertyMatchCampaignsAction();
            setCampaigns(rows as Campaign[]);
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
        });
    };

    const deleteCampaign = (campaign: Campaign) => {
        const label = campaignLabel(campaign);
        if (!window.confirm(`Delete campaign "${label}"? This removes its candidate review rows too.`)) return;
        setError("");
        startTransition(async () => {
            const res = await deletePropertyMatchCampaignAction(campaign.id);
            if (!res.success) {
                setError(res.error || "Could not delete campaign.");
                return;
            }
            const rows = await listPropertyMatchCampaignsAction();
            setCampaigns(rows as Campaign[]);
            const nextSelected = selectedCampaignId === campaign.id ? (rows[0]?.id || null) : selectedCampaignId;
            setSelectedCampaignId(nextSelected);
            if (!nextSelected) setMobileView("campaigns");
            setEditingCampaignId(null);
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
        if (selectedCampaignId) loadDetail(selectedCampaignId, nextQueue);
    };

    const generateDraft = (candidate: Candidate) => {
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await generatePropertyMatchCandidateDraftAction(candidate.id);
            if (!res.success) setError(res.error || "Draft generation failed.");
            if (res.success) setDrafts((current) => ({ ...current, [candidate.id]: res.draft }));
            setBusyCandidateId(null);
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
        });
    };

    const skipCandidate = (candidate: Candidate) => {
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            await reviewPropertyMatchCandidateAction(candidate.id, "skipped", "Skipped during campaign review");
            setBusyCandidateId(null);
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
        });
    };

    const saveDraft = (candidate: Candidate) => {
        setBusyCandidateId(candidate.id);
        startTransition(async () => {
            const res = await savePropertyMatchCandidateDraftAction(candidate.id, drafts[candidate.id] || "");
            if (!res.success) setError(res.error || "Could not save draft.");
            setBusyCandidateId(null);
            if (selectedCampaignId) loadDetail(selectedCampaignId, queue);
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
                await listPropertyMatchCampaignsAction().then((rows) => setCampaigns(rows as Campaign[]));
                loadDetail(selectedCampaignId, queue);
            }
        });
    };

    const activeCampaign = detail?.campaign || campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;

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
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                                        <Search className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                                <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
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

                            <div className="flex min-h-0 flex-1 flex-col space-y-1">
                                <div className="px-1 text-xs font-semibold uppercase text-slate-500">Campaigns</div>
                                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
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
                                                    <span>{campaign.yesCount} yes</span>
                                                    <span>{campaign.maybeCount} maybe</span>
                                                    <span>{campaign.sentCount} sent</span>
                                                </div>
                                            </button>
                                            <div className="flex justify-end gap-1 border-t border-slate-100 px-1 py-1">
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditCampaign(campaign)} title="Edit campaign">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => deleteCampaign(campaign)} title="Delete campaign">
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
                                                {activeCampaign.processedCandidates}/{activeCampaign.totalCandidates} processed · {activeCampaign.yesCount} yes · {activeCampaign.maybeCount} maybe · {activeCampaign.noCount} no
                                            </div>
                                        </div>
                                        <Button type="button" size="sm" variant="outline" className="h-8 w-full text-xs sm:w-auto" onClick={processMore} disabled={isPending}>
                                            {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                                            Process batch
                                        </Button>
                                    </div>
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
                                            {(["review", "sent", "no"] as Queue[]).map((item) => (
                                                <Button
                                                    key={item}
                                                    type="button"
                                                    size="sm"
                                                    variant={queue === item ? "default" : "outline"}
                                                    className="h-7 px-2 text-xs"
                                                    onClick={() => setQueueAndReload(item)}
                                                >
                                                    {item === "review" ? "Review" : item === "sent" ? "Approved/Sent" : "No/Skipped"}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                    {error ? <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</div> : null}
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                                    {detail?.candidates.length === 0 ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">No candidates in this queue.</div>
                                    ) : null}
                                    <div className="space-y-3">
                                        {detail?.candidates.map((candidate) => {
                                            const draft = drafts[candidate.id] ?? candidate.draftBody ?? "";
                                            const savedDraft = candidate.draftBody || "";
                                            const canSend = candidate.reviewerStatus === "approved"
                                                && !!savedDraft.trim()
                                                && draft.trim() === savedDraft.trim();
                                            const isBusy = busyCandidateId === candidate.id;
                                            return (
                                                <div key={candidate.id} className="rounded-md border bg-white p-3">
                                                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                <div className="truncate text-sm font-medium text-slate-900">{candidate.contact?.name || "Unnamed contact"}</div>
                                                                <Badge variant={candidate.aiVerdict === "yes" ? "default" : candidate.aiVerdict === "maybe" ? "secondary" : "outline"} className="h-5 text-[10px]">
                                                                    {candidate.aiVerdict} {confidenceLabel(candidate.confidence)}
                                                                </Badge>
                                                                {candidate.preferredChannel ? <Badge variant="outline" className="h-5 text-[10px]">{candidate.preferredChannel}</Badge> : null}
                                                            </div>
                                                            <div className="mt-1 text-xs text-slate-500">
                                                                {candidateRequirementLine(candidate)}
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 sm:flex">
                                                            {candidate.conversationId ? (
                                                                <Button asChild type="button" size="sm" variant="outline" className="h-8 px-2 text-xs sm:h-7">
                                                                    <a href={`/admin/conversations?id=${encodeURIComponent(candidate.conversationId)}`}>Open</a>
                                                                </Button>
                                                            ) : null}
                                                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-500 sm:h-7 sm:w-7" onClick={() => skipCandidate(candidate)} disabled={isBusy}>
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-2 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-700">
                                                        <div className="font-medium">{candidate.matchSummary || "Match review"}</div>
                                                        {candidate.reasoning ? <div className="mt-1 text-slate-600">{candidate.reasoning}</div> : null}
                                                        {candidate.lastError ? <div className="mt-1 text-red-600">{candidate.lastError}</div> : null}
                                                    </div>

                                                    {queue === "review" || draft ? (
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
        </Dialog>
    );
}
