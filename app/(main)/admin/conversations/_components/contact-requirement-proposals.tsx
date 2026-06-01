'use client';

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Check, Info, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
    analyzeContactRequirementsAction,
    approveContactRequirementProposalAction,
    getContactContext,
    listContactRequirementProposals,
    rejectContactRequirementProposalAction,
    resolveContactPropertyEvidenceAction,
} from "../actions";

type RequirementProposal = {
    id: string;
    createdAt: string;
    proposedPatch: Record<string, unknown> | null;
    proposedSummary: string | null;
    currentSnapshot: Record<string, unknown> | null;
    evidence: any;
    confidence: number | null;
    reasoning: string | null;
};

const REQUIREMENTS_HELP_TEXT = "Shows AI-proposed changes to this client's search criteria from new client messages and activity notes. Proposals stay pending until a human approves them.";

function formatFieldLabel(field: string) {
    return field
        .replace(/^requirement/, "")
        .replace(/([A-Z])/g, " $1")
        .trim() || field;
}

function formatValue(value: unknown) {
    if (Array.isArray(value)) return value.join(", ");
    if (value == null || value === "") return "Empty";
    return String(value);
}

function getEvidenceItems(evidence: any): Array<{ sourceId?: string; quote?: string; field?: string; text?: string }> {
    if (!Array.isArray(evidence)) return [];
    return evidence.slice(0, 4).map((item) => ({
        sourceId: item?.sourceId || item?.id,
        quote: item?.quote,
        field: item?.field,
        text: item?.text,
    }));
}

function RequirementsHelpControl() {
    return (
        <>
            <TooltipProvider delayDuration={150}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
                            aria-label="About client requirements"
                        >
                            <Info className="h-3.5 w-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-[260px] text-xs">
                        {REQUIREMENTS_HELP_TEXT}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                        aria-label="About client requirements"
                    >
                        <Info className="h-3.5 w-3.5" />
                    </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-[min(280px,calc(100vw-2rem))] p-3 text-xs text-slate-600">
                    {REQUIREMENTS_HELP_TEXT}
                </PopoverContent>
            </Popover>
        </>
    );
}

export function ContactRequirementProposals({
    conversationId,
    contactId,
    initialProposals,
    onContactContextUpdated,
    title = "Client Requirements",
    variant = "card",
    children,
}: {
    conversationId: string;
    contactId?: string | null;
    initialProposals?: RequirementProposal[] | null;
    onContactContextUpdated: (context: any) => void;
    title?: string;
    variant?: "card" | "inline";
    children?: ReactNode;
}) {
    const [items, setItems] = useState<RequirementProposal[]>(() => (
        Array.isArray(initialProposals) ? initialProposals.filter(Boolean) : []
    ));
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [resolvingProperties, setResolvingProperties] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [patchEdits, setPatchEdits] = useState<Record<string, string>>({});

    const resolvedContactId = String(contactId || "").trim();
    const seedKey = `${resolvedContactId}:${(initialProposals || []).map((proposal) => proposal.id).join(",")}`;

    const refresh = async (options?: { showLoading?: boolean }) => {
        if (!resolvedContactId) {
            setItems([]);
            return;
        }
        const showLoading = options?.showLoading !== false;
        if (showLoading) setLoading(true);
        try {
            const proposals = await listContactRequirementProposals(resolvedContactId);
            setItems(Array.isArray(proposals) ? proposals as RequirementProposal[] : []);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    useEffect(() => {
        setItems(Array.isArray(initialProposals) ? initialProposals.filter(Boolean) : []);
    }, [resolvedContactId, seedKey]);

    const visibleItems = useMemo(() => items.filter(Boolean), [items]);

    const analyze = async () => {
        if (!resolvedContactId || analyzing) return;
        setAnalyzing(true);
        try {
            const result = await analyzeContactRequirementsAction(conversationId, resolvedContactId);
            if (!result.success) {
                toast.error(String(result.error || "Requirement analysis failed."));
                return;
            }
            if (!result.created) {
                toast.info(String(result.reason || "No requirement changes detected."));
            } else {
                toast.success("Requirement update proposal created.");
            }
            await refresh();
        } finally {
            setAnalyzing(false);
        }
    };

    const resolveProperties = async () => {
        if (!resolvedContactId || resolvingProperties) return;
        setResolvingProperties(true);
        try {
            const result = await resolveContactPropertyEvidenceAction(conversationId, resolvedContactId);
            if (!result.success) {
                toast.error(String(result.error || "Property link resolution failed."));
                return;
            }
            if (Number(result.count || 0) > 0) {
                toast.success(`Resolved ${Number(result.count)} property evidence item${Number(result.count) === 1 ? "" : "s"}.`);
            } else {
                toast.info("No property links or references found.");
            }
            await refresh();
        } finally {
            setResolvingProperties(false);
        }
    };

    const approve = async (proposal: RequirementProposal) => {
        setBusyId(proposal.id);
        try {
            let editedPatch: any = proposal.proposedPatch || {};
            const editedText = patchEdits[proposal.id];
            if (editedText && editedText.trim()) {
                try {
                    editedPatch = JSON.parse(editedText);
                } catch {
                    toast.error("Edited patch must be valid JSON.");
                    return;
                }
            }
            const result = await approveContactRequirementProposalAction(proposal.id, editedPatch);
            if (!result.success) {
                toast.error(String(result.error || "Could not approve proposal."));
                return;
            }
            toast.success("Contact requirements updated.");
            if (resolvedContactId) {
                const context = await getContactContext(resolvedContactId, { refreshExternal: false });
                setItems(Array.isArray(context?.requirementProposals) ? context.requirementProposals as RequirementProposal[] : []);
                onContactContextUpdated(context);
            }
        } finally {
            setBusyId(null);
        }
    };

    const reject = async (proposal: RequirementProposal) => {
        setBusyId(proposal.id);
        try {
            const result = await rejectContactRequirementProposalAction(proposal.id, "Not a fit");
            if (!result.success) {
                toast.error(String(result.error || "Could not reject proposal."));
                return;
            }
            toast.success("Requirement proposal rejected.");
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const isInline = variant === "inline";

    return (
        <div className={isInline ? "space-y-2" : "rounded-md border bg-white p-3 space-y-3"}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-1.5">
                    <div className="truncate text-xs font-semibold text-slate-800">{title}</div>
                    <RequirementsHelpControl />
                </div>
                <div className="flex items-center gap-1.5">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={!resolvedContactId || resolvingProperties || analyzing}
                        onClick={resolveProperties}
                    >
                        {resolvingProperties ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        <span className="hidden min-[420px]:inline">Resolve Links</span>
                        <span className="min-[420px]:hidden">Links</span>
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={!resolvedContactId || analyzing || resolvingProperties}
                        onClick={analyze}
                    >
                        {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Analyze
                    </Button>
                </div>
            </div>

            {children}

            {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading proposals...
                </div>
            )}

            {visibleItems.map((proposal) => {
                const patch = proposal.proposedPatch || {};
                const current = proposal.currentSnapshot || {};
                const evidenceItems = getEvidenceItems(proposal.evidence);
                return (
                    <div key={proposal.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Proposed update
                            </div>
                            {proposal.confidence != null && (
                                <Badge variant="outline" className="h-5 text-[10px] bg-white">
                                    {Math.round(Number(proposal.confidence) * 100)}%
                                </Badge>
                            )}
                        </div>

                        {Object.entries(patch).map(([field, value]) => (
                            <div key={field} className="grid grid-cols-[88px_1fr] gap-2 text-[11px]">
                                <div className="text-slate-500">{formatFieldLabel(field)}</div>
                                <div>
                                    <div className="text-slate-500 line-through">{formatValue((current as any)[field])}</div>
                                    <div className="text-slate-900 font-medium whitespace-pre-wrap">{formatValue(value)}</div>
                                </div>
                            </div>
                        ))}

                        {proposal.reasoning && (
                            <p className="text-[11px] text-slate-700">{proposal.reasoning}</p>
                        )}

                        {evidenceItems.length > 0 && (
                            <div className="space-y-1">
                                <div className="text-[10px] font-semibold uppercase text-slate-500">Evidence</div>
                                {evidenceItems.map((item, index) => (
                                    <div key={`${item.sourceId || index}`} className="text-[10px] text-slate-600 rounded bg-white/70 border px-2 py-1">
                                        {item.field ? <span className="font-medium">{formatFieldLabel(item.field)}: </span> : null}
                                        {item.quote || item.text || "Evidence captured"}
                                    </div>
                                ))}
                            </div>
                        )}

                        <details className="text-[10px] text-slate-500">
                            <summary className="cursor-pointer">Edit JSON patch</summary>
                            <Textarea
                                className="mt-1 min-h-[110px] font-mono text-[10px]"
                                value={patchEdits[proposal.id] ?? JSON.stringify(patch, null, 2)}
                                onChange={(event) => setPatchEdits((prev) => ({ ...prev, [proposal.id]: event.target.value }))}
                            />
                        </details>

                        <div className="flex items-center justify-end gap-1.5">
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-slate-600 hover:text-red-700 hover:bg-red-50"
                                disabled={busyId === proposal.id}
                                onClick={() => reject(proposal)}
                            >
                                {busyId === proposal.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                Reject
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={busyId === proposal.id}
                                onClick={() => approve(proposal)}
                            >
                                {busyId === proposal.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Approve
                            </Button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
