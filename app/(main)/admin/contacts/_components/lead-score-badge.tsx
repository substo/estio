import { Badge } from "@/components/ui/badge";

export function LeadScoreBadge({ score }: { score: number }) {
    const color =
        score >= 80 ? 'bg-green-500 text-white border-green-600' :
        score >= 60 ? 'bg-emerald-400 text-white border-emerald-500' :
        score >= 30 ? 'bg-yellow-400 text-yellow-950 border-yellow-500' :
        score > 0  ? 'bg-gray-300 text-gray-700 border-gray-400' :
                     'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700';

    return (
        <span 
            className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-[11px] font-bold border ${color}`}
            title={`Lead Score: ${score}`}
        >
            {score}
        </span>
    );
}
