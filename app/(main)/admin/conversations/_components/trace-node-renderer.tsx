
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown, Clock, Activity, CheckCircle, XCircle, AlertCircle, Wrench, Brain, ListTodo } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TraceNode {
    spanId: string;
    name: string;
    type: string;
    status: string;
    latency: number;
    startTime: string | Date; // wire format might be string
    metadata: any;
    children: TraceNode[];
}

interface TraceNodeRendererProps {
    node: TraceNode;
    totalDuration: number;
    depth?: number;
    startTime?: number; // relative start time
    rootStartTime?: number;
}

export function TraceNodeRenderer({ node, totalDuration, depth = 0, startTime = 0, rootStartTime }: TraceNodeRendererProps) {
    const [expanded, setExpanded] = useState(true);

    const nodeStart = new Date(node.startTime).getTime();
    if (!rootStartTime) rootStartTime = nodeStart;

    // Relative start time in ms from root
    const relativeStart = nodeStart - rootStartTime;

    // Calculate width percentage (min 1%)
    const widthPercent = Math.max(1, (node.latency / totalDuration) * 100);
    // Calculate left offset percentage
    const leftPercent = (relativeStart / totalDuration) * 100;

    const hasChildren = node.children && node.children.length > 0;

    // Icon based on type
    const getIcon = () => {
        switch (node.type) {
            case 'tool': return <Wrench className="w-3 h-3 text-blue-500" />;
            case 'thought': return <Brain className="w-3 h-3 text-purple-500" />;
            case 'planning': return <ListTodo className="w-3 h-3 text-amber-500" />;
            default: return <Activity className="w-3 h-3 text-slate-500" />;
        }
    };

    return (
        <div className="text-xs relative">
            <div className={cn(
                "flex items-center gap-2 p-1.5 hover:bg-slate-100/80 rounded group transition-colors",
                depth === 0 ? "font-semibold bg-slate-50 border-b border-slate-100" : ""
            )}>
                {/* Tree Toggles */}
                <div style={{ paddingLeft: `${depth * 16}px` }} className="flex items-center">
                    {hasChildren ? (
                        <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-slate-200 rounded">
                            {expanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                        </button>
                    ) : (
                        <div className="w-4" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 truncate cursor-default">
                                    {getIcon()}
                                    <span className="truncate">{node.name}</span>
                                    {node.status === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs max-w-xs break-all">
                                <div className="font-semibold mb-1 border-b pb-1">{node.name}</div>
                                {node.type === 'tool' && node.metadata?.toolCalls && (
                                    <div className="text-[10px] font-mono whitespace-pre-wrap">
                                        {JSON.stringify(node.metadata.toolCalls, null, 2)}
                                    </div>
                                )}
                                {node.metadata?.error && (
                                    <div className="text-red-400 font-mono mt-1">{node.metadata.error}</div>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                {/* Duration Label */}
                <div className="w-16 text-right font-mono text-[10px] text-muted-foreground mr-2">
                    {node.latency}ms
                </div>

                {/* Timeline Bar */}
                <div className="w-32 h-6 md:w-48 bg-slate-100 rounded-sm relative overflow-hidden hidden sm:block">
                    <div
                        className={cn(
                            "absolute top-1 bottom-1 rounded-sm opacity-80",
                            node.status === 'error' ? 'bg-red-400' :
                                node.type === 'tool' ? 'bg-blue-300' :
                                    node.type === 'thought' ? 'bg-purple-300' :
                                        'bg-slate-300'
                        )}
                        style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`
                        }}
                    />
                </div>
            </div>

            {/* Recursion */}
            {expanded && hasChildren && (
                <div className="relative">
                    {/* Vertical connecting line */}
                    {depth > 0 && (
                        <div className="absolute left-[3px] top-0 bottom-0 w-px bg-slate-200"
                            style={{ left: `${(depth * 16) + 7}px` }}
                        />
                    )}
                    {node.children.map(child => (
                        <TraceNodeRenderer
                            key={child.spanId}
                            node={child}
                            totalDuration={totalDuration}
                            depth={depth + 1}
                            rootStartTime={rootStartTime}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
