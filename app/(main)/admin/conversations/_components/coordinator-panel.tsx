import dynamic from "next/dynamic";
import { useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { Button } from "@/components/ui/button";
import { Users, ListTodo, History, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CoordinatorTraceModal } from "./coordinator-trace-modal";
import { CoordinatorMissionControl } from "./coordinator-mission-control";
import { useCoordinatorTraceModal } from "./use-coordinator-trace-modal";
import { useCoordinatorTranscriptUsage } from "./use-coordinator-transcript-usage";
import { useCoordinatorAgentPlan } from "./use-coordinator-agent-plan";
import { useCoordinatorContactContext } from "./use-coordinator-contact-context";
import { useCoordinatorDealContext } from "./use-coordinator-deal-context";
import { useCoordinatorQuickActions } from "./use-coordinator-quick-actions";
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
    const {
        generating,
        orchestrating,
        orchestrationResult,
        handleOrchestrate,
        handleGenerateDraftOnly,
    } = useCoordinatorQuickActions({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        isContextMode,
        ensureDealContext,
        onSuggestionsGenerated,
        refreshExecutionHistory,
        setReasoning,
        setError,
    });

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
                <CoordinatorMissionControl
                    goal={goal}
                    setGoal={setGoal}
                    plan={plan}
                    setPlan={setPlan}
                    planning={planning}
                    executing={executing}
                    generating={generating}
                    orchestrating={orchestrating}
                    orchestrationResult={orchestrationResult}
                    agentActions={agentActions}
                    error={error}
                    reasoning={reasoning}
                    thinkingExpanded={thinkingExpanded}
                    setThinkingExpanded={setThinkingExpanded}
                    thoughtSteps={thoughtSteps}
                    rawTrace={rawTrace}
                    setTraceModalOpen={setTraceModalOpen}
                    handleGeneratePlan={handleGeneratePlan}
                    handleExecuteNext={handleExecuteNext}
                    handleOrchestrate={handleOrchestrate}
                    handleGenerateDraftOnly={handleGenerateDraftOnly}
                />

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
