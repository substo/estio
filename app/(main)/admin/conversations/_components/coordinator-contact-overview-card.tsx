"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Home, Loader2, Send, Sparkles, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    generatePropertyMatchCandidateDraftAction,
    listContactPropertyRecommendationsAction,
    savePropertyMatchCandidateDraftAction,
    sendPropertyMatchCandidateAction,
} from "../actions";
import { DEFAULT_CONTACT_TYPE } from "../../contacts/_components/contact-types";
import type { ContactIdentityPatch } from "../../contacts/_components/contact-form";
import { GroupMembersList } from "./group-members-list";
import { hasFullContactContext, isShellContactContext } from "./conversation-workspace-ui-actions";
import { ContactRequirementProposals } from "./contact-requirement-proposals";
import { ContactVerificationProposals } from "./contact-verification-proposals";

const EditContactDialog = dynamic(
    () => import("../../contacts/_components/edit-contact-dialog").then((mod) => mod.EditContactDialog),
    {
        loading: () => <div className="h-10 rounded-md bg-slate-100 animate-pulse" />,
    }
);

interface CoordinatorContactOverviewCardProps {
    conversationId: string;
    conversationContactName?: string | null;
    conversationStatus?: string | null;
    contactContext: any;
    loadingContext: boolean;
    hidden: boolean;
    onContactSaved?: (patch: ContactIdentityPatch) => void;
    onContactMerged?: (targetContactId: string, targetConversationId?: string | null) => void;
    onContactContextUpdated: (context: any) => void;
}

function normalizeContactValue(value: unknown): string {
    return String(value || "").trim().toLowerCase();
}

function isMeaningfulRequirementValue(value: unknown): boolean {
    const raw = String(value || "").trim();
    if (!raw) return false;
    return !raw.toLowerCase().includes("any");
}

function formatRoleLabel(value: unknown): string {
    const cleaned = String(value || "").trim().replace(/[_-]+/g, " ");
    if (!cleaned) return "Role";
    return cleaned
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(" ");
}

function getBriefRequirementItems(contact: any): Array<{ label: string; value: string }> {
    if (!contact) return [];

    const items: Array<{ label: string; value: string }> = [];
    const district = String(contact.requirementDistrict || "").trim();
    const bedrooms = String(contact.requirementBedrooms || "").trim();
    const condition = String(contact.requirementCondition || "").trim();
    const minPrice = String(contact.requirementMinPrice || "").trim();
    const maxPrice = String(contact.requirementMaxPrice || "").trim();
    const propertyTypes = (Array.isArray(contact.requirementPropertyTypes) ? contact.requirementPropertyTypes : [])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean);
    const locations = (Array.isArray(contact.requirementPropertyLocations) ? contact.requirementPropertyLocations : [])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean);

    if (isMeaningfulRequirementValue(district)) items.push({ label: "District", value: district });
    if (isMeaningfulRequirementValue(bedrooms)) items.push({ label: "Beds", value: bedrooms });
    if (isMeaningfulRequirementValue(condition)) items.push({ label: "Condition", value: condition });

    const hasMin = isMeaningfulRequirementValue(minPrice);
    const hasMax = isMeaningfulRequirementValue(maxPrice);
    if (hasMin || hasMax) {
        items.push({
            label: "Budget",
            value: `${hasMin ? minPrice : "Min open"} - ${hasMax ? maxPrice : "Max open"}`,
        });
    }

    if (propertyTypes.length > 0) {
        items.push({
            label: "Types",
            value: propertyTypes.slice(0, 3).join(", "),
        });
    }
    if (locations.length > 0) {
        items.push({
            label: "Areas",
            value: locations.slice(0, 3).join(", "),
        });
    }

    return items;
}

type ContactPropertyRecommendation = {
    candidateId: string;
    campaignId: string;
    property?: {
        id?: string | null;
        title?: string | null;
        reference?: string | null;
        price?: number | null;
        currency?: string | null;
        city?: string | null;
        propertyLocation?: string | null;
    } | null;
    aiVerdict?: string | null;
    aiReviewStatus?: string | null;
    reviewerStatus?: string | null;
    confidence?: number | null;
    matchSummary?: string | null;
    reasoning?: string | null;
    draftBody?: string | null;
    sentAt?: string | null;
    reviewedAt?: string | null;
    warnings?: string[];
};

function formatRecommendationPrice(property?: ContactPropertyRecommendation["property"]) {
    if (!Number.isFinite(Number(property?.price))) return "";
    return `${property?.currency || "EUR"} ${Number(property?.price).toLocaleString()}`;
}

function formatConfidence(value: unknown) {
    const confidence = Number(value);
    if (!Number.isFinite(confidence)) return "";
    return `${Math.round(confidence * 100)}%`;
}

function RecommendedPropertiesSection({
    contactId,
    conversationId,
}: {
    contactId: string;
    conversationId: string;
}) {
    const [items, setItems] = useState<ContactPropertyRecommendation[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        listContactPropertyRecommendationsAction(contactId, conversationId)
            .then((rows) => {
                if (cancelled) return;
                const nextItems = (Array.isArray(rows) ? rows : []) as ContactPropertyRecommendation[];
                setItems(nextItems);
                setDrafts((current) => {
                    const next = { ...current };
                    for (const item of nextItems) {
                        if (item.draftBody && next[item.candidateId] === undefined) {
                            next[item.candidateId] = item.draftBody;
                        }
                    }
                    return next;
                });
            })
            .catch((error) => {
                console.error("Failed to load property recommendations", error);
                if (!cancelled) setItems([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [contactId, conversationId]);

    async function reloadRecommendations() {
        const rows = await listContactPropertyRecommendationsAction(contactId, conversationId);
        const nextItems = (Array.isArray(rows) ? rows : []) as ContactPropertyRecommendation[];
        setItems(nextItems);
        setDrafts((current) => {
            const next = { ...current };
            for (const item of nextItems) {
                if (item.draftBody) next[item.candidateId] = item.draftBody;
            }
            return next;
        });
    }

    async function generateDraft(item: ContactPropertyRecommendation) {
        setBusyCandidateId(item.candidateId);
        setError("");
        try {
            const result = await generatePropertyMatchCandidateDraftAction(item.candidateId);
            if (!result.success) {
                setError(result.error || "Could not generate draft.");
                return;
            }
            setDrafts((current) => ({ ...current, [item.candidateId]: result.draft || "" }));
            await reloadRecommendations();
        } finally {
            setBusyCandidateId(null);
        }
    }

    async function approveDraft(item: ContactPropertyRecommendation) {
        const draft = String(drafts[item.candidateId] ?? item.draftBody ?? "").trim();
        if (!draft) {
            setError("Draft cannot be empty.");
            return;
        }
        setBusyCandidateId(item.candidateId);
        setError("");
        try {
            const result = await savePropertyMatchCandidateDraftAction(item.candidateId, draft);
            if (!result.success) {
                setError(result.error || "Could not approve draft.");
                return;
            }
            await reloadRecommendations();
        } finally {
            setBusyCandidateId(null);
        }
    }

    async function sendDraft(item: ContactPropertyRecommendation) {
        const draft = String(drafts[item.candidateId] ?? item.draftBody ?? "").trim();
        setBusyCandidateId(item.candidateId);
        setError("");
        try {
            const result = await sendPropertyMatchCandidateAction(item.candidateId, draft);
            if (!result.success) {
                setError(result.error || "Could not send recommendation.");
                return;
            }
            await reloadRecommendations();
        } finally {
            setBusyCandidateId(null);
        }
    }

    if (!loading && items.length === 0) return null;

    return (
        <div className="pt-1.5 border-t">
            <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Recommended Properties</span>
            {loading && items.length === 0 ? (
                <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
                    Loading recommendations...
                </div>
            ) : (
                <div className="space-y-1.5">
                    {error ? (
                        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                            {error}
                        </div>
                    ) : null}
                    {items.map((item) => {
                        const property = item.property || {};
                        const title = property.reference || property.title || "Property";
                        const price = formatRecommendationPrice(property);
                        const location = [property.propertyLocation, property.city].filter(Boolean).join(", ");
                        const warnings = Array.isArray(item.warnings) ? item.warnings.filter(Boolean) : [];
                        const draft = drafts[item.candidateId] ?? item.draftBody ?? "";
                        const savedDraft = String(item.draftBody || "").trim();
                        const draftChanged = draft.trim() !== savedDraft;
                        const isBusy = busyCandidateId === item.candidateId;
                        const canReview = (item.aiVerdict === "yes" || item.aiVerdict === "maybe")
                            && (item.aiReviewStatus === "done" || item.aiReviewStatus === "failed" || !item.aiReviewStatus)
                            && item.reviewerStatus !== "sent";
                        const canSend = item.reviewerStatus === "approved" && !!savedDraft && !draftChanged;
                        return (
                            <div key={item.candidateId} className="rounded-md border border-emerald-100 bg-emerald-50/40 p-2 text-[11px] text-foreground">
                                <div className="flex min-w-0 items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        {property.id ? (
                                            <Link
                                                href={`/admin/properties/${encodeURIComponent(property.id)}/view`}
                                                className="block truncate font-medium text-primary hover:underline"
                                                title={property.title || title}
                                            >
                                                {title}
                                            </Link>
                                        ) : (
                                            <div className="truncate font-medium">{title}</div>
                                        )}
                                        <div className="mt-0.5 truncate text-muted-foreground">
                                            {[price, location].filter(Boolean).join(" · ") || property.title || "Campaign property"}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        <Badge variant={item.aiVerdict === "yes" ? "default" : "secondary"} className="h-4 px-1 text-[9px]">
                                            {item.aiVerdict || "maybe"} {formatConfidence(item.confidence)}
                                        </Badge>
                                        {item.reviewerStatus ? (
                                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                                                {item.reviewerStatus}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </div>
                                {item.matchSummary ? (
                                    <div className="mt-1 leading-snug text-slate-700">{item.matchSummary}</div>
                                ) : null}
                                {warnings.length > 0 ? (
                                    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] leading-snug text-amber-800">
                                        {warnings[0]}
                                    </div>
                                ) : null}
                                {canReview || draft ? (
                                    <div className="mt-2 space-y-1.5">
                                        <Textarea
                                            value={draft}
                                            onChange={(event) => setDrafts((current) => ({
                                                ...current,
                                                [item.candidateId]: event.target.value,
                                            }))}
                                            rows={3}
                                            className="min-h-16 bg-white text-[11px]"
                                            placeholder="Generate or edit the recommendation draft"
                                            disabled={item.reviewerStatus === "sent" || isBusy}
                                        />
                                        <div className="grid grid-cols-3 gap-1.5">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-7 px-1 text-[10px]"
                                                onClick={() => generateDraft(item)}
                                                disabled={!canReview || isBusy}
                                            >
                                                {isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                                                Draft
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-7 px-1 text-[10px]"
                                                onClick={() => approveDraft(item)}
                                                disabled={!canReview || !draft.trim() || isBusy}
                                            >
                                                <Check className="mr-1 h-3 w-3" />
                                                Approve
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-7 px-1 text-[10px]"
                                                onClick={() => sendDraft(item)}
                                                disabled={!canSend || isBusy}
                                            >
                                                <Send className="mr-1 h-3 w-3" />
                                                Send
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function CoordinatorContactOverviewCard({
    conversationId,
    conversationContactName,
    conversationStatus,
    contactContext,
    loadingContext,
    hidden,
    onContactSaved,
    onContactMerged,
    onContactContextUpdated,
}: CoordinatorContactOverviewCardProps) {
    const canEditContact = hasFullContactContext(contactContext);
    const isShellContact = isShellContactContext(contactContext);

    return (
        <div className={cn(hidden ? 'hidden' : 'block')}>
            {(contactContext?.contact?.contactType === 'WhatsAppGroup' || contactContext?.contact?.phone?.includes('@g.us')) ? (
                <GroupMembersList conversationId={conversationId} />
            ) : (
                <Card className="shadow-none border-border/50">
                    <CardHeader className="p-3 pb-1.5">
                        <div className="flex justify-between items-center pr-4">
                            <CardTitle className="text-xs font-semibold">Details</CardTitle>
                            {canEditContact && (
                                <EditContactDialog
                                    contact={contactContext.contact}
                                    leadSources={contactContext.leadSources || []}
                                    onContactSaved={onContactSaved}
                                    onMergeSuccess={onContactMerged}
                                    skipRouterRefresh
                                />
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 text-sm space-y-2">
                        {contactContext?.contact ? (
                            <>
                                <div className="flex flex-col gap-0.5">
                                    <div className="font-medium text-sm text-primary hover:underline cursor-pointer">
                                        {canEditContact ? (
                                            <EditContactDialog
                                                contact={contactContext.contact}
                                                leadSources={contactContext.leadSources || []}
                                                trigger={<span>{contactContext.contact.name || "Unnamed Contact"}</span>}
                                                onContactSaved={onContactSaved}
                                                onMergeSuccess={onContactMerged}
                                                skipRouterRefresh
                                            />
                                        ) : (
                                            <span>{contactContext.contact.name || "Unnamed Contact"}</span>
                                        )}
                                    </div>
                                    <div className="text-muted-foreground text-[11px] flex flex-col gap-0.5">
                                        {contactContext.contact.email && (
                                            <div className="flex items-center gap-2">
                                                <span className="w-12 opacity-70">Email:</span>
                                                <span className="select-all text-foreground break-all">{contactContext.contact.email}</span>
                                            </div>
                                        )}
                                        {contactContext.contact.phone && (
                                            <div className="flex items-center gap-2">
                                                <span className="w-12 opacity-70">Phone:</span>
                                                <span className="select-all text-foreground break-all">{contactContext.contact.phone}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-1.5 text-xs">
                                    <div className="bg-secondary/50 p-1.5 rounded border border-secondary">
                                        <span className="text-muted-foreground block text-[10px] mb-0.5">Status</span>
                                        <span className="font-medium">{contactContext.contact.leadStage || "Unassigned"}</span>
                                    </div>
                                    <div className="bg-secondary/50 p-1.5 rounded border border-secondary">
                                        <span className="text-muted-foreground block text-[10px] mb-0.5">Type</span>
                                        <span className="font-medium">{contactContext.contact.contactType || (isShellContact ? "Loading..." : "Lead")}</span>
                                    </div>
                                </div>
                                {isShellContact && loadingContext && (
                                    <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-500">
                                        Loading full contact details from the CRM database. Property associations and search criteria appear after this finishes.
                                    </div>
                                )}

                                {!isShellContact && (() => {
                                    const contact = contactContext.contact;
                                    const normalizedType = normalizeContactValue(
                                        contact.normalizedContactType || contact.contactType || DEFAULT_CONTACT_TYPE
                                    );

                                    const propertyRoles = (Array.isArray(contact.propertyRoles) ? contact.propertyRoles : [])
                                        .map((role: any) => ({
                                            ...role,
                                            normalizedRole: normalizeContactValue(role.normalizedRole || role.role),
                                        }))
                                        .filter((role: any) => !!role?.property?.id);

                                    const companyRoles = (Array.isArray(contact.companyRoles) ? contact.companyRoles : [])
                                        .map((role: any) => ({
                                            ...role,
                                            normalizedRole: normalizeContactValue(role.normalizedRole || role.role),
                                        }))
                                        .filter((role: any) => !!role?.company?.id);

                                    const interestedProperties = (Array.isArray(contact.interestedProperties) ? contact.interestedProperties : [])
                                        .filter((property: any) => !!property?.id);

                                    const inspectedProperties = (Array.isArray(contact.inspectedProperties) ? contact.inspectedProperties : [])
                                        .filter((property: any) => !!property?.id);

                                    const briefRequirementItems = getBriefRequirementItems(contact);
                                    const requirementProposals = Array.isArray(contactContext?.requirementProposals)
                                        ? contactContext.requirementProposals.filter(Boolean)
                                        : [];
                                    const isLeadLike = normalizedType === "lead" || normalizedType === "contact";
                                    const isOwnerOrTenant = normalizedType === "owner" || normalizedType === "tenant";
                                    const isAgentPartnerAssociate = normalizedType === "agent" || normalizedType === "partner" || normalizedType === "associate";
                                    const isMaintenance = normalizedType === "maintenance";
                                    const isWhatsAppGroup = normalizedType === "whatsappgroup";

                                    let showCompanyRelations = false;
                                    let showPropertyAssociations = false;
                                    let showInterested = false;
                                    let showInspected = false;
                                    let showSearchCriteria = false;

                                    if (isAgentPartnerAssociate) {
                                        showCompanyRelations = companyRoles.length > 0;
                                    } else if (isMaintenance) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showPropertyAssociations = companyRoles.length === 0 && propertyRoles.length > 0;
                                    } else if (isOwnerOrTenant) {
                                        showPropertyAssociations = propertyRoles.length > 0;
                                    } else if (isLeadLike) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showInterested = interestedProperties.length > 0;
                                        showInspected = inspectedProperties.length > 0;
                                        showSearchCriteria = true;
                                        if (normalizedType === "contact") {
                                            showPropertyAssociations = propertyRoles.length > 0;
                                        }
                                    } else if (!isWhatsAppGroup) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showPropertyAssociations = propertyRoles.length > 0;
                                    }

                                    return (
                                        <>
                                            {showCompanyRelations && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Company Relations</span>
                                                    <div className="space-y-1">
                                                        {companyRoles.map((role: any) => (
                                                            <div key={role.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-emerald-50/50 rounded border border-emerald-100/60 text-foreground">
                                                                <Users className="w-3 h-3 text-emerald-600" />
                                                                <Link
                                                                    href={`/admin/companies/${encodeURIComponent(role.company.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={role.company.name}
                                                                >
                                                                    {role.company.name}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    {formatRoleLabel(role.role)}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showPropertyAssociations && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Property Associations</span>
                                                    <div className="space-y-1">
                                                        {propertyRoles.map((role: any) => (
                                                            <div key={role.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-blue-50/50 rounded border border-blue-100/60 text-foreground">
                                                                <Home className="w-3 h-3 text-blue-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(role.property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={role.property.title}
                                                                >
                                                                    {role.property.reference || role.property.title}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    {formatRoleLabel(role.role)}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showInterested && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Interested</span>
                                                    <div className="space-y-1">
                                                        {interestedProperties.map((property: any) => (
                                                            <div key={property.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-blue-50/50 rounded border border-blue-100/60 text-foreground">
                                                                <Home className="w-3 h-3 text-blue-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={property.title}
                                                                >
                                                                    {property.reference || property.title}
                                                                </Link>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showInspected && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Inspected</span>
                                                    <div className="space-y-1">
                                                        {inspectedProperties.map((property: any) => (
                                                            <div key={property.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-amber-50/60 rounded border border-amber-100/80 text-foreground">
                                                                <Home className="w-3 h-3 text-amber-600" />
                                                                <Link
                                                                    href={`/admin/properties/${encodeURIComponent(property.id)}/view`}
                                                                    className="truncate flex-1 text-primary hover:underline"
                                                                    title={property.title}
                                                                >
                                                                    {property.reference || property.title}
                                                                </Link>
                                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                                    Viewed
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {showSearchCriteria && (
                                                <div className="pt-1.5 border-t">
                                                    <ContactVerificationProposals
                                                        conversationId={conversationId}
                                                        contactId={contact.id}
                                                        initialProposals={contactContext?.verificationProposals}
                                                        onContactContextUpdated={onContactContextUpdated}
                                                    />
                                                    <ContactRequirementProposals
                                                        conversationId={conversationId}
                                                        contactId={contact.id}
                                                        initialProposals={requirementProposals}
                                                        onContactContextUpdated={onContactContextUpdated}
                                                        title="Requirements"
                                                        variant="inline"
                                                        unstructuredRequirements={contact.requirementOtherDetails}
                                                    >
                                                        {briefRequirementItems.length > 0 && (
                                                            <div className="flex flex-wrap gap-1">
                                                                {briefRequirementItems.map((item) => (
                                                                    <Badge
                                                                        key={`${item.label}-${item.value}`}
                                                                        variant="secondary"
                                                                        className="text-[9px] h-5 px-1.5 font-normal bg-secondary/60"
                                                                    >
                                                                        {item.label}: {item.value}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {contact.requirementSummary && (
                                                            <p className="text-[11px] leading-snug text-slate-600 whitespace-pre-wrap">
                                                                {contact.requirementSummary}
                                                            </p>
                                                        )}
                                                    </ContactRequirementProposals>
                                                    <RecommendedPropertiesSection
                                                        contactId={contact.id}
                                                        conversationId={conversationId}
                                                    />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}

                            </>
                        ) : (
                            // Fallback if context not loaded yet
                            <div className="flex flex-col gap-2 opacity-50">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Name:</span>
                                    <span>{conversationContactName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span>{conversationStatus}</span>
                                </div>
                                {loadingContext && <div className="text-xs text-center text-primary mt-2">Loading full details...</div>}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
