'use client';

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
    applyContactVerificationAction,
    getContactContext,
    listContactVerificationProposals,
    markContactVerifiedAction,
    rejectContactVerificationAction,
    scanContactVerificationAction,
} from "../actions";

type VerificationProposal = {
    id: string;
    proposedPatch: Record<string, unknown> | null;
    proposedSummary: string | null;
    evidence: any;
    confidence: number | null;
    reasoning: string | null;
};

function statusLabel(value?: string | null) {
    switch (value) {
        case "verified_lead": return "Verified lead";
        case "likely_agent": return "Likely agent";
        case "likely_owner": return "Likely owner";
        case "not_a_lead": return "Not a lead";
        default: return "Needs review";
    }
}

function statusClass(value?: string | null) {
    switch (value) {
        case "verified_lead": return "border-emerald-200 bg-emerald-50 text-emerald-700";
        case "likely_agent":
        case "likely_owner": return "border-amber-200 bg-amber-50 text-amber-700";
        case "not_a_lead": return "border-slate-200 bg-slate-50 text-slate-700";
        default: return "";
    }
}

const PATCH_FIELD_LABELS: Record<string, string> = {
    contactType: "Type",
    leadGoal: "Goal",
    name: "Display name",
    firstName: "First name",
    lastName: "Last name",
    qualificationStage: "Stage",
    requirementSummary: "Requirements",
};

function patchSummary(patch: Record<string, unknown> | null) {
    if (!patch || typeof patch !== "object") return "No profile changes";
    const orderedFields = [
        "contactType",
        "leadGoal",
        "name",
        "firstName",
        "lastName",
        "qualificationStage",
        "requirementSummary",
    ];
    const entries = Object.entries(patch).sort(([left], [right]) => {
        const leftIndex = orderedFields.indexOf(left);
        const rightIndex = orderedFields.indexOf(right);
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    });
    const parts = entries.map(([field, value]) => `${PATCH_FIELD_LABELS[field] || field}: ${value == null ? "empty" : String(value)}`);
    return parts.length ? parts.join(" · ") : "No profile changes";
}

export function ContactVerificationProposals({
    conversationId,
    contactId,
    initialProposals,
    onContactContextUpdated,
}: {
    conversationId: string;
    contactId?: string | null;
    initialProposals?: VerificationProposal[] | null;
    onContactContextUpdated: (context: any) => void;
}) {
    const [items, setItems] = useState<VerificationProposal[]>(() => (
        Array.isArray(initialProposals) ? initialProposals.filter(Boolean) : []
    ));
    const [scanning, setScanning] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const resolvedContactId = String(contactId || "").trim();
    const seedKey = `${resolvedContactId}:${(initialProposals || []).map((proposal) => proposal.id).join(",")}`;

    useEffect(() => {
        setItems(Array.isArray(initialProposals) ? initialProposals.filter(Boolean) : []);
    }, [resolvedContactId, seedKey]);

    const visibleItems = useMemo(() => items.filter(Boolean), [items]);

    const reloadContext = async () => {
        if (!resolvedContactId) return;
        const context = await getContactContext(resolvedContactId, { refreshExternal: false });
        setItems(Array.isArray(context?.verificationProposals) ? context.verificationProposals as VerificationProposal[] : []);
        onContactContextUpdated(context);
    };

    const refresh = async () => {
        if (!resolvedContactId) return;
        const proposals = await listContactVerificationProposals(resolvedContactId);
        setItems(Array.isArray(proposals) ? proposals as VerificationProposal[] : []);
    };

    const scan = async () => {
        if (!resolvedContactId || scanning) return;
        setScanning(true);
        try {
            const result = await scanContactVerificationAction(resolvedContactId, conversationId);
            if (!result.success) {
                toast.error(String(result.error || "Contact verification failed."));
                return;
            }
            if (result.proposalCreated) {
                toast.success("Contact verification proposal created.");
                await reloadContext();
            } else {
                toast.info(String(result.reason || "No contact profile correction found."));
                if (result.assessment?.hasChanges !== false) {
                    await refresh();
                }
            }
        } finally {
            setScanning(false);
        }
    };

    const apply = async (proposal: VerificationProposal) => {
        setBusyId(proposal.id);
        try {
            const result = await applyContactVerificationAction(proposal.id, proposal.proposedPatch || {});
            if (!result.success) {
                toast.error(String(result.error || "Could not apply correction."));
                return;
            }
            toast.success(result.updated === false ? "Verification proposal is already current." : "Contact profile updated.");
            await reloadContext();
        } finally {
            setBusyId(null);
        }
    };

    const reject = async (proposal: VerificationProposal) => {
        setBusyId(proposal.id);
        try {
            const result = await rejectContactVerificationAction(proposal.id, "Not a fit");
            if (!result.success) {
                toast.error(String(result.error || "Could not reject suggestion."));
                return;
            }
            toast.success("Verification suggestion rejected.");
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const markVerified = async () => {
        if (!resolvedContactId) return;
        setBusyId("verified");
        try {
            const result = await markContactVerifiedAction(resolvedContactId);
            if (!result.success) {
                toast.error(String(result.error || "Could not mark contact verified."));
                return;
            }
            toast.success("Contact marked verified.");
            await reloadContext();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-2 border-t pt-1.5">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                    <div className="truncate text-xs font-semibold text-slate-800">Contact verification</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <TooltipProvider delayDuration={150}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1.5 text-[11px]"
                                    disabled={!resolvedContactId || busyId === "verified"}
                                    onClick={markVerified}
                                    aria-label="Mark contact verified"
                                >
                                    {busyId === "verified" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Mark verified</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px]"
                        disabled={!resolvedContactId || scanning}
                        onClick={scan}
                        title="Scan name, role, goal, requirements, and recent messages"
                        aria-label="Scan contact verification"
                    >
                        {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>

            {visibleItems.length === 0 ? (
                <div className="text-[11px] text-slate-500">No pending profile corrections.</div>
            ) : (
                <div className="space-y-2">
                    {visibleItems.map((proposal) => {
                        const isBusy = busyId === proposal.id;
                        return (
                            <div key={proposal.id} className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs text-slate-700">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <Badge variant="outline" className={`h-5 text-[10px] ${statusClass(proposal.proposedSummary)}`}>
                                        {statusLabel(proposal.proposedSummary)}
                                    </Badge>
                                    {Number.isFinite(Number(proposal.confidence)) ? (
                                        <span className="text-[10px] text-slate-500">{Math.round(Number(proposal.confidence) * 100)}%</span>
                                    ) : null}
                                </div>
                                <div className="mt-1 font-medium">{patchSummary(proposal.proposedPatch)}</div>
                                {proposal.reasoning ? <div className="mt-1 text-[11px] text-slate-600">{proposal.reasoning}</div> : null}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Button type="button" size="sm" className="h-7 px-2 text-[11px]" disabled={isBusy} onClick={() => apply(proposal)}>
                                        {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                                        Apply correction
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={isBusy} onClick={() => reject(proposal)}>
                                        <X className="mr-1.5 h-3.5 w-3.5" />
                                        Reject suggestion
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
