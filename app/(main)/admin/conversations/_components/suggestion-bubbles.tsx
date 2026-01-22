import { Button } from "@/components/ui/button";
import { Sparkles, MessageSquare } from "lucide-react";

interface SuggestionBubblesProps {
    suggestions: string[];
    onSelect: (text: string) => void;
}

export function SuggestionBubbles({ suggestions, onSelect }: SuggestionBubblesProps) {
    if (!suggestions || suggestions.length === 0) return null;

    return (
        <div className="flex flex-col gap-2 p-3 bg-purple-50 border-t border-purple-100 animate-in slide-in-from-bottom-2 fade-in duration-300">
            <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 mb-1">
                <Sparkles className="w-3 h-3" />
                AI Suggested Replies
            </div>
            <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => (
                    <button
                        key={index}
                        onClick={() => onSelect(suggestion)}
                        className="text-left text-xs bg-white hover:bg-purple-100 border border-purple-200 text-slate-700 px-3 py-2 rounded-2xl shadow-sm transition-colors max-w-full truncate hover:whitespace-normal h-auto min-h-[32px]"
                        title={suggestion}
                    >
                        <span className="line-clamp-2">{suggestion}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
