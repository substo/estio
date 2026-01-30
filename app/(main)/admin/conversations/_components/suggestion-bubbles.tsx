import { Sparkles } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface SuggestionBubblesProps {
    suggestions: string[];
    onSelect: (text: string) => void;
}

export function SuggestionBubbles({ suggestions, onSelect }: SuggestionBubblesProps) {
    if (!suggestions || suggestions.length === 0) return null;

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-purple-50/60 to-transparent border-t border-purple-100/40 animate-in slide-in-from-bottom-2 fade-in duration-300">
                {/* Single sparkle icon with tooltip */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex-shrink-0 p-1 rounded-full bg-purple-100/60 cursor-help">
                            <Sparkles className="w-3 h-3 text-purple-500" />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-[200px]">
                        <p className="text-xs">
                            <span className="font-medium">AI Quick Replies</span> — Click to generate a response
                        </p>
                    </TooltipContent>
                </Tooltip>

                {/* Suggestion bubbles */}
                <div className="flex flex-wrap gap-1 overflow-hidden">
                    {suggestions.map((suggestion, index) => (
                        <button
                            key={index}
                            onClick={() => onSelect(suggestion)}
                            className="text-[11px] bg-white/80 hover:bg-purple-50 border border-purple-200/60 text-slate-600 px-2.5 py-1 rounded-full transition-colors hover:border-purple-300 max-w-[180px]"
                        >
                            <span className="line-clamp-1">{suggestion}</span>
                        </button>
                    ))}
                </div>
            </div>
        </TooltipProvider>
    );
}
