import { useState, useEffect, useRef } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { generateAIDraft, generateMultiContextDraftAction, getContactContext, generatePlanAction, executeNextTaskAction, getAgentPlan, getAgentExecutions, getTraceTreeAction, getContactInsightsAction, orchestrateAction, getConversationTranscriptUsage } from "../actions";
import { createPersistentDeal, findExistingDeal, removeConversationFromDeal } from "../../deals/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Check, Info, Layers, Users, Home, Link as LinkIcon, AlertCircle, ExternalLink, X, ListTodo, Play, CheckCircle2, Circle, Brain, ChevronDown, ChevronUp, Expand, Clock, Wrench, History, Database, Activity, AlertTriangle, CheckCircle, XCircle, ArrowRight, ArrowLeft, Mic } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DEFAULT_CONTACT_TYPE } from "../../contacts/_components/contact-types";
import { EditContactDialog } from "../../contacts/_components/edit-contact-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GroupMembersList } from './group-members-list';
import { TraceNodeRenderer } from "./trace-node-renderer";
import { ContactTaskManager } from "@/components/tasks/contact-task-manager";
import { ContactViewingManager } from "@/components/tasks/contact-viewing-manager";
import type { ContactIdentityPatch } from "../../contacts/_components/contact-form";

interface CoordinatorPanelProps {
    locationId: string;
    conversation: Conversation;
    selectedConversations?: Conversation[]; // New Prop for Context Mode
    dealContacts?: DealContactOption[];
    selectedDealConversationId?: string | null;
    onSelectDealConversation?: (conversationId: string) => void;
    initialContactContext?: any;
    initialTaskSummary?: any;
    initialViewingSummary?: any;
    initialAgentSummary?: any;
    lazySidebarDataEnabled?: boolean;
    onBackToConversation?: () => void;
    onDraftApproved: (text: string) => void;
    onDeselect?: (id: string) => void;
    onSuggestionsGenerated?: (suggestions: string[]) => void;
    onContactSaved?: (patch: ContactIdentityPatch) => void;
}

interface DealContactOption {
    conversationId: string;
    contactId: string;
    contactName: string;
    contactEmail?: string;
    contactPhone?: string;
    lastMessageDate: number;
    unreadCount?: number;
    lastMessageType?: string;
}

interface AgentTask {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done' | 'failed';
    result?: string;
}

interface ThoughtStep {
    step: number;
    description: string;
    conclusion: string;
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

export function CoordinatorPanel({
    locationId,
    conversation,
    selectedConversations,
    dealContacts,
    selectedDealConversationId,
    onSelectDealConversation,
    initialContactContext,
    initialTaskSummary,
    initialViewingSummary,
    initialAgentSummary,
    lazySidebarDataEnabled = true,
    onBackToConversation,
    onDraftApproved: _onDraftApproved,
    onDeselect,
    onSuggestionsGenerated,
    onContactSaved
}: CoordinatorPanelProps) {
    const [reasoning, setReasoning] = useState("");
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Agent Planner State
    const [goal, setGoal] = useState("Qualify the lead and book a viewing");
    const [plan, setPlan] = useState<AgentTask[]>([]);
    const [planning, setPlanning] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [agentActions, setAgentActions] = useState<any[]>([]);
    const [thoughtSteps, setThoughtSteps] = useState<ThoughtStep[]>([]);
    const [thinkingExpanded, setThinkingExpanded] = useState(false);
    const [rawTrace, setRawTrace] = useState<any>(null);
    const [traceTree, setTraceTree] = useState<any>(null); // Full hierarchical trace
    const [insights, setInsights] = useState<any[]>([]); // Memory insights
    const [traceModalOpen, setTraceModalOpen] = useState(false);
    const [executionHistory, setExecutionHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [loadingTraceDetails, setLoadingTraceDetails] = useState(false);

    // Context Builder State
    const [dealTitle, setDealTitle] = useState("");
    const [dealContextId, setDealContextId] = useState<string | null>(null);

    // Context Display State
    const [contactContext, setContactContext] = useState<any>(initialContactContext || null);
    const [loadingContext, setLoadingContext] = useState(false);
    const [sidebarTab, setSidebarTab] = useState<'overview' | 'tasks' | 'viewings'>('overview');
    const [loadedSidebarTabs, setLoadedSidebarTabs] = useState<{ overview: boolean; tasks: boolean; viewings: boolean }>({
        overview: true,
        tasks: !lazySidebarDataEnabled,
        viewings: !lazySidebarDataEnabled,
    });
    const taskOpenCount = Number(initialTaskSummary?.open || 0);
    const upcomingViewingCount = Number(initialViewingSummary?.upcoming || 0);
    const planProgressLabel = initialAgentSummary?.hasPlan
        ? `${Number(initialAgentSummary?.completedPlanSteps || 0)}/${Number(initialAgentSummary?.totalPlanSteps || 0)}`
        : null;

    // Orchestrator State (Phase 1)
    const [orchestrating, setOrchestrating] = useState(false);
    const [orchestrationResult, setOrchestrationResult] = useState<any>(null);

    // Usage Stats State
    const [conversationUsage, setConversationUsage] = useState({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCost: 0
    });

    // Transcript usage for this conversation
    const [transcriptUsage, setTranscriptUsage] = useState({ totalTokens: 0, totalCost: 0, transcriptCount: 0, extractionCount: 0 });
    const conversationIdRef = useRef(conversation.id);

    useEffect(() => {
        conversationIdRef.current = conversation.id;
    }, [conversation.id]);

    useEffect(() => {
        if (!lazySidebarDataEnabled) {
            setLoadedSidebarTabs({ overview: true, tasks: true, viewings: true });
            return;
        }
        setLoadedSidebarTabs((prev) => ({ ...prev, [sidebarTab]: true }));
    }, [sidebarTab, lazySidebarDataEnabled]);

    useEffect(() => {
        setContactContext(initialContactContext || null);
    }, [initialContactContext, conversation.id]);

    const isContextMode = selectedConversations && selectedConversations.length > 0;
    const traceToolCalls = Array.isArray(rawTrace?.toolCalls) ? rawTrace.toolCalls : [];
    const leadParserToolCall = traceToolCalls.find((c: any) => c?.tool === "gemini.generateContent") || null;
    const leadParserRequest = leadParserToolCall?.arguments || null;
    const leadParserResponse = leadParserToolCall?.result || null;

    // Fetch Plan on Load
    useEffect(() => {
        // Reset state immediately when conversation changes
        setPlan([]);
        setReasoning("");
        setThoughtSteps([]);
        setAgentActions([]);
        setRawTrace(null);
        setTraceTree(null);
        setGoal("Qualify the lead and book a viewing"); // Reset to default goal

        if (conversation.id) {
            getAgentPlan(conversation.id).then((res: any) => {
                if (res) {
                    if (res.plan) setPlan(res.plan);
                    if (res.usage) setConversationUsage(res.usage);
                    // Handle legacy return where res IS the plan array (if any stale cache/code)
                    if (Array.isArray(res)) setPlan(res);
                }
            });

            // Pull latest execution summary to hydrate Mission Control context.
            getAgentExecutions(conversation.id).then(history => {
                if (history && history.length > 0) {
                    const latest = history[0];
                    if (latest?.thoughtSummary) setReasoning(latest.thoughtSummary);
                }
            });
        }
    }, [conversation.id]);

    // Fetch transcript usage for this conversation
    useEffect(() => {
        if (conversation.id) {
            getConversationTranscriptUsage(conversation.id)
                .then(setTranscriptUsage)
                .catch(() => { });
        }
    }, [conversation.id]);

    // Fetch History when Modal Opens
    useEffect(() => {
        if (traceModalOpen && conversation.id) {
            setLoadingHistory(true);
            getAgentExecutions(conversation.id).then(history => {
                setExecutionHistory(history);
                // If there's no selected trace but we have history, select the latest
                if (!rawTrace && history.length > 0) {
                    handleSelectTrace(history[0]);
                }
                setLoadingHistory(false);
            });
        }
    }, [traceModalOpen, conversation.id]);

    const handleSelectTrace = async (trace: any) => {
        setRawTrace(trace);
        setTraceTree(null);
        setInsights([]);
        setLoadingTraceDetails(true);

        try {
            // 1. Fetch Tree
            if (trace.traceId) {
                const tree = await getTraceTreeAction(trace.traceId);
                setTraceTree(tree);
            }

            // 2. Fetch Insights (Memory)
            if (conversation.contactId) {
                const recentInsights = await getContactInsightsAction(conversation.contactId);
                setInsights(recentInsights);
            }
        } catch (e) {
            console.error("Failed to load trace details", e);
        } finally {
            setLoadingTraceDetails(false);
        }
    };

    // Auto-detect existing deal on selection change
    useEffect(() => {
        if (!selectedConversations || selectedConversations.length === 0) {
            setDealContextId(null);
            setDealTitle("");
            return;
        }

        const ids = selectedConversations.map(c => c.id);
        findExistingDeal(ids).then(deals => {
            if (deals && deals.length > 0) {
                setDealContextId(deals[0].id);
                setDealTitle(deals[0].title);
            } else {
                setDealContextId(null);
                setDealTitle("");
            }
        });
    }, [selectedConversations]);

    // Fetch Context on Load or Conversation Change
    useEffect(() => {
        if (!conversation?.contactId) return;
        if (initialContactContext?.contact) {
            setContactContext(initialContactContext);
            return;
        }

        setLoadingContext(true);
        getContactContext(conversation.contactId, { refreshExternal: false })
            .then(data => setContactContext(data))
            .catch(err => console.error("Failed to load context", err))
            .finally(() => setLoadingContext(false));
    }, [conversation.contactId, initialContactContext]);

    const handleOrchestrate = async () => {
        setOrchestrating(true);
        setError(null);
        setOrchestrationResult(null);
        try {
            const res = await orchestrateAction(conversation.id, conversation.contactId);
            setOrchestrationResult(res);

            if (res.reasoning) {
                setReasoning(res.reasoning);
            }
            if ((res as any)?.suggestionQueued) {
                onSuggestionsGenerated?.([]);
            }

            // Auto-refresh trace history
            setLoadingHistory(true);
            getAgentExecutions(conversation.id).then(history => {
                setExecutionHistory(history);
                setLoadingHistory(false);
            });

        } catch (e: any) {
            setError("Orchestration failed: " + e.message);
        } finally {
            setOrchestrating(false);
        }
    };

    const handleGenerateDraftOnly = async () => {
        setGenerating(true);
        setError(null);
        try {
            if (isContextMode) {
                // Multi-Context Flow (Simplified)
                let contextId = dealContextId;
                if (!contextId) {
                    const ids = selectedConversations!.map(c => c.id);
                    const title = dealTitle || `Deal: ${selectedConversations![0].contactName} & others`;
                    const newContext = await createPersistentDeal(title, ids);
                    setDealContextId(newContext.id);
                    contextId = newContext.id;
                }
                const res = await generateMultiContextDraftAction(contextId!, 'LEAD');
                setReasoning(res.reasoning);
                onSuggestionsGenerated?.([]);
            } else {
                const res = await generateAIDraft(
                    conversation.id,
                    conversation.contactId,
                    undefined,
                    undefined,
                    { mode: "chat", replyLanguage: conversation.replyLanguageOverride || null }
                );
                setReasoning(res.reasoning || "Suggested response queued for review.");
                onSuggestionsGenerated?.([]);
            }
        } catch (e: any) {
            setError("Failed to generate draft. " + e.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleGeneratePlan = async () => {
        setPlanning(true);
        setError(null);
        try {
            const res = await generatePlanAction(conversation.id, conversation.contactId, goal);
            if (res.success && res.plan) {
                setPlan(res.plan);
                setReasoning(res.thought || "Plan generated.");
            } else {
                setError(res.error || "Failed to generate plan");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setPlanning(false);
        }
    }

    const handleExecuteNext = async () => {
        setExecuting(true);
        setAgentActions([]);
        setThoughtSteps([]);
        setRawTrace(null);
        try {
            const res = await executeNextTaskAction(conversation.id, conversation.contactId);
            if (res.success) {
                // Update local plan state to reflect status change
                const updatedPlan = [...plan];
                const taskIndex = updatedPlan.findIndex(t => t.id === res.task.id);
                if (taskIndex >= 0) updatedPlan[taskIndex] = res.task;
                setPlan(updatedPlan);

                setReasoning(res.thoughtSummary || "Task executed.");
                setThoughtSteps(res.thoughtSteps || []);
                setAgentActions(res.actions || []);
                if ((res as any)?.suggestionQueued) {
                    onSuggestionsGenerated?.([]);
                }

                // Update usage stats if returned
                if (res.conversationUsage) {
                    setConversationUsage(res.conversationUsage);
                }

                // Store full trace for modal display
                setRawTrace({
                    timestamp: new Date().toISOString(),
                    task: res.task,
                    thoughtSummary: res.thoughtSummary,
                    thoughtSteps: res.thoughtSteps,
                    toolCalls: res.actions,
                    draftReply: res.draft,
                    usage: res.usage // Update current trace usage too
                });

                // Refresh context
                getContactContext(conversation.contactId).then(setContactContext);
            } else {
                if (res.message === "All tasks completed!") {
                    setReasoning("All tasks are done! Great job.");
                } else {
                    setError(res.error || "Failed to execute task");
                }
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setExecuting(false);
        }
    }

    const handleRemoveParticipant = async (conversationId: string) => {
        if (dealContextId) {
            try {
                await removeConversationFromDeal(dealContextId, conversationId);
            } catch (e) {
                console.error("Failed to remove from deal", e);
            }
        }
        onDeselect?.(conversationId);
    };

    const handleContactSaved = async (patch: ContactIdentityPatch) => {
        if (!patch?.id) return;

        setContactContext((prev: any) => {
            if (!prev?.contact || String(prev.contact.id) !== String(patch.id)) return prev;
            return {
                ...prev,
                contact: {
                    ...prev.contact,
                    ...patch,
                },
            };
        });

        onContactSaved?.(patch);

        const sourceConversationId = conversation.id;
        const sourceContactId = conversation.contactId;
        if (!sourceContactId) return;

        try {
            const refreshed = await getContactContext(sourceContactId);
            if (conversationIdRef.current !== sourceConversationId || !refreshed) return;

            setContactContext(refreshed);

            const refreshedContact = (refreshed as any)?.contact;
            if (refreshedContact?.id) {
                onContactSaved?.({
                    id: refreshedContact.id,
                    name: refreshedContact.name ?? null,
                    email: refreshedContact.email ?? null,
                    phone: refreshedContact.phone ?? null,
                    firstName: refreshedContact.firstName ?? null,
                    lastName: refreshedContact.lastName ?? null,
                    preferredLang: refreshedContact.preferredLang ?? null,
                });
            }
        } catch (error) {
            console.error("Failed to refetch contact context after save", error);
        }
    };

    return (
        <div className="h-full bg-muted/30 border-l p-3 overflow-y-auto space-y-3 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
                <div className="flex items-center gap-1">
                    {onBackToConversation && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={onBackToConversation}
                            title="Back to conversation"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <div className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm text-foreground">Mission Control</h3>
                    {planProgressLabel && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                            {planProgressLabel}
                        </Badge>
                    )}
                    </div>
                </div>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-primary"
                                onClick={() => setTraceModalOpen(true)}
                            >
                                <History className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Execution History</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {lazySidebarDataEnabled && (
                <div className="grid grid-cols-3 gap-1.5 mb-1 shrink-0">
                    <Button
                        type="button"
                        variant={sidebarTab === "overview" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setSidebarTab("overview")}
                    >
                        Overview
                    </Button>
                    <Button
                        type="button"
                        variant={sidebarTab === "tasks" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setSidebarTab("tasks")}
                    >
                        Tasks{taskOpenCount > 0 ? ` (${taskOpenCount})` : ''}
                    </Button>
                    <Button
                        type="button"
                        variant={sidebarTab === "viewings" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setSidebarTab("viewings")}
                    >
                        Viewings{upcomingViewingCount > 0 ? ` (${upcomingViewingCount})` : ''}
                    </Button>
                </div>
            )}

            {dealContacts && dealContacts.length > 0 && onSelectDealConversation && (
                <Card className="shadow-none border-border/50">
                    <CardHeader className="p-3 pb-1.5">
                        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-slate-500" />
                            Deal Contacts
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 space-y-1.5">
                        {dealContacts.map((contact) => {
                            const isActive = selectedDealConversationId === contact.conversationId;
                            return (
                                <button
                                    key={contact.conversationId}
                                    type="button"
                                    onClick={() => onSelectDealConversation(contact.conversationId)}
                                    className={cn(
                                        "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                                        isActive
                                            ? "border-blue-300 bg-blue-50"
                                            : "border-slate-200 bg-white hover:bg-slate-50"
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-slate-800 truncate">
                                            {contact.contactName || "Unknown Contact"}
                                        </span>
                                        {!!contact.unreadCount && contact.unreadCount > 0 && (
                                            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                                                {contact.unreadCount > 99 ? "99+" : contact.unreadCount}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                        {contact.contactEmail || contact.contactPhone || "No contact details"}
                                    </div>
                                </button>
                            );
                        })}
                    </CardContent>
                </Card>
            )}

            {/* Contact Details / Group Members Card */}
            <div className={cn(lazySidebarDataEnabled && sidebarTab !== 'overview' ? 'hidden' : 'block')}>
                {(contactContext?.contact?.contactType === 'WhatsAppGroup' || contactContext?.contact?.phone?.includes('@g.us')) ? (
                    <GroupMembersList conversationId={conversation.id} />
                ) : (
                    <Card className="shadow-none border-border/50">
                    <CardHeader className="p-3 pb-1.5">
                        <div className="flex justify-between items-center pr-4">
                            <CardTitle className="text-xs font-semibold">Details</CardTitle>
                            {contactContext?.contact && (
                                <EditContactDialog
                                    contact={contactContext.contact}
                                    leadSources={contactContext.leadSources || []}
                                    onContactSaved={handleContactSaved}
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
                                        <EditContactDialog
                                            contact={contactContext.contact}
                                            leadSources={contactContext.leadSources || []}
                                            trigger={<span>{contactContext.contact.name || "Unnamed Contact"}</span>}
                                            onContactSaved={handleContactSaved}
                                            skipRouterRefresh
                                        />
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
                                        <span className="font-medium">{contactContext.contact.contactType || "Lead"}</span>
                                    </div>
                                </div>

                                {(() => {
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
                                    const isLeadLike = normalizedType === "lead" || normalizedType === "contact";
                                    const isOwnerOrTenant = normalizedType === "owner" || normalizedType === "tenant";
                                    const isAgentPartnerAssociate = normalizedType === "agent" || normalizedType === "partner" || normalizedType === "associate";
                                    const isMaintenance = normalizedType === "maintenance";
                                    const isWhatsAppGroup = normalizedType === "whatsappgroup";

                                    let showCompanyRelations = false;
                                    let showPropertyAssociations = false;
                                    let showInterested = false;
                                    let showInspected = false;
                                    let showRequirements = false;

                                    if (isAgentPartnerAssociate) {
                                        showCompanyRelations = companyRoles.length > 0;
                                    } else if (isMaintenance) {
                                        showCompanyRelations = companyRoles.length > 0;
                                        showPropertyAssociations = companyRoles.length === 0 && propertyRoles.length > 0;
                                    } else if (isOwnerOrTenant) {
                                        showPropertyAssociations = propertyRoles.length > 0;
                                    } else if (isLeadLike) {
                                        showInterested = interestedProperties.length > 0;
                                        showInspected = inspectedProperties.length > 0;
                                        showRequirements = briefRequirementItems.length > 0;
                                        if (normalizedType === "contact") {
                                            showCompanyRelations = companyRoles.length > 0;
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

                                            {showRequirements && (
                                                <div className="pt-1.5 border-t">
                                                    <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Requirements</span>
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
                                    <span>{conversation.contactName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span>{conversation.status}</span>
                                </div>
                                {loadingContext && <div className="text-xs text-center text-primary mt-2">Loading full details...</div>}
                            </div>
                        )}
                    </CardContent>
                    </Card>
                )}
            </div>

            {(!lazySidebarDataEnabled || loadedSidebarTabs.tasks) && (
                <div className={cn(lazySidebarDataEnabled && sidebarTab !== 'tasks' ? 'hidden' : 'block')}>
                    <Card className="shadow-none border-border/50">
                        <CardContent className="p-3">
                            <ContactTaskManager
                                contactId={contactContext?.contact?.id || ''}
                                conversationId={conversation.id}
                                compact
                                title="Contact Tasks"
                            />
                        </CardContent>
                    </Card>
                </div>
            )}

            {(!lazySidebarDataEnabled || loadedSidebarTabs.viewings) && (
                <div className={cn(lazySidebarDataEnabled && sidebarTab !== 'viewings' ? 'hidden' : 'block')}>
                    <Card className="shadow-none border-border/50">
                        <CardContent className="p-3">
                            <ContactViewingManager
                                contactId={contactContext?.contact?.id || ''}
                                locationId={locationId}
                                compact
                                title="Property Viewings"
                                isEditing={true}
                            />
                        </CardContent>
                    </Card>
                </div>
            )}

            <div className={cn("flex-1 min-h-0 flex flex-col space-y-3", lazySidebarDataEnabled && sidebarTab !== 'overview' ? 'hidden' : '')}>
                {/* PLANNER SECTION */}
                {plan.length === 0 ? (
                    <div className="space-y-2 p-3 bg-card border rounded-md shadow-sm">
                        <div className="flex items-center gap-2 mb-1 text-purple-600 font-semibold text-sm">
                            <Sparkles className="w-4 h-4" />
                            Initialize Agent
                        </div>

                        {/* ORCHESTRATION RESULT DISPLAY */}
                        {orchestrationResult && (
                            <div className="mb-2 p-2 bg-indigo-50/50 border border-indigo-100 rounded text-xs space-y-1.5">
                                <div className="flex justify-between items-center border-b border-indigo-100 pb-1">
                                    <span className="font-semibold text-indigo-900">Analysis Complete</span>
                                    <Badge variant={orchestrationResult.requiresHumanApproval ? "destructive" : "outline"} className="text-[10px] h-4">
                                        {orchestrationResult.requiresHumanApproval ? "Review Req" : "Auto-Pilot"}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                    <div>
                                        <span className="text-[10px] text-muted-foreground block">Intent</span>
                                        <span className="font-medium text-indigo-700">{orchestrationResult.intent}</span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-muted-foreground block">Sentiment</span>
                                        <span className="font-medium text-indigo-700">{orchestrationResult.sentiment?.emotion}</span>
                                    </div>
                                </div>
                                {orchestrationResult.policyResult && (!orchestrationResult.policyResult.approved || orchestrationResult.policyResult.reviewRequired) && (
                                    <div className="mt-1 p-1 bg-red-50 text-red-700 rounded border border-red-100 flex gap-1 items-start">
                                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                        <span className="leading-tight">{orchestrationResult.policyResult.reason}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <label className="text-[11px] text-muted-foreground uppercase font-medium">Ultimate Goal</label>
                        <Textarea
                            className="bg-muted/50 min-h-[60px] text-sm resize-none"
                            value={goal}
                            onChange={e => setGoal(e.target.value)}
                        />
                        <Button
                            onClick={handleGeneratePlan}
                            disabled={planning}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-primary-foreground"
                        >
                            {planning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Generate Mission Plan
                        </Button>

                        {/* PHASE 1 ORCHESTRATOR BUTTON */}
                        <Button
                            onClick={handleOrchestrate}
                            disabled={orchestrating}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {orchestrating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
                            Orchestrate (Smart Agent)
                        </Button>
                        <Button
                            onClick={handleGenerateDraftOnly}
                            disabled={generating}
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-muted-foreground h-7"
                        >
                            Or queue a quick suggested response...
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2 bg-card border rounded-md shadow-sm overflow-hidden flex flex-col max-h-[400px]">
                        <div className="p-2 px-3 bg-purple-50/50 border-b flex justify-between items-center shrink-0">
                            <span className="text-[11px] font-bold text-purple-800 uppercase tracking-wider">Active Mission</span>
                            <Button variant="ghost" size="sm" className="h-5 p-0 text-[10px] text-muted-foreground hover:text-destructive" onClick={() => setPlan([])}>Reset</Button>
                        </div>
                        <div className="overflow-y-auto flex-1 p-0">
                            {plan.map((task) => (
                                <div key={task.id} className={cn(
                                    "p-2 border-b last:border-0 flex gap-2 items-start text-xs",
                                    task.status === 'in-progress' ? 'bg-blue-50/50' : ''
                                )}>
                                    <div className="mt-0.5">
                                        {task.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                                        {task.status === 'pending' && <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />}
                                        {task.status === 'in-progress' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                                        {task.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                                    </div>
                                    <div className="flex-1">
                                        <div className={cn("font-medium", task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground')}>{task.title}</div>
                                        {task.result && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{task.result}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-2 border-t bg-muted/20 shrink-0">
                            <Button
                                onClick={handleExecuteNext}
                                disabled={executing || plan.every(t => t.status === 'done')}
                                className="w-full h-8 text-xs"
                                variant={plan.every(t => t.status === 'done') ? "outline" : "default"}
                            >
                                {executing ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                                        Executing Step...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-3.5 h-3.5 mr-2" />
                                        {plan.every(t => t.status === 'done') ? "Mission Complete" : "Execute Next Step"}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Agent Actions Summary */}
                {agentActions.length > 0 && (
                    <Alert className="bg-green-50/50 border-green-200/50 p-2">
                        <Check className="h-3.5 w-3.5 text-green-600" />
                        <AlertTitle className="text-green-800 text-xs font-medium ml-2">Action Report</AlertTitle>
                        <AlertDescription className="text-xs text-green-700 break-all ml-2 mt-0.5">
                            {agentActions.map((a, i) => (
                                <div key={i}>• {a.tool}: {JSON.stringify(a.result?.message || a.result || a.error)}</div>
                            ))}
                        </AlertDescription>
                    </Alert>
                )}

                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* AI Reasoning Collapsible - Semantic Update */}
                {reasoning && (
                    <Collapsible open={thinkingExpanded} onOpenChange={setThinkingExpanded}>
                        <div className="bg-gradient-to-r from-purple-50/40 to-blue-50/40 border border-purple-100 rounded-lg overflow-hidden">
                            <CollapsibleTrigger className="w-full p-2.5 flex items-center justify-between hover:bg-purple-50/50 transition-colors">
                                <div className="flex items-center gap-2">
                                    <Brain className="h-3.5 w-3.5 text-purple-600" />
                                    <span className="text-xs font-medium text-purple-900">AI Reasoning</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-purple-600/80">{thinkingExpanded ? 'Hide' : 'View'}</span>
                                    {thinkingExpanded ? <ChevronUp className="h-3.5 w-3.5 text-purple-400" /> : <ChevronDown className="h-3.5 w-3.5 text-purple-400" />}
                                </div>
                            </CollapsibleTrigger>
                            <div className="px-2.5 pb-2.5">
                                <p className="text-xs text-purple-800/90 leading-relaxed">{reasoning}</p>
                            </div>
                            <CollapsibleContent>
                                {thoughtSteps.length > 0 && (
                                    <div className="border-t border-purple-100 bg-background/40 p-2.5 space-y-2">
                                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Step-by-Step Thinking</div>
                                        {thoughtSteps.map((step) => (
                                            <div key={step.step} className="flex gap-2 text-xs">
                                                <div className="flex-shrink-0 w-4 h-4 rounded-full bg-purple-100/80 text-purple-700 flex items-center justify-center font-medium text-[9px] mt-0.5">
                                                    {step.step}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-foreground font-medium text-[11px]">{step.description}</div>
                                                    <div className="text-muted-foreground mt-0.5 text-[10px]">{step.conclusion}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {/* View Full Trace Button */}
                                {rawTrace && (
                                    <div className="border-t border-purple-100 bg-purple-50/30 p-1.5 px-3">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setTraceModalOpen(true)}
                                            className="w-full h-6 text-[10px] text-purple-700 hover:text-purple-900 hover:bg-purple-100/50"
                                        >
                                            <Expand className="h-3 w-3 mr-1.5" />
                                            View Full AI Trace
                                        </Button>
                                    </div>
                                )}
                            </CollapsibleContent>
                        </div>
                    </Collapsible>
                )}

                {/* Full Trace Modal */}
                <Dialog open={traceModalOpen} onOpenChange={setTraceModalOpen}>
                    <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
                        <div className="flex h-full max-h-[85vh]">
                            {/* History Sidebar */}
                            <div className="w-64 border-r bg-muted/30 flex flex-col">
                                <div className="p-4 border-b">
                                    <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground">
                                        <History className="h-4 w-4" />
                                        History
                                    </h3>
                                </div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                    {loadingHistory ? (
                                        <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                                    ) : executionHistory.length === 0 ? (
                                        <div className="text-xs text-muted-foreground text-center p-4">No history yet</div>
                                    ) : (
                                        executionHistory.map((ex) => (
                                            <div
                                                key={ex.id}
                                                onClick={() => handleSelectTrace(ex)}
                                                className={cn(
                                                    "p-3 rounded-md text-xs cursor-pointer transition-colors border relative",
                                                    rawTrace?.id === ex.id
                                                        ? 'bg-purple-100/50 border-purple-200 text-purple-900 ring-1 ring-purple-200'
                                                        : 'bg-card border-border hover:border-purple-200 hover:bg-muted/50'
                                                )}
                                            >
                                                <div className="font-medium truncate pr-4">{ex.taskTitle || "Unknown Task"}</div>
                                                <div className="flex items-center justify-between mt-1 text-muted-foreground">
                                                    <span>{new Date(ex.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    <div className="flex gap-1">
                                                        {ex.taskStatus === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
                                                        {ex.taskStatus === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                                        {ex.taskStatus === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                                                    </div>
                                                </div>
                                                {typeof ex.usage?.cost === "number" && (
                                                    <div className="text-[10px] text-green-600/80 mt-0.5 font-mono">
                                                        ${ex.usage.cost.toFixed(5)}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Main Content */}
                            <div className="flex-1 flex flex-col max-h-[85vh] overflow-hidden bg-background">
                                <DialogHeader className="px-6 py-4 border-b">
                                    <DialogTitle className="flex items-center gap-2">
                                        <Brain className="h-5 w-5 text-purple-600" />
                                        Full AI Thinking Trace
                                    </DialogTitle>
                                    <DialogDescription>
                                        Complete reasoning flow from the AI agent execution
                                    </DialogDescription>
                                </DialogHeader>

                                {rawTrace && (
                                    <div className="flex-1 overflow-y-auto space-y-4 p-6 bg-slate-50/50">
                                        {/* 1. TRACE HEADER */}
                                        <div className="flex items-start justify-between bg-white p-4 rounded-lg border shadow-sm">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h2 className="text-lg font-bold text-slate-800">{rawTrace.taskTitle || "Unnamed Task"}</h2>
                                                    {rawTrace.taskStatus === 'success' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200"><CheckCircle className="w-3 h-3 mr-1" /> Success</Badge>}
                                                    {rawTrace.taskStatus === 'error' && <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>}
                                                    {rawTrace.taskStatus === 'pending' && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Pending</Badge>}
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        <span className="font-mono">{new Date(rawTrace.createdAt).toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <Activity className="w-3.5 h-3.5" />
                                                        <span className="font-mono">
                                                            {typeof rawTrace.latencyMs === "number" && Number.isFinite(rawTrace.latencyMs)
                                                                ? `${rawTrace.latencyMs}ms`
                                                                : "N/A"}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                                        <span className="font-mono text-[10px]">{rawTrace.traceId?.slice(0, 8)}...</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Model</div>
                                                <Badge variant="outline" className="font-mono text-xs bg-slate-100">
                                                    {rawTrace.usage?.model || "unknown-model"}
                                                </Badge>
                                            </div>
                                        </div>

                                        {/* 2. SPAN WATERFALL (Hierarchical) */}
                                        {loadingTraceDetails ? (
                                            <div className="flex justify-center p-8 bg-white border rounded text-muted-foreground">
                                                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                                                Loading full trace...
                                            </div>
                                        ) : traceTree ? (
                                            <Card className="shadow-sm border-slate-200">
                                                <CardHeader className="py-3 px-4 bg-slate-50/50 border-b">
                                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                                        <Layers className="w-4 h-4 text-indigo-500" />
                                                        Execution Trace
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="p-4 space-y-1">
                                                    <TraceNodeRenderer node={traceTree} totalDuration={traceTree.latency || 1} />
                                                </CardContent>
                                            </Card>
                                        ) : null}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* 3. MEMORY PANEL */}
                                            <Card className="shadow-sm border-slate-200 h-full">
                                                <CardHeader className="py-3 px-4 bg-slate-50/50 border-b">
                                                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                                        <Database className="w-4 h-4 text-amber-500" />
                                                        Memory Context
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="p-0">
                                                    <div className="max-h-[250px] overflow-y-auto p-4 space-y-3">
                                                        <div className="space-y-2">
                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Stored Insights</span>
                                                            {insights.filter(i => new Date(i.createdAt) > new Date(rawTrace.createdAt)).length > 0 ? (
                                                                insights.filter(i => new Date(i.createdAt) > new Date(rawTrace.createdAt)).map(i => (
                                                                    <div key={i.id} className="bg-amber-50 border border-amber-100 p-2 rounded text-xs text-amber-900">
                                                                        <div className="font-semibold mb-0.5">{i.category}</div>
                                                                        {i.text}
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="text-xs text-muted-foreground italic">No new insights stored during this trace.</div>
                                                            )}
                                                        </div>

                                                        <div className="space-y-2 pt-2 border-t">
                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Available Context</span>
                                                            {insights.length > 0 ? (
                                                                insights.slice(0, 3).map(i => (
                                                                    <div key={i.id} className="bg-slate-50 border p-2 rounded text-xs text-slate-700">
                                                                        <div className="flex justify-between">
                                                                            <span className="font-semibold capitalize text-slate-900">{i.category}</span>
                                                                            <span className="text-[10px] text-slate-400">{new Date(i.createdAt).toLocaleDateString()}</span>
                                                                        </div>
                                                                        {i.text}
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="text-xs text-muted-foreground italic">No prior insights found.</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            {/* 4. REASONING & OUTPUT */}
                                            <div className="space-y-4">
                                                {/* Reasoning */}
                                                <Card className="shadow-sm border-slate-200">
                                                    <CardHeader className="py-3 px-4 bg-slate-50/50 border-b">
                                                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                                            <Brain className="w-4 h-4 text-purple-500" />
                                                            Reasoning
                                                        </CardTitle>
                                                    </CardHeader>
                                                    <CardContent className="p-4 text-xs space-y-3">
                                                        <div className="bg-purple-50 rounded p-2 text-purple-900 border border-purple-100">
                                                            <span className="font-bold mr-1">Goal:</span>
                                                            {rawTrace.taskTitle}
                                                        </div>
                                                        <div className="text-slate-700 leading-relaxed">
                                                            {rawTrace.thoughtSummary}
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                {leadParserToolCall && (
                                                    <Card className="shadow-sm border-slate-200">
                                                        <CardHeader className="py-3 px-4 bg-slate-50/50 border-b">
                                                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                                                <Activity className="w-4 h-4 text-blue-500" />
                                                                LLM Request/Response
                                                            </CardTitle>
                                                        </CardHeader>
                                                        <CardContent className="p-4 space-y-3">
                                                            <div>
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Request</div>
                                                                <pre className="bg-slate-950 text-slate-50 text-[10px] p-2 rounded overflow-x-auto max-h-[160px] overflow-y-auto font-mono whitespace-pre-wrap">
                                                                    {JSON.stringify(leadParserRequest, null, 2)}
                                                                </pre>
                                                            </div>
                                                            <div>
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Response</div>
                                                                <pre className="bg-slate-950 text-slate-50 text-[10px] p-2 rounded overflow-x-auto max-h-[160px] overflow-y-auto font-mono whitespace-pre-wrap">
                                                                    {JSON.stringify(leadParserResponse, null, 2)}
                                                                </pre>
                                                            </div>
                                                        </CardContent>
                                                    </Card>
                                                )}

                                                {/* Tool Usage Stats */}
                                                <Card className="shadow-sm border-slate-200">
                                                    <CardHeader className="py-3 px-4 bg-slate-50/50 border-b">
                                                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                                            <Wrench className="w-4 h-4 text-slate-500" />
                                                            Performance
                                                        </CardTitle>
                                                    </CardHeader>
                                                    <CardContent className="p-4 grid grid-cols-2 gap-4">
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase">Latency</div>
                                                            <div className="text-sm font-mono">
                                                                {typeof rawTrace.latencyMs === "number" && Number.isFinite(rawTrace.latencyMs)
                                                                    ? `${rawTrace.latencyMs}ms`
                                                                    : "N/A"}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase">Cost</div>
                                                            <div className={cn(
                                                                "text-sm font-mono font-bold",
                                                                typeof rawTrace.usage?.cost === "number" ? "text-green-600" : "text-slate-500"
                                                            )}>
                                                                {typeof rawTrace.usage?.cost === "number"
                                                                    ? `$${rawTrace.usage.cost.toFixed(5)}`
                                                                    : "N/A"}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase">Tokens</div>
                                                            <div className="text-sm font-mono">{rawTrace.usage?.totalTokenCount || 0}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase">Status</div>
                                                            <div className="text-sm font-medium capitalize">{rawTrace.taskStatus}</div>
                                                        </div>
                                                        {transcriptUsage.totalTokens > 0 && (
                                                            <>
                                                                <div>
                                                                    <div className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1">
                                                                        <Mic className="h-3 w-3" /> Transcript Tokens
                                                                    </div>
                                                                    <div className="text-sm font-mono">{transcriptUsage.totalTokens.toLocaleString()}</div>
                                                                    <div className="text-[10px] text-slate-400">{transcriptUsage.transcriptCount} files, {transcriptUsage.extractionCount} extractions</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1">
                                                                        <Mic className="h-3 w-3" /> Transcript Cost
                                                                    </div>
                                                                    <div className="text-sm font-mono font-bold text-amber-600">
                                                                        ${transcriptUsage.totalCost.toFixed(5)}
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            </div>
                                        </div>

                                        {/* Raw JSON (collapsible) */}
                                        <Collapsible>
                                            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                                                <ChevronDown className="h-3 w-3" />
                                                View Raw JSON
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                                <pre className="mt-2 bg-slate-950 text-slate-50 text-[10px] p-3 rounded-lg overflow-x-auto font-mono">
                                                    {JSON.stringify(rawTrace, null, 2)}
                                                </pre>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    </div>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

            </div>
        </div >
    );
}
