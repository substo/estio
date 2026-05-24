import dynamic from "next/dynamic";
import { useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { generateAIDraft, generateMultiContextDraftAction, orchestrateAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Check, Info, Users, Link as LinkIcon, AlertCircle, ExternalLink, X, ListTodo, Play, CheckCircle2, Circle, Brain, ChevronDown, ChevronUp, Expand, History, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { CoordinatorTraceModal } from "./coordinator-trace-modal";
import { useCoordinatorTraceModal } from "./use-coordinator-trace-modal";
import { useCoordinatorTranscriptUsage } from "./use-coordinator-transcript-usage";
import { useCoordinatorAgentPlan } from "./use-coordinator-agent-plan";
import { useCoordinatorContactContext } from "./use-coordinator-contact-context";
import { useCoordinatorDealContext } from "./use-coordinator-deal-context";
import { CoordinatorContactOverviewCard } from "./coordinator-contact-overview-card";
import type { ContactIdentityPatch } from "../../contacts/_components/contact-form";

const ContactTaskManager = dynamic(
    () => import("@/components/tasks/contact-task-manager").then((mod) => mod.ContactTaskManager),
    {
        loading: () => <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />,
    }
);

const ContactViewingManager = dynamic(
    () => import("@/components/tasks/contact-viewing-manager").then((mod) => mod.ContactViewingManager),
    {
        loading: () => <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />,
    }
);

interface CoordinatorPanelProps {
    locationId: string;
    conversation: Conversation;
    selectedConversations?: Conversation[]; // New Prop for Context Mode
    existingDealContextId?: string | null;
    existingDealTitle?: string | null;
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
    onContactMerged?: (targetContactId: string, targetConversationId?: string | null) => void;
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

function getBrowserDraftLanguage() {
    if (typeof window === "undefined") return DEFAULT_REPLY_LANGUAGE;
    return normalizeReplyLanguage(window.navigator.language || "") || DEFAULT_REPLY_LANGUAGE;
}

export function CoordinatorPanel({
    locationId,
    conversation,
    selectedConversations,
    existingDealContextId = null,
    existingDealTitle = null,
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
    onContactSaved,
    onContactMerged
}: CoordinatorPanelProps) {
    const [reasoning, setReasoning] = useState("");
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [thinkingExpanded, setThinkingExpanded] = useState(false);
    const {
        rawTrace,
        setRawTrace,
        traceTree,
        setTraceTree,
        insights,
        traceModalOpen,
        setTraceModalOpen,
        executionHistory,
        loadingHistory,
        loadingTraceDetails,
        handleSelectTrace,
        refreshExecutionHistory,
    } = useCoordinatorTraceModal({
        conversationId: conversation.id,
        contactId: conversation.contactId,
    });

    const {
        contactContext,
        setContactContext,
        loadingContext,
        sidebarTab,
        setSidebarTab,
        loadedSidebarTabs,
        handleContactSaved,
    } = useCoordinatorContactContext({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        initialContactContext,
        lazySidebarDataEnabled,
        onContactSaved,
    });
    const taskOpenCount = Number(initialTaskSummary?.open || 0);
    const upcomingViewingCount = Number(initialViewingSummary?.upcoming || 0);
    const planProgressLabel = initialAgentSummary?.hasPlan
        ? `${Number(initialAgentSummary?.completedPlanSteps || 0)}/${Number(initialAgentSummary?.totalPlanSteps || 0)}`
        : null;

    // Orchestrator State (Phase 1)
    const [orchestrating, setOrchestrating] = useState(false);
    const [orchestrationResult, setOrchestrationResult] = useState<any>(null);

    const transcriptUsage = useCoordinatorTranscriptUsage(conversation.id);

    const {
        goal,
        setGoal,
        plan,
        setPlan,
        planning,
        executing,
        agentActions,
        thoughtSteps,
        handleGeneratePlan,
        handleExecuteNext,
    } = useCoordinatorAgentPlan({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        onSuggestionsGenerated,
        setContactContext,
        setRawTrace,
        setTraceTree,
        setReasoning,
        setError,
    });

    const {
        isContextMode,
        ensureDealContext,
    } = useCoordinatorDealContext({
        selectedConversations,
        existingDealContextId,
        existingDealTitle,
        onDeselect,
    });
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
            refreshExecutionHistory();

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
                const contextId = await ensureDealContext();
                const res = await generateMultiContextDraftAction(contextId!, 'LEAD');
                setReasoning(res.reasoning);
                onSuggestionsGenerated?.([]);
            } else {
                const res = await generateAIDraft(
                    conversation.id,
                    conversation.contactId,
                    undefined,
                    undefined,
                    { mode: "chat", draftLanguage: getBrowserDraftLanguage() }
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
            <CoordinatorContactOverviewCard
                conversationId={conversation.id}
                conversationContactName={conversation.contactName}
                conversationStatus={conversation.status}
                contactContext={contactContext}
                loadingContext={loadingContext}
                hidden={lazySidebarDataEnabled && sidebarTab !== 'overview'}
                onContactSaved={handleContactSaved}
                onContactMerged={onContactMerged}
            />

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

                <CoordinatorTraceModal
                    open={traceModalOpen}
                    onOpenChange={setTraceModalOpen}
                    rawTrace={rawTrace}
                    traceTree={traceTree}
                    insights={insights}
                    executionHistory={executionHistory}
                    loadingHistory={loadingHistory}
                    loadingTraceDetails={loadingTraceDetails}
                    handleSelectTrace={handleSelectTrace}
                    transcriptUsage={transcriptUsage}
                />

            </div>
        </div >
    );
}
