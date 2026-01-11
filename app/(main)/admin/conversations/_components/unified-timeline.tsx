'use client';

import { useState, useRef, useEffect } from 'react';
import { fetchDealTimeline } from '../../deals/actions';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Sparkles } from "lucide-react";

interface UnifiedTimelineProps {
    dealId: string;
}

export function UnifiedTimeline({ dealId }: UnifiedTimelineProps) {
    const [timelineMessages, setTimelineMessages] = useState<any[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(true);
    const timelineRef = useRef<HTMLDivElement>(null);

    // Initial Load of Timeline
    useEffect(() => {
        setLoadingTimeline(true);
        fetchDealTimeline(dealId)
            .then(msgs => {
                setTimelineMessages(msgs);
                setLoadingTimeline(false);
            })
            .catch(err => {
                console.error("Failed to load timeline", err);
                setLoadingTimeline(false);
            });
    }, [dealId]);

    // Auto-scroll timeline
    useEffect(() => {
        if (timelineRef.current) {
            timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
        }
    }, [timelineMessages]);

    return (
        <div className="flex-1 bg-slate-200/50 p-0 flex flex-col relative overflow-hidden h-full">
            <div className="h-14 border-b bg-white flex items-center px-4 justify-between shrink-0">
                <div className="flex items-center gap-2 text-gray-700">
                    <MessageSquare className="w-4 h-4" />
                    <span className="font-semibold text-sm">Unified Timeline</span>
                </div>
                <div className="text-xs text-muted-foreground">
                    {timelineMessages.length} events
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={timelineRef}>
                {loadingTimeline ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Sparkles className="w-5 h-5 animate-spin mr-2" />
                        Loading timeline...
                    </div>
                ) : timelineMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-sm">No activity yet. Start a conversation!</p>
                    </div>
                ) : (
                    timelineMessages.map((msg) => {
                        const isOutbound = msg.direction === 'outbound';
                        return (
                            <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                                    <div className="text-[10px] text-gray-400 mb-1 px-1">
                                        {isOutbound ? 'You' : msg.senderName} • {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                                    </div>
                                    <div
                                        className={`p-3 rounded-xl text-sm shadow-sm whitespace-pre-wrap ${isOutbound
                                            ? 'bg-indigo-600 text-white rounded-br-none'
                                            : 'bg-white text-gray-800 border rounded-bl-none'
                                            }`}
                                    >
                                        {msg.body}
                                    </div>
                                    {/* Optional: Channel Indicator */}
                                    <div className="text-[9px] text-gray-300 mt-0.5 px-1 uppercase tracking-wider">
                                        {msg.type}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
