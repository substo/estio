import { Activity, Brain, CheckCircle, ChevronDown, Clock, Database, History, Layers, Loader2, Mic, Wrench, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    hasMoreHistory: boolean;
    loadingHistory: boolean;
    loadingMoreHistory: boolean;
    loadingTraceDetails: boolean;
    handleSelectTrace: (trace: any) => void;
    loadTraceDetails: () => void;
    loadMoreExecutionHistory: () => void;
    transcriptUsage: {
        totalTokens: number;
        transcriptCount: number;
        extractionCount: number;
        totalCost: number;
    };
}

function stringifyTracePayload(value: any) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
}

export function CoordinatorTraceModal({
    open,
    onOpenChange,
    rawTrace,
    traceTree,
    insights,
    executionHistory,
    hasMoreHistory,
    loadingHistory,
    loadingMoreHistory,
    loadingTraceDetails,
    handleSelectTrace,
    loadTraceDetails,
    loadMoreExecutionHistory,
    transcriptUsage,
}: CoordinatorTraceModalProps) {
    const traceToolCalls = Array.isArray(rawTrace?.toolCalls) ? rawTrace.toolCalls : [];
    const llmToolCall = traceToolCalls.find((call: any) =>
        ["gemini.generateContent", "openai.responses.create", "codex.exec"].includes(String(call?.tool || ""))
    ) || traceToolCalls[0] || null;
    const promptPreview = stringifyTracePayload(llmToolCall?.arguments) || rawTrace?.preview?.request || "";
    const responsePreview = stringifyTracePayload(llmToolCall?.result || rawTrace?.draftReply) || rawTrace?.preview?.response || "";
    const hasPromptResponsePreview = Boolean(promptPreview || responsePreview);
    const detailsLoaded = traceToolCalls.length > 0 || Boolean(traceTree) || insights.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="h-[96dvh] max-h-[96dvh] w-[calc(100vw-1rem)] max-w-6xl overflow-hidden p-0 sm:h-[90vh] sm:max-h-[90vh]">
                <div className="flex h-full min-h-0 flex-col sm:flex-row">
                    <div className="flex max-h-[34dvh] min-h-0 flex-col border-b bg-muted/30 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
                        <div className="shrink-0 border-b p-3 sm:p-4">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <History className="h-4 w-4" />
                                History
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {loadingHistory ? (
                                <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                            ) : executionHistory.length === 0 ? (
                                <div className="p-4 text-center text-xs text-muted-foreground">No history yet</div>
                            ) : (
                                <div className="grid grid-flow-col auto-cols-[minmax(180px,1fr)] gap-2 overflow-x-auto sm:block sm:space-y-2 sm:overflow-x-visible">
                                    {executionHistory.map((execution) => (
                                        <button
                                            type="button"
                                            key={execution.id}
                                            onClick={() => handleSelectTrace(execution)}
                                            className={cn(
                                                "relative min-w-0 rounded-md border p-3 text-left text-xs transition-colors",
                                                rawTrace?.id === execution.id
                                                    ? "border-purple-200 bg-purple-100/50 text-purple-900 ring-1 ring-purple-200"
                                                    : "border-border bg-card hover:border-purple-200 hover:bg-muted/50"
                                            )}
                                        >
                                            <div className="truncate pr-4 font-medium">{execution.taskTitle || "Unknown Task"}</div>
                                            <div className="mt-1 flex items-center justify-between text-muted-foreground">
                                                <span>{new Date(execution.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                <div className="flex gap-1">
                                                    {execution.taskStatus === "success" && <CheckCircle className="h-3 w-3 text-green-500" />}
                                                    {execution.taskStatus === "error" && <XCircle className="h-3 w-3 text-red-500" />}
                                                    {execution.taskStatus === "pending" && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                                                </div>
                                            </div>
                                            {typeof execution.usage?.cost === "number" && (
                                                <div className="mt-0.5 font-mono text-[10px] text-green-600/80">
                                                    ${execution.usage.cost.toFixed(5)}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                    {hasMoreHistory && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-full min-h-16 text-xs sm:w-full"
                                            onClick={loadMoreExecutionHistory}
                                            disabled={loadingMoreHistory}
                                        >
                                            {loadingMoreHistory && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                            Load more
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
                        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
                            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                                <Brain className="h-5 w-5 text-purple-600" />
                                AI Usage Trace
                            </DialogTitle>
                            <DialogDescription>Prompt, response, tokens, cost, and execution trace</DialogDescription>
                        </DialogHeader>

                        {rawTrace && (
                            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4 sm:p-6">
                                <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                            <h2 className="min-w-0 break-words text-base font-bold text-slate-800 sm:text-lg">{rawTrace.taskTitle || "Unnamed Task"}</h2>
                                            {rawTrace.taskStatus === "success" && <Badge className="border-green-200 bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle className="mr-1 h-3 w-3" /> Success</Badge>}
                                            {rawTrace.taskStatus === "error" && <Badge className="border-red-200 bg-red-100 text-red-800 hover:bg-red-100"><XCircle className="mr-1 h-3 w-3" /> Failed</Badge>}
                                            {rawTrace.taskStatus === "pending" && <Badge className="border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-100"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Pending</Badge>}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5" />
                                                <span className="font-mono">{new Date(rawTrace.createdAt).toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Activity className="h-3.5 w-3.5" />
                                                <span className="font-mono">{typeof rawTrace.latencyMs === "number" ? `${rawTrace.latencyMs}ms` : "N/A"}</span>
                                            </div>
                                            <span className="min-w-0 truncate font-mono text-[10px]">{rawTrace.traceId || "No trace ID"}</span>
                                        </div>
                                    </div>
                                    <div className="min-w-0 sm:text-right">
                                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Model</div>
                                        <Badge variant="outline" className="max-w-full truncate bg-slate-100 font-mono text-xs">
                                            {rawTrace.usage?.model || "unknown-model"}
                                        </Badge>
                                    </div>
                                </div>

                                {hasPromptResponsePreview && (
                                    <Card className="border-slate-200 shadow-sm">
                                        <CardHeader className="border-b bg-slate-50/50 px-4 py-3">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                                    <Activity className="h-4 w-4 text-blue-500" />
                                                    Prompt & Response
                                                </CardTitle>
                                                {rawTrace?.preview?.truncated && (
                                                    <Badge variant="outline" className="w-fit text-[10px]">Preview capped</Badge>
                                                )}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
                                            <div className="min-w-0">
                                                <div className="mb-1 text-[10px] font-bold uppercase text-slate-400">Request</div>
                                                <pre className="max-h-[42dvh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-50 sm:max-h-[360px]">
                                                    {promptPreview}
                                                </pre>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="mb-1 text-[10px] font-bold uppercase text-slate-400">Response</div>
                                                <pre className="max-h-[42dvh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-50 sm:max-h-[360px]">
                                                    {responsePreview}
                                                </pre>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                <div className="flex flex-col gap-2 rounded border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs text-muted-foreground">
                                        Full trace tree, raw tool calls, and memory context are loaded only when needed.
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-full sm:w-auto"
                                        onClick={loadTraceDetails}
                                        disabled={loadingTraceDetails || detailsLoaded}
                                    >
                                        {loadingTraceDetails && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        {detailsLoaded ? "Full trace loaded" : "Load full trace"}
                                    </Button>
                                </div>

                                {loadingTraceDetails && (
                                    <div className="flex justify-center rounded border bg-white p-4 text-muted-foreground">
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Loading full trace...
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <UsageStat label="Tokens" value={(rawTrace.usage?.totalTokenCount || 0).toLocaleString()} />
                                    <UsageStat label="Input" value={(rawTrace.usage?.promptTokenCount || 0).toLocaleString()} />
                                    <UsageStat label="Output" value={(rawTrace.usage?.candidatesTokenCount || 0).toLocaleString()} />
                                    <UsageStat label="Cost" value={`$${Number(rawTrace.usage?.cost || 0).toFixed(5)}`} valueClassName="text-green-600" />
                                </div>

                                {!loadingTraceDetails && traceTree && (
                                    <Card className="border-slate-200 shadow-sm">
                                        <CardHeader className="border-b bg-slate-50/50 px-4 py-3">
                                            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                                <Layers className="h-4 w-4 text-indigo-500" />
                                                Execution Trace
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-1 overflow-x-auto p-4">
                                            <TraceNodeRenderer node={traceTree} totalDuration={traceTree.latency || 1} />
                                        </CardContent>
                                    </Card>
                                )}

                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <Card className="h-full border-slate-200 shadow-sm">
                                        <CardHeader className="border-b bg-slate-50/50 px-4 py-3">
                                            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                                <Database className="h-4 w-4 text-amber-500" />
                                                Memory Context
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="max-h-[250px] space-y-3 overflow-y-auto p-4">
                                            {insights.length > 0 ? (
                                                insights.slice(0, 5).map((insight) => (
                                                    <div key={insight.id} className="rounded border bg-slate-50 p-2 text-xs text-slate-700">
                                                        <div className="flex justify-between gap-2">
                                                            <span className="font-semibold capitalize text-slate-900">{insight.category}</span>
                                                            <span className="shrink-0 text-[10px] text-slate-400">{new Date(insight.createdAt).toLocaleDateString()}</span>
                                                        </div>
                                                        {insight.text}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-xs italic text-muted-foreground">No contact insights found.</div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    <div className="space-y-4">
                                        <Card className="border-slate-200 shadow-sm">
                                            <CardHeader className="border-b bg-slate-50/50 px-4 py-3">
                                                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                                    <Brain className="h-4 w-4 text-purple-500" />
                                                    Reasoning
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-3 p-4 text-xs">
                                                <div className="rounded border border-purple-100 bg-purple-50 p-2 text-purple-900">
                                                    <span className="mr-1 font-bold">Goal:</span>
                                                    {rawTrace.taskTitle}
                                                </div>
                                                <div className="leading-relaxed text-slate-700">{rawTrace.thoughtSummary || "No reasoning summary recorded."}</div>
                                            </CardContent>
                                        </Card>

                                        <Card className="border-slate-200 shadow-sm">
                                            <CardHeader className="border-b bg-slate-50/50 px-4 py-3">
                                                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                                    <Wrench className="h-4 w-4 text-slate-500" />
                                                    Performance
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="grid grid-cols-2 gap-4 p-4">
                                                <UsageStat label="Latency" value={typeof rawTrace.latencyMs === "number" ? `${rawTrace.latencyMs}ms` : "N/A"} />
                                                <UsageStat label="Status" value={rawTrace.taskStatus || "unknown"} valueClassName="capitalize" />
                                                {transcriptUsage.totalTokens > 0 && (
                                                    <>
                                                        <UsageStat
                                                            label="Transcript Tokens"
                                                            value={transcriptUsage.totalTokens.toLocaleString()}
                                                            description={`${transcriptUsage.transcriptCount} files, ${transcriptUsage.extractionCount} extractions`}
                                                            icon={<Mic className="h-3 w-3" />}
                                                        />
                                                        <UsageStat
                                                            label="Transcript Cost"
                                                            value={`$${transcriptUsage.totalCost.toFixed(5)}`}
                                                            valueClassName="text-amber-600"
                                                            icon={<Mic className="h-3 w-3" />}
                                                        />
                                                    </>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>

                                <Collapsible>
                                    <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                                        <ChevronDown className="h-3 w-3" />
                                        View Raw JSON
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] text-slate-50">
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

function UsageStat({
    label,
    value,
    description,
    valueClassName,
    icon,
}: {
    label: string;
    value: string;
    description?: string;
    valueClassName?: string;
    icon?: ReactNode;
}) {
    return (
        <div className="rounded border bg-white p-3">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                {icon}
                {label}
            </div>
            <div className={cn("font-mono text-sm font-semibold", valueClassName)}>{value}</div>
            {description && <div className="text-[10px] text-slate-400">{description}</div>}
        </div>
    );
}
