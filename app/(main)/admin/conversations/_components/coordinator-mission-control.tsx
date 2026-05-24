import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Check, AlertCircle, Play, CheckCircle2, Circle, Brain, ChevronDown, ChevronUp, Expand, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { AgentTask, ThoughtStep } from "./use-coordinator-agent-plan";

interface CoordinatorMissionControlProps {
    goal: string;
    setGoal: (value: string) => void;
    plan: AgentTask[];
    setPlan: (value: AgentTask[]) => void;
    planning: boolean;
    executing: boolean;
    generating: boolean;
    orchestrating: boolean;
    orchestrationResult: any;
    agentActions: any[];
    error: string | null;
    reasoning: string;
    thinkingExpanded: boolean;
    setThinkingExpanded: (value: boolean) => void;
    thoughtSteps: ThoughtStep[];
    rawTrace: any;
    setTraceModalOpen: (value: boolean) => void;
    handleGeneratePlan: () => void;
    handleExecuteNext: () => void;
    handleOrchestrate: () => void;
    handleGenerateDraftOnly: () => void;
}

export function CoordinatorMissionControl({
    goal,
    setGoal,
    plan,
    setPlan,
    planning,
    executing,
    generating,
    orchestrating,
    orchestrationResult,
    agentActions,
    error,
    reasoning,
    thinkingExpanded,
    setThinkingExpanded,
    thoughtSteps,
    rawTrace,
    setTraceModalOpen,
    handleGeneratePlan,
    handleExecuteNext,
    handleOrchestrate,
    handleGenerateDraftOnly,
}: CoordinatorMissionControlProps) {
    return (
        <>
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
        </>
    );
}
