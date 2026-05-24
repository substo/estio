import { Activity, Brain, CheckCircle, ChevronDown, Clock, Database, History, Layers, Loader2, Mic, Wrench, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TraceNodeRenderer } from "./trace-node-renderer";

interface CoordinatorTraceModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rawTrace: any;
    traceTree: any;
    insights: any[];
    executionHistory: any[];
    loadingHistory: boolean;
    loadingTraceDetails: boolean;
    handleSelectTrace: (trace: any) => void;
    transcriptUsage: {
        totalTokens: number;
        transcriptCount: number;
        extractionCount: number;
        totalCost: number;
    };
}

export function CoordinatorTraceModal({
    open,
    onOpenChange,
    rawTrace,
    traceTree,
    insights,
    executionHistory,
    loadingHistory,
    loadingTraceDetails,
    handleSelectTrace,
    transcriptUsage,
}: CoordinatorTraceModalProps) {
    const traceToolCalls = Array.isArray(rawTrace?.toolCalls) ? rawTrace.toolCalls : [];
    const leadParserToolCall = traceToolCalls.find((c: any) => c?.tool === "gemini.generateContent") || null;
    const leadParserRequest = leadParserToolCall?.arguments || null;
    const leadParserResponse = leadParserToolCall?.result || null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
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
    );
}
