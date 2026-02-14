"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, X, TrendingUp, Calendar, Clock, MessageSquare } from "lucide-react";
import { getAggregateAIUsage } from "@/app/(main)/admin/conversations/actions";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface TimePeriodUsage {
    totalTokens: number;
    totalCost: number;
}

interface ConversationUsage {
    id: string;
    conversationId: string;
    contactName: string;
    contactEmail: string | null;
    totalTokens: number;
    totalCost: number;
    lastMessageAt: string;
}

interface AIUsage {
    today: TimePeriodUsage;
    thisMonth: TimePeriodUsage;
    allTime: TimePeriodUsage & { conversationCount: number };
    topConversations: ConversationUsage[];
}

export function AICostBadge() {
    const [usage, setUsage] = useState<AIUsage | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchUsage = useCallback(async () => {
        try {
            const data = await getAggregateAIUsage();
            setUsage(data);
        } catch (e) {
            console.error("[AICostBadge] Failed to fetch usage:", e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsage();
        // Refresh every 60 seconds
        const interval = setInterval(fetchUsage, 60000);
        return () => clearInterval(interval);
    }, [fetchUsage]);

    // Format token count (e.g., 2400 -> "2.4k")
    const formatTokens = (tokens: number): string => {
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(1)}M`;
        }
        if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}k`;
        }
        return tokens.toString();
    };

    // Format cost
    const formatCost = (cost: number): string => {
        if (cost === 0) return "$0.00";
        if (cost < 0.01) return `$${cost.toFixed(4)}`;
        return `$${cost.toFixed(2)}`;
    };

    if (isLoading) {
        return (
            <div className="h-8 w-28 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
        );
    }

    // Always show badge, even with zero usage
    const displayUsage = usage || {
        today: { totalTokens: 0, totalCost: 0 },
        thisMonth: { totalTokens: 0, totalCost: 0 },
        allTime: { totalTokens: 0, totalCost: 0, conversationCount: 0 },
        topConversations: []
    };


    return (
        <>
            {/* Badge Button */}
            <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/30 dark:to-blue-900/30 border border-purple-200/50 dark:border-purple-700/50 cursor-pointer transition-all hover:shadow-md hover:border-purple-300 dark:hover:border-purple-600 hover:scale-[1.02] active:scale-[0.98]"
            >
                <Sparkles className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />

                {/* Today's cost */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">Today</span>
                    <span className="text-xs font-medium text-green-700 dark:text-green-400 font-mono">
                        {formatCost(displayUsage.today.totalCost)}
                    </span>
                </div>

                <span className="text-gray-300 dark:text-gray-600">|</span>

                {/* This month's cost */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">Month</span>
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-400 font-mono">
                        {formatCost(displayUsage.thisMonth.totalCost)}
                    </span>
                </div>
            </button>

            {/* Detailed Usage Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-purple-600" />
                            AI Usage Dashboard
                        </DialogTitle>
                        <DialogDescription>
                            Track your AI-powered conversation costs and token usage
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 pt-4">
                        {/* Time Period Cards */}
                        <div className="grid grid-cols-3 gap-4">
                            {/* Today */}
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
                                    <Clock className="h-4 w-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">Today</span>
                                </div>
                                <div className="text-2xl font-bold text-green-800 dark:text-green-300 font-mono">
                                    {formatCost(displayUsage.today.totalCost)}
                                </div>
                                <div className="text-xs text-green-600 dark:text-green-500 font-mono mt-1">
                                    {formatTokens(displayUsage.today.totalTokens)} tokens
                                </div>
                            </div>

                            {/* This Month */}
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 mb-2">
                                    <Calendar className="h-4 w-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">This Month</span>
                                </div>
                                <div className="text-2xl font-bold text-blue-800 dark:text-blue-300 font-mono">
                                    {formatCost(displayUsage.thisMonth.totalCost)}
                                </div>
                                <div className="text-xs text-blue-600 dark:text-blue-500 font-mono mt-1">
                                    {formatTokens(displayUsage.thisMonth.totalTokens)} tokens
                                </div>
                            </div>

                            {/* All Time */}
                            <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400 mb-2">
                                    <TrendingUp className="h-4 w-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">All Time</span>
                                </div>
                                <div className="text-2xl font-bold text-purple-800 dark:text-purple-300 font-mono">
                                    {formatCost(displayUsage.allTime.totalCost)}
                                </div>
                                <div className="text-xs text-purple-600 dark:text-purple-500 font-mono mt-1">
                                    {formatTokens(displayUsage.allTime.totalTokens)} tokens
                                </div>
                                <div className="text-[10px] text-purple-500 dark:text-purple-600 mt-1">
                                    {displayUsage.allTime.conversationCount} conversations
                                </div>
                            </div>
                        </div>

                        {/* Top Conversations by Cost */}
                        {displayUsage.topConversations.length > 0 && (
                            <div className="border-t pt-4">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4" />
                                    Top Conversations by Cost
                                </h4>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {displayUsage.topConversations.map((conv, index) => (
                                        <Link
                                            key={conv.id}
                                            href={`/admin/conversations?id=${conv.conversationId}`}
                                            onClick={() => setIsModalOpen(false)}
                                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-mono text-gray-400 w-4">
                                                    {index + 1}.
                                                </span>
                                                <div>
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                                        {conv.contactName}
                                                    </div>
                                                    {conv.contactEmail && (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            {conv.contactEmail}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-mono font-medium text-green-700 dark:text-green-400">
                                                    {formatCost(conv.totalCost)}
                                                </div>
                                                <div className="text-[10px] text-gray-400 font-mono">
                                                    {formatTokens(conv.totalTokens)} tokens
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empty State */}
                        {displayUsage.topConversations.length === 0 && (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No AI-assisted conversations yet</p>
                                <p className="text-xs mt-1">Start using the AI coordinator to see usage here</p>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

