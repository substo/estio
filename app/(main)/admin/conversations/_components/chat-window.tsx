import { useEffect, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageSquare, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ChatWindowProps {
    conversation: Conversation;
    messages: Message[];
    loading: boolean;
    onSendMessage: (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => void;
    onSync?: () => void;
    onGenerateDraft?: (instruction?: string) => Promise<string | null>; // Returns draft text or null if failed
}

/**
 * Map GHL type codes to friendly channel names
 */
function getChannelName(type: string): string {
    const typeUpper = type?.toUpperCase() || '';
    if (typeUpper.includes('EMAIL')) return 'Email';
    if (typeUpper.includes('WHATSAPP')) return 'WhatsApp';
    if (typeUpper.includes('PHONE') || typeUpper.includes('SMS') || typeUpper.includes('CALL')) return 'SMS';
    if (typeUpper.includes('WEBCHAT') || typeUpper.includes('LIVE')) return 'Live Chat';
    return type || 'Unknown';
}

function getInitialChannel(conversation: Conversation): 'SMS' | 'Email' | 'WhatsApp' {
    const typeUpper = (conversation.lastMessageType || conversation.type || '').toUpperCase();
    if (typeUpper.includes('EMAIL')) return 'Email';
    if (typeUpper.includes('WHATSAPP')) return 'WhatsApp';
    return 'SMS';
}

import { MessageBubble } from "./message-bubble";
import { SuggestionBubbles } from "./suggestion-bubbles";
import { Sparkles, Loader2 as Spinner } from "lucide-react"; // Import Sparkles explicitly if not already

export function ChatWindow({ conversation, messages, loading, onSendMessage, onSync, onGenerateDraft, suggestions = [] }: ChatWindowProps & { suggestions?: string[] }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [generatingDraft, setGeneratingDraft] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<'SMS' | 'Email' | 'WhatsApp'>(getInitialChannel(conversation));

    // Update channel if conversation changes
    useEffect(() => {
        setSelectedChannel(getInitialChannel(conversation));
    }, [conversation.id]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

    const handleSend = () => {
        if (!draft.trim()) return;
        setSending(true);
        onSendMessage(draft, selectedChannel);
        setDraft("");
        setSending(false);
    };

    const handleAiDraft = async () => {
        if (!onGenerateDraft || generatingDraft) return;
        setGeneratingDraft(true);
        try {
            // Pass current draft as user instruction
            const instruction = draft.trim();
            const text = await onGenerateDraft(instruction);

            if (text) {
                // REPLACE content (per user request) instead of appending
                // Also ensures we don't duplicate the instruction if the AI repeated it
                setDraft(text);
            }
        } catch (e) {
            console.error("Draft generation failed", e);
        } finally {
            setGeneratingDraft(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-white min-w-0 overflow-hidden">
            {/* Header */}
            <div className="h-16 border-b flex items-center px-6 shrink-0 justify-between bg-white z-10 shadow-sm">
                <div>
                    <h3 className="font-bold text-gray-900">{conversation.contactName || "Unknown Contact"}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex h-2 w-2 rounded-full bg-green-500" />
                        <p className="text-xs text-gray-500 font-medium">
                            {getChannelName(conversation.lastMessageType || conversation.type)} • {conversation.status}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {conversation.lastMessageType === 'TYPE_WHATSAPP' && onSync && (
                        <Button variant="ghost" size="icon" onClick={onSync} title="Sync WhatsApp History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scroll-smooth">
                {loading && (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500/50" />
                    </div>
                )}

                {!loading && messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-4">
                        <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                            <MessageSquare className="h-6 w-6 text-gray-300" />
                        </div>
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                )}

                {messages.map((m) => (
                    <MessageBubble
                        key={m.id}
                        message={m}
                        contactPhone={conversation.contactPhone}
                        contactEmail={conversation.contactEmail}
                        contactName={conversation.contactName}
                    />
                ))}
            </div>

            {/* Input Area */}
            <div className="border-t bg-white">
                {/* Suggestions Area - Renders if suggestions exist */}
                <SuggestionBubbles
                    suggestions={suggestions}
                    onSelect={(text) => setDraft(text)}
                />

                <div className="p-4 flex flex-col gap-3 max-w-4xl mx-auto">
                    {/* Channel Selector & AI Toolbar */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Reply via:</span>
                            <Select
                                value={selectedChannel}
                                onValueChange={(v: 'SMS' | 'Email' | 'WhatsApp') => setSelectedChannel(v)}
                            >
                                <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs border-dashed focus:ring-0 focus:border-solid">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SMS">SMS / Text</SelectItem>
                                    <SelectItem value="Email">Email</SelectItem>
                                    <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* AI Draft Button */}
                        {onGenerateDraft && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleAiDraft}
                                disabled={generatingDraft}
                                className="h-8 text-xs font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 gap-1.5 transition-colors"
                            >
                                {generatingDraft ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Sparkles className="w-3.5 h-3.5" />
                                )}
                                {generatingDraft ? "Generating..." : "AI Draft"}
                            </Button>
                        )}
                    </div>

                    <div className="relative shadow-sm rounded-xl border focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={`Type a message (${selectedChannel})...`}
                            className="min-h-[42px] max-h-[300px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-3 px-4 text-sm"
                            style={{ height: draft ? 'auto' : '42px' }} // Dynamic height simulation or just default small
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    handleSend();
                                }
                            }}
                        />
                        <div className="flex justify-between items-center px-2 pb-2">
                            <div className="text-[10px] text-gray-400 pl-2">
                                {selectedChannel === 'SMS' && `${draft.length} chars`}
                            </div>
                            <Button
                                size="sm"
                                className={cn(
                                    "rounded-lg px-4 transition-all duration-200",
                                    draft.trim() ? "bg-blue-600 hover:bg-blue-700 w-auto" : "w-10 px-0 bg-gray-100 text-gray-400 hover:bg-gray-200"
                                )}
                                onClick={handleSend}
                                disabled={sending || !draft.trim()}
                            >
                                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                    <p className="text-[10px] text-center text-gray-300">
                        Top Tip: Press Cmd+Enter to send
                    </p>
                </div>
            </div>
        </div >
    );
}
