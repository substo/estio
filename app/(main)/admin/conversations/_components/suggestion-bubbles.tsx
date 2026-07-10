import { Sparkles } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
    isMobileAiSuggestionDefaultCollapsed,
    usePersistentAiSuggestionsCollapsed,
} from "./use-persistent-ai-suggestions-collapsed";

interface SuggestionBubblesProps {
    suggestions: string[];
    onSelect: (text: string) => void;
    className?: string;
}

export function SuggestionBubbles({ suggestions, onSelect, className }: SuggestionBubblesProps) {
    const [collapsed, setCollapsed] = usePersistentAiSuggestionsCollapsed(
        "idx.conversations.aiSuggestionBubblesCollapsed.v1",
        isMobileAiSuggestionDefaultCollapsed()
    );

    if (!suggestions || suggestions.length === 0) return null;

    return (
        <TooltipProvider delayDuration={200}>
            <div className={cn(
                "flex min-w-0 items-center gap-1.5 bg-gradient-to-r from-purple-50/60 to-transparent border-t border-purple-100/40 animate-in slide-in-from-bottom-2 fade-in duration-300",
                className || "px-2 py-1"
            )}>
                {/* Single sparkle icon with tooltip */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100/70 text-purple-500 transition-colors hover:bg-purple-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
                            onClick={() => setCollapsed((current) => !current)}
                            aria-label={collapsed ? "Open AI quick replies" : "Hide AI quick replies"}
                            title={collapsed ? "Open AI quick replies" : "Hide AI quick replies"}
                        >
                            <Sparkles className="w-3 h-3 text-purple-500" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-[200px]">
                        <p className="text-xs">
                            <span className="font-medium">AI Quick Replies</span>
                            {collapsed ? " - click to show suggestions" : " - click a suggestion to generate a response"}
                        </p>
                    </TooltipContent>
                </Tooltip>

                {/* Suggestion bubbles */}
                {!collapsed && (
                    <div className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => onSelect(suggestion)}
                                className="max-w-[180px] shrink-0 rounded-full border border-purple-200/60 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-purple-300 hover:bg-purple-50"
                            >
                                <span className="block truncate">{suggestion}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}
