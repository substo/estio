import { useEffect, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { GOOGLE_AI_MODELS } from "@/lib/ai/models";
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
    onFetchHistory?: () => void;
    onGenerateDraft?: (instruction?: string, model?: string) => Promise<string | null>; // Returns draft text or null if failed
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

/**
 * Get placeholder text based on channel - guides users on both manual typing and AI Draft
 */
function getPlaceholderText(channel: 'SMS' | 'Email' | 'WhatsApp'): string {
    const channelHints: Record<string, string> = {
        WhatsApp: 'Message or AI instruction...',
        Email: 'Email or AI instruction...',
        SMS: 'Text or AI instruction...',
    };
    return channelHints[channel] || channelHints.SMS;
}

import { MessageBubble } from "./message-bubble";
import { SuggestionBubbles } from "./suggestion-bubbles";
import { Sparkles, Loader2 as Spinner } from "lucide-react"; // Import Sparkles explicitly if not already

import { getAvailableAiModelsAction } from "@/app/(main)/admin/conversations/actions";

export function ChatWindow({ conversation, messages, loading, onSendMessage, onSync, onGenerateDraft, onFetchHistory, suggestions = [] }: ChatWindowProps & { suggestions?: string[] }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [generatingDraft, setGeneratingDraft] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<'SMS' | 'Email' | 'WhatsApp'>(getInitialChannel(conversation));
    const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
    const [availableModels, setAvailableModels] = useState<any[]>([]); // Dynamic list

    // Fetch available models on mount
    useEffect(() => {
        let mounted = true;
        getAvailableAiModelsAction().then(models => {
            if (mounted && models && models.length > 0) {
                setAvailableModels(models);
                // Optional: Check if default selectedModel is in list, if not switch to first
            }
        }).catch(err => console.error("Failed to load AI models:", err));

        return () => { mounted = false; };
    }, []);

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

    const handleAiDraft = async (instructionOverride?: string) => {
        if (!onGenerateDraft || generatingDraft) return;
        setGeneratingDraft(true);
        try {
            // Pass instruction (override or current draft)
            const instruction = instructionOverride || draft.trim();
            const text = await onGenerateDraft(instruction, selectedModel);

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
                    {(conversation.type === 'Email' || conversation.lastMessageType === 'TYPE_EMAIL') && onFetchHistory && (
                        <Button variant="ghost" size="icon" onClick={onFetchHistory} title="Fetch Gmail History">
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
                    onSelect={(text) => handleAiDraft(text)}
                />

                <div className="px-3 py-2 max-w-4xl mx-auto">
                    <div className="relative rounded-xl border bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-300 transition-all">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={getPlaceholderText(selectedChannel)}
                            className="min-h-[36px] max-h-[200px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-2.5 px-3 text-sm"
                            style={{ height: draft ? 'auto' : '36px' }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    handleSend();
                                }
                            }}
                        />
                        {/* Inline Toolbar */}
                        <div className="flex items-center justify-between px-2 pb-1.5 gap-1">
                            <div className="flex items-center gap-1">
                                {/* Channel Selector */}
                                <Select
                                    value={selectedChannel}
                                    onValueChange={(v: 'SMS' | 'Email' | 'WhatsApp') => setSelectedChannel(v)}
                                >
                                    <SelectTrigger className="h-7 w-auto min-w-[85px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SMS" className="text-xs">SMS</SelectItem>
                                        <SelectItem value="Email" className="text-xs">Email</SelectItem>
                                        <SelectItem value="WhatsApp" className="text-xs">WhatsApp</SelectItem>
                                    </SelectContent>
                                </Select>

                                {/* AI Toolbar */}
                                {onGenerateDraft && (
                                    <>
                                        <div className="w-px h-4 bg-slate-200" />
                                        <Select value={selectedModel} onValueChange={setSelectedModel}>
                                            <SelectTrigger className="h-7 w-[110px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map(m => (
                                                    <SelectItem key={m.value} value={m.value} className="text-xs">
                                                        {m.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleAiDraft()}
                                            disabled={generatingDraft}
                                            className="h-7 text-[11px] font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 gap-1 px-2"
                                        >
                                            {generatingDraft ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Sparkles className="w-3 h-3" />
                                            )}
                                            {generatingDraft ? "..." : "AI"}
                                        </Button>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 hidden sm:inline">⌘↵</span>
                                {selectedChannel === 'SMS' && draft.length > 0 && (
                                    <span className="text-[10px] text-slate-400">{draft.length}</span>
                                )}
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150",
                                        draft.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    )}
                                    onClick={handleSend}
                                    disabled={sending || !draft.trim()}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
