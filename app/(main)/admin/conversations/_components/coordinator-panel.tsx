import { useState, useEffect } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { generateAIDraft, generateMultiContextDraftAction, getContactContext, generatePlanAction, executeNextTaskAction, getAgentPlan, getAgentExecutions } from "../actions";
import { createPersistentDeal, findExistingDeal, removeConversationFromDeal } from "../../deals/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Check, Info, Layers, Users, Home, Link as LinkIcon, AlertCircle, ExternalLink, X, ListTodo, Play, CheckCircle2, Circle, Brain, ChevronDown, ChevronUp, Expand, Clock, Wrench, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CONTACT_TYPE_CONFIG, ContactType, DEFAULT_CONTACT_TYPE } from "../../contacts/_components/contact-types";
import { EditContactDialog } from "../../contacts/_components/edit-contact-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GroupMembersList } from './group-members-list';

interface CoordinatorPanelProps {
    conversation: Conversation;
    selectedConversations?: Conversation[]; // New Prop for Context Mode
    onDraftApproved: (text: string) => void;
    onDeselect?: (id: string) => void;
    onSuggestionsGenerated?: (suggestions: string[]) => void;
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

export function CoordinatorPanel({ conversation, selectedConversations, onDraftApproved, onDeselect, onSuggestionsGenerated }: CoordinatorPanelProps) {
    const [draft, setDraft] = useState("");
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
    const [traceModalOpen, setTraceModalOpen] = useState(false);
    const [executionHistory, setExecutionHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Context Builder State
    const [dealTitle, setDealTitle] = useState("");
    const [dealContextId, setDealContextId] = useState<string | null>(null);

    // Context Display State
    const [contactContext, setContactContext] = useState<any>(null);
    const [loadingContext, setLoadingContext] = useState(false);

    // Usage Stats State
    const [conversationUsage, setConversationUsage] = useState({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCost: 0
    });

    const isContextMode = selectedConversations && selectedConversations.length > 0;

    // Fetch Plan on Load
    useEffect(() => {
        if (conversation.id) {
            getAgentPlan(conversation.id).then((res: any) => {
                if (res) {
                    if (res.plan) setPlan(res.plan);
                    if (res.usage) setConversationUsage(res.usage);
                    // Handle legacy return where res IS the plan array (if any stale cache/code)
                    if (Array.isArray(res)) setPlan(res);
                }
            });
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
                    setRawTrace(history[0]);
                } else if (rawTrace && history.length > 0) {
                    // Ensure rawTrace is fully populated if it was set from local execution
                    // (sometimes local trace might miss DB fields like ID if we just passed result object)
                    // But local trace is usually fresher.
                }
                setLoadingHistory(false);
            });
        }
    }, [traceModalOpen, conversation.id]);

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

        setLoadingContext(true);
        getContactContext(conversation.contactId)
            .then(data => setContactContext(data))
            .catch(err => console.error("Failed to load context", err))
            .finally(() => setLoadingContext(false));
    }, [conversation.contactId]);

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
                setDraft(res.draft);
                setReasoning(res.reasoning);
            } else {
                const res = await generateAIDraft(conversation.id, conversation.contactId);
                setDraft(res.draft);
                setReasoning(res.reasoning);
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

                setDraft(res.draft || "");
                setReasoning(res.thoughtSummary || "Task executed.");
                setThoughtSteps(res.thoughtSteps || []);
                setAgentActions(res.actions || []);

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

    const handleApprove = () => {
        if (!draft) return;
        onDraftApproved(draft);
        setDraft(""); // Clear after sending
        setReasoning("");
    };

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

    return (
        <div className="h-full bg-muted/30 border-l p-3 overflow-y-auto space-y-3 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
                <div className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm text-foreground">Mission Control</h3>
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

            {/* Contact Details / Group Members Card */}
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

                                {/* Interested Properties */}
                                {contactContext.contact.propertyRoles && contactContext.contact.propertyRoles.length > 0 && (
                                    <div className="pt-1.5 border-t">
                                        <span className="text-[10px] text-muted-foreground font-medium mb-1 block">Property Interest</span>
                                        <div className="space-y-1">
                                            {contactContext.contact.propertyRoles.map((role: any) => (
                                                <div key={role.id} className="text-[11px] flex items-center gap-1.5 p-1 bg-blue-50/50 rounded border border-blue-100/50 text-foreground">
                                                    <Home className="w-3 h-3 text-blue-500" />
                                                    <span className="truncate flex-1" title={role.property.title}>
                                                        {role.property.reference || role.property.title}
                                                    </span>
                                                    <Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal bg-background">
                                                        {role.role}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Viewings (Recent) */}
                                {contactContext.contact.viewings && contactContext.contact.viewings.length > 0 && (
                                    <div className="pt-1.5 border-t text-[11px]">
                                        <span className="text-muted-foreground font-medium mb-1 block">Recent Viewings</span>
                                        <div className="space-y-1">
                                            {contactContext.contact.viewings.slice(0, 3).map((v: any) => (
                                                <div key={v.id} className="flex justify-between items-center text-foreground/80">
                                                    <span className="truncate max-w-[120px]">{v.property.title}</span>
                                                    <span className="text-muted-foreground text-[10px]">{new Date(v.date).toLocaleDateString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
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


            {/* PLANNER SECTION */}
            <div className="flex-1 min-h-0 flex flex-col space-y-3">
                {plan.length === 0 ? (
                    <div className="space-y-2 p-3 bg-card border rounded-md shadow-sm">
                        <div className="flex items-center gap-2 mb-1 text-purple-600 font-semibold text-sm">
                            <Sparkles className="w-4 h-4" />
                            Initialize Agent
                        </div>
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
                        <Button
                            onClick={handleGenerateDraftOnly}
                            disabled={generating}
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-muted-foreground h-7"
                        >
                            Or just generate a quick reply draft...
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
                                                onClick={() => setRawTrace(ex)}
                                                className={cn(
                                                    "p-3 rounded-md text-xs cursor-pointer transition-colors border",
                                                    rawTrace?.id === ex.id || (!rawTrace?.id && rawTrace?.timestamp === ex.createdAt)
                                                        ? 'bg-purple-100/50 border-purple-200 text-purple-900'
                                                        : 'bg-card border-border hover:border-purple-200 hover:bg-muted/50'
                                                )}
                                            >
                                                <div className="font-medium truncate">{ex.taskTitle || "Unknown Task"}</div>
                                                <div className="flex items-center justify-between mt-1 text-muted-foreground">
                                                    <span>{new Date(ex.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    <Badge variant="secondary" className="text-[9px] h-4 font-normal">{ex.taskStatus}</Badge>
                                                </div>
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
                                    <div className="flex-1 overflow-y-auto space-y-4 p-6">
                                        {/* Timestamp */}
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            <span>{new Date(rawTrace.timestamp || rawTrace.createdAt).toLocaleString()}</span>
                                        </div>

                                        {/* Task */}
                                        <div className="bg-blue-50/50 border border-blue-200/60 rounded-lg p-3">
                                            <div className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">Task Executed</div>
                                            <div className="text-sm text-blue-900 font-medium">{rawTrace.task?.title || rawTrace.taskTitle}</div>
                                            <Badge variant="secondary" className="mt-1 text-[10px] bg-white text-blue-800 border-blue-100">{rawTrace.task?.status || rawTrace.taskStatus}</Badge>
                                        </div>

                                        {/* Thought Summary */}
                                        <div className="bg-purple-50/50 border border-purple-200/60 rounded-lg p-3">
                                            <div className="text-xs font-semibold text-purple-800 uppercase tracking-wider mb-1">Summary</div>
                                            <div className="text-sm text-purple-900">{rawTrace.thoughtSummary}</div>
                                        </div>

                                        {/* Detailed Steps */}
                                        {rawTrace.thoughtSteps?.length > 0 && (
                                            <div className="bg-card border border-border rounded-lg p-3">
                                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Reasoning Steps</div>
                                                <div className="space-y-3">
                                                    {rawTrace.thoughtSteps.map((step: ThoughtStep) => (
                                                        <div key={step.step} className="flex gap-3 text-sm">
                                                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center font-bold text-xs mt-0.5 shadow-sm">
                                                                {step.step}
                                                            </div>
                                                            <div className="flex-1 pt-0.5">
                                                                <div className="text-foreground font-medium">{step.description}</div>
                                                                <div className="text-muted-foreground mt-1 text-xs bg-muted/50 p-2 rounded border-l-2 border-purple-300">{step.conclusion}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tool Calls */}
                                        {rawTrace.toolCalls?.length > 0 && (
                                            <div className="bg-green-50/50 border border-green-200/60 rounded-lg p-3">
                                                <div className="flex items-center gap-1 text-xs font-semibold text-green-800 uppercase tracking-wider mb-2">
                                                    <Wrench className="h-3 w-3" />
                                                    Tool Executions
                                                </div>
                                                <div className="space-y-2">
                                                    {rawTrace.toolCalls.map((action: any, i: number) => (
                                                        <div key={i} className="bg-card rounded border border-green-100/50 p-2">
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="secondary" className="text-[10px] font-mono bg-green-100/50 text-green-800">{action.tool}</Badge>
                                                                {action.error ? (
                                                                    <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                                                                ) : (
                                                                    <Badge className="text-[10px] bg-green-100 text-green-800 hover:bg-green-200">Success</Badge>
                                                                )}
                                                            </div>
                                                            <pre className="text-[10px] text-muted-foreground mt-1 font-mono overflow-x-auto whitespace-pre-wrap">
                                                                {JSON.stringify(action.result || action.error, null, 2)}
                                                            </pre>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Draft Reply */}
                                        {rawTrace.draftReply && (
                                            <div className="bg-amber-50/50 border border-amber-200/60 rounded-lg p-3">
                                                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">Generated Draft</div>
                                                <div className="text-sm text-amber-900 whitespace-pre-wrap">{rawTrace.draftReply}</div>
                                            </div>
                                        )}

                                        {/* Token Usage Stats */}
                                        {(rawTrace.promptTokens || rawTrace.usage?.promptTokenCount) && (
                                            <div className="bg-muted/30 border border-border rounded-lg p-3 grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Prompt Tokens</div>
                                                    <div className="text-sm font-mono text-foreground">{rawTrace.promptTokens || rawTrace.usage?.promptTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Completion Tokens</div>
                                                    <div className="text-sm font-mono text-foreground">{rawTrace.completionTokens || rawTrace.usage?.candidatesTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Tokens</div>
                                                    <div className="text-sm font-mono text-foreground font-bold">{rawTrace.totalTokens || rawTrace.usage?.totalTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Estimated Cost</div>
                                                    <div className="text-sm font-mono text-green-700 font-bold">
                                                        {rawTrace.cost ? `$${rawTrace.cost.toFixed(5)}` : (rawTrace.usage?.cost ? `$${rawTrace.usage.cost.toFixed(5)}` : '-')}
                                                    </div>
                                                </div>
                                                {(rawTrace.model || rawTrace.usage?.model) && (
                                                    <div className="col-span-2 border-t pt-2 mt-1">
                                                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Model</div>
                                                        <div className="text-xs font-mono text-muted-foreground">{rawTrace.model || rawTrace.usage?.model}</div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

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

                {draft && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 pt-2">
                        <div className="rounded-xl border bg-card shadow-sm overflow-hidden ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 transition-all">
                            <Textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="Review and edit the AI draft..."
                                className="min-h-[100px] border-0 focus-visible:ring-0 resize-none text-sm p-3 block w-full bg-transparent placeholder:text-muted-foreground/50"
                            />
                            {/* Inline Toolbar */}
                            <div className="flex items-center justify-between px-2 pb-2 pt-0">
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 pl-1">
                                    <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-purple-500" /> AI Draft</span>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setDraft("")}
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    >
                                        Discard
                                    </Button>
                                    <Button
                                        onClick={handleApprove}
                                        size="sm"
                                        className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90 shadow-none"
                                    >
                                        <Check className="mr-1.5 h-3.5 w-3.5" />
                                        Approve
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
