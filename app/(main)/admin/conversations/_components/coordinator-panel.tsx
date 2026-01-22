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
        <div className="h-full bg-slate-50 border-l p-4 overflow-y-auto space-y-4 min-w-0">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <ListTodo className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-bold text-lg">Mission Control</h3>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-500 hover:text-indigo-600"
                    onClick={() => setTraceModalOpen(true)}
                    title="View Execution History"
                >
                    <History className="h-5 w-5" />
                </Button>
            </div>

            {/* Contact Details Card */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                        <CardTitle className="text-sm font-semibold">Details</CardTitle>
                        {contactContext?.contact && (
                            <EditContactDialog
                                contact={contactContext.contact}
                                leadSources={contactContext.leadSources || []}
                            />
                        )}
                    </div>
                </CardHeader>
                <CardContent className="text-sm space-y-3">
                    {contactContext?.contact ? (
                        <>
                            <div className="flex flex-col gap-1">
                                <div className="font-medium text-base text-indigo-700 hover:underline cursor-pointer">
                                    <EditContactDialog
                                        contact={contactContext.contact}
                                        leadSources={contactContext.leadSources || []}
                                        trigger={<span>{contactContext.contact.name || "Unnamed Contact"}</span>}
                                    />
                                </div>
                                <div className="text-gray-500 text-xs flex flex-col gap-1">
                                    {contactContext.contact.email && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-16">Email:</span>
                                            <span className="text-gray-700 select-all">{contactContext.contact.email}</span>
                                        </div>
                                    )}
                                    {contactContext.contact.phone && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-16">Phone:</span>
                                            <span className="text-gray-700 select-all">{contactContext.contact.phone}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-gray-50 p-2 rounded border">
                                    <span className="text-gray-400 block mb-0.5">Status</span>
                                    <span className="font-medium">{contactContext.contact.leadStage || "Unassigned"}</span>
                                </div>
                                <div className="bg-gray-50 p-2 rounded border">
                                    <span className="text-gray-400 block mb-0.5">Type</span>
                                    <span className="font-medium">{contactContext.contact.contactType || "Lead"}</span>
                                </div>
                            </div>

                            {/* Interested Properties */}
                            {contactContext.contact.propertyRoles && contactContext.contact.propertyRoles.length > 0 && (
                                <div className="pt-2 border-t">
                                    <span className="text-xs text-gray-500 font-semibold mb-1 block">Property Interest</span>
                                    <div className="space-y-1">
                                        {contactContext.contact.propertyRoles.map((role: any) => (
                                            <div key={role.id} className="text-xs flex items-center gap-1.5 p-1.5 bg-blue-50 rounded border border-blue-100 text-blue-800">
                                                <Home className="w-3 h-3 text-blue-500" />
                                                <span className="truncate flex-1" title={role.property.title}>
                                                    {role.property.reference || role.property.title}
                                                </span>
                                                <Badge variant="outline" className="text-[9px] h-4 bg-white px-1">
                                                    {role.role}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Viewings (Recent) */}
                            {contactContext.contact.viewings && contactContext.contact.viewings.length > 0 && (
                                <div className="pt-2 border-t text-xs">
                                    <span className="text-gray-500 font-semibold mb-1 block">Recent Viewings</span>
                                    <div className="space-y-1">
                                        {contactContext.contact.viewings.slice(0, 3).map((v: any) => (
                                            <div key={v.id} className="flex justify-between items-center text-gray-600">
                                                <span className="truncate max-w-[120px]">{v.property.title}</span>
                                                <span className="text-gray-400">{new Date(v.date).toLocaleDateString()}</span>
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
                                <span className="text-gray-500">Name:</span>
                                <span>{conversation.contactName}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Status:</span>
                                <span>{conversation.status}</span>
                            </div>
                            {loadingContext && <div className="text-xs text-center text-indigo-500 mt-2">Loading full details...</div>}
                        </div>
                    )}

                    <div className="flex justify-between pt-2 border-t mt-2">
                        <span className="text-gray-500 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Est. AI Cost:
                        </span>
                        <div className="text-right">
                            <div className="font-mono font-bold text-green-700">
                                ${(!conversationUsage.totalCost || conversationUsage.totalCost === 0)
                                    ? '0.00'
                                    : (conversationUsage.totalCost < 0.01
                                        ? conversationUsage.totalCost.toFixed(4)
                                        : conversationUsage.totalCost.toFixed(2))}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">
                                {conversationUsage.totalTokens.toLocaleString()} tokens
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* PLANNER SECTION */}
            <div className="space-y-3">
                {plan.length === 0 ? (
                    <div className="space-y-2 p-3 bg-white border rounded-md shadow-sm">
                        <div className="flex items-center gap-2 mb-1 text-purple-700 font-semibold text-sm">
                            <Sparkles className="w-4 h-4" />
                            Initialize Agent
                        </div>
                        <label className="text-xs text-gray-500">Ultimate Goal</label>
                        <Textarea
                            className="bg-slate-50 min-h-[60px]"
                            value={goal}
                            onChange={e => setGoal(e.target.value)}
                        />
                        <Button
                            onClick={handleGeneratePlan}
                            disabled={planning}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            {planning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Generate Mission Plan
                        </Button>
                        <Button
                            onClick={handleGenerateDraftOnly}
                            disabled={generating}
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-gray-400"
                        >
                            Or just generate a quick reply draft...
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2 bg-white border rounded-md shadow-sm overflow-hidden">
                        <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                            <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Active Mission</span>
                            <Button variant="ghost" size="sm" className="h-4 p-0 text-[10px] text-indigo-400" onClick={() => setPlan([])}>Reset</Button>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto">
                            {plan.map((task) => (
                                <div key={task.id} className={`p-2 border-b last:border-0 flex gap-2 items-start text-sm ${task.status === 'in-progress' ? 'bg-blue-50' : ''}`}>
                                    <div className="mt-0.5">
                                        {task.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                        {task.status === 'pending' && <Circle className="w-4 h-4 text-gray-300" />}
                                        {task.status === 'in-progress' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                                        {task.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                    </div>
                                    <div className="flex-1">
                                        <div className={`font-medium ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</div>
                                        {task.result && <div className="text-xs text-gray-500 mt-1">{task.result}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 bg-gray-50 border-t">
                            <Button
                                onClick={handleExecuteNext}
                                disabled={executing || plan.every(t => t.status === 'done')}
                                className="w-full"
                            >
                                {executing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                        Executing Step...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4 mr-2" />
                                        Execute Next Step
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Agent Actions Summary */}
                {agentActions.length > 0 && (
                    <Alert className="bg-green-50 border-green-200">
                        <Check className="h-4 w-4 text-green-600" />
                        <AlertTitle className="text-green-800 text-sm">Action Report</AlertTitle>
                        <AlertDescription className="text-xs text-green-700 break-all">
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

                {reasoning && (
                    <Collapsible open={thinkingExpanded} onOpenChange={setThinkingExpanded}>
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg overflow-hidden">
                            <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-purple-100/50 transition-colors">
                                <div className="flex items-center gap-2">
                                    <Brain className="h-4 w-4 text-purple-600" />
                                    <span className="text-sm font-medium text-purple-800">AI Reasoning</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-purple-600">{thinkingExpanded ? 'Hide Details' : 'View Details'}</span>
                                    {thinkingExpanded ? <ChevronUp className="h-4 w-4 text-purple-500" /> : <ChevronDown className="h-4 w-4 text-purple-500" />}
                                </div>
                            </CollapsibleTrigger>
                            <div className="px-3 pb-3">
                                <p className="text-xs text-purple-700">{reasoning}</p>
                            </div>
                            <CollapsibleContent>
                                {thoughtSteps.length > 0 && (
                                    <div className="border-t border-purple-200 bg-white/60 p-3 space-y-2">
                                        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Step-by-Step Thinking</div>
                                        {thoughtSteps.map((step) => (
                                            <div key={step.step} className="flex gap-2 text-xs">
                                                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-medium text-[10px]">
                                                    {step.step}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-gray-800 font-medium">{step.description}</div>
                                                    <div className="text-gray-500 mt-0.5">{step.conclusion}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {/* View Full Trace Button */}
                                {rawTrace && (
                                    <div className="border-t border-purple-200 bg-purple-50/50 p-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setTraceModalOpen(true)}
                                            className="w-full text-xs text-purple-700 hover:text-purple-900 hover:bg-purple-100"
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
                            <div className="w-64 border-r bg-gray-50 flex flex-col">
                                <div className="p-4 border-b">
                                    <h3 className="font-semibold text-sm flex items-center gap-2">
                                        <History className="h-4 w-4" />
                                        History
                                    </h3>
                                </div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                    {loadingHistory ? (
                                        <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
                                    ) : executionHistory.length === 0 ? (
                                        <div className="text-xs text-gray-400 text-center p-4">No history yet</div>
                                    ) : (
                                        executionHistory.map((ex) => (
                                            <div
                                                key={ex.id}
                                                onClick={() => setRawTrace(ex)}
                                                className={`p-3 rounded-md text-xs cursor-pointer transition-colors border ${rawTrace?.id === ex.id || (!rawTrace?.id && rawTrace?.timestamp === ex.createdAt)
                                                    ? 'bg-purple-100 border-purple-300 text-purple-900'
                                                    : 'bg-white border-gray-100 hover:border-purple-200 hover:bg-white'
                                                    }`}
                                            >
                                                <div className="font-medium truncate">{ex.taskTitle || "Unknown Task"}</div>
                                                <div className="flex items-center justify-between mt-1 text-gray-500">
                                                    <span>{new Date(ex.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    <Badge variant="outline" className="text-[10px] h-4">{ex.taskStatus}</Badge>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Main Content */}
                            <div className="flex-1 flex flex-col max-h-[85vh] overflow-hidden">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <Brain className="h-5 w-5 text-purple-600" />
                                        Full AI Thinking Trace
                                    </DialogTitle>
                                    <DialogDescription>
                                        Complete reasoning flow from the AI agent execution
                                    </DialogDescription>
                                </DialogHeader>

                                {rawTrace && (
                                    <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                                        {/* Timestamp */}
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <Clock className="h-3 w-3" />
                                            <span>{new Date(rawTrace.timestamp || rawTrace.createdAt).toLocaleString()}</span>
                                        </div>

                                        {/* Task */}
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <div className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">Task Executed</div>
                                            <div className="text-sm text-blue-900 font-medium">{rawTrace.task?.title || rawTrace.taskTitle}</div>
                                            <Badge variant="outline" className="mt-1 text-[10px]">{rawTrace.task?.status || rawTrace.taskStatus}</Badge>
                                        </div>

                                        {/* Thought Summary */}
                                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                                            <div className="text-xs font-semibold text-purple-800 uppercase tracking-wider mb-1">Summary</div>
                                            <div className="text-sm text-purple-900">{rawTrace.thoughtSummary}</div>
                                        </div>

                                        {/* Detailed Steps */}
                                        {rawTrace.thoughtSteps?.length > 0 && (
                                            <div className="bg-white border border-gray-200 rounded-lg p-3">
                                                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Reasoning Steps</div>
                                                <div className="space-y-3">
                                                    {rawTrace.thoughtSteps.map((step: ThoughtStep) => (
                                                        <div key={step.step} className="flex gap-3 text-sm">
                                                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-white flex items-center justify-center font-bold text-xs">
                                                                {step.step}
                                                            </div>
                                                            <div className="flex-1 pt-0.5">
                                                                <div className="text-gray-900 font-medium">{step.description}</div>
                                                                <div className="text-gray-600 mt-1 text-xs bg-gray-50 p-2 rounded border-l-2 border-purple-300">{step.conclusion}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tool Calls */}
                                        {rawTrace.toolCalls?.length > 0 && (
                                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                                <div className="flex items-center gap-1 text-xs font-semibold text-green-800 uppercase tracking-wider mb-2">
                                                    <Wrench className="h-3 w-3" />
                                                    Tool Executions
                                                </div>
                                                <div className="space-y-2">
                                                    {rawTrace.toolCalls.map((action: any, i: number) => (
                                                        <div key={i} className="bg-white rounded border border-green-100 p-2">
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="secondary" className="text-[10px] font-mono">{action.tool}</Badge>
                                                                {action.error ? (
                                                                    <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                                                                ) : (
                                                                    <Badge className="text-[10px] bg-green-100 text-green-800">Success</Badge>
                                                                )}
                                                            </div>
                                                            <pre className="text-[10px] text-gray-600 mt-1 font-mono overflow-x-auto whitespace-pre-wrap">
                                                                {JSON.stringify(action.result || action.error, null, 2)}
                                                            </pre>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Draft Reply */}
                                        {rawTrace.draftReply && (
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">Generated Draft</div>
                                                <div className="text-sm text-amber-900 whitespace-pre-wrap">{rawTrace.draftReply}</div>
                                            </div>
                                        )}

                                        {/* Token Usage Stats */}
                                        {(rawTrace.promptTokens || rawTrace.usage?.promptTokenCount) && (
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Prompt Tokens</div>
                                                    <div className="text-sm font-mono text-slate-700">{rawTrace.promptTokens || rawTrace.usage?.promptTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Completion Tokens</div>
                                                    <div className="text-sm font-mono text-slate-700">{rawTrace.completionTokens || rawTrace.usage?.candidatesTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total Tokens</div>
                                                    <div className="text-sm font-mono text-slate-900 font-bold">{rawTrace.totalTokens || rawTrace.usage?.totalTokenCount}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Estimated Cost</div>
                                                    <div className="text-sm font-mono text-green-700 font-bold">
                                                        {rawTrace.cost ? `$${rawTrace.cost.toFixed(5)}` : (rawTrace.usage?.cost ? `$${rawTrace.usage.cost.toFixed(5)}` : '-')}
                                                    </div>
                                                </div>
                                                {(rawTrace.model || rawTrace.usage?.model) && (
                                                    <div className="col-span-2 border-t pt-2 mt-1">
                                                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Model</div>
                                                        <div className="text-xs font-mono text-slate-600">{rawTrace.model || rawTrace.usage?.model}</div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Raw JSON (collapsible) */}
                                        <Collapsible>
                                            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700">
                                                <ChevronDown className="h-3 w-3" />
                                                View Raw JSON
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                                <pre className="mt-2 bg-gray-900 text-gray-100 text-[10px] p-3 rounded-lg overflow-x-auto font-mono">
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
                    <div className="space-y-2 p-3 bg-white border rounded-md shadow-sm animate-in fade-in slide-in-from-bottom-2">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Draft Reply</label>
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="min-h-[120px] text-sm"
                        />
                        <Button onClick={handleApprove} className="w-full" variant="outline">
                            <Check className="mr-2 h-4 w-4 text-green-600" />
                            Approve & Send
                        </Button>
                    </div>
                )}
            </div>
        </div >
    );
}
