import { useEffect, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Mail, MessageSquare, Smartphone, Paperclip, ExternalLink, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

interface ChatWindowProps {
    conversation: Conversation;
    messages: Message[];
    loading: boolean;
    onSendMessage: (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => void;
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

interface MessageBubbleProps {
    message: Message;
    contactPhone?: string;
    contactEmail?: string;
    contactName?: string;
}

function MessageBubble({ message, contactPhone, contactEmail, contactName }: MessageBubbleProps) {
    const isOutbound = message.direction === 'outbound';
    const isEmail = message.type === 'TYPE_EMAIL';
    const isSMS = message.type === 'TYPE_SMS' || message.type?.includes('SMS') || message.type?.includes('PHONE');
    const isWhatsApp = message.type?.includes('WHATSAPP');
    const [isExpanded, setIsExpanded] = useState(!isEmail); // Emails collapsed by default

    // Helper to detect if content is rich HTML (heuristic)
    const isRichHtml = message.body && (message.body.includes('<div') || message.body.includes('<html') || message.body.includes('<table'));

    // For emails, stripping newlines to <br> isn't enough, we trust the HTML but clip it.
    // For SMS/Text, we want to respect newlines.

    // Helper to strip HTML for snippet
    const getSnippet = (html: string) => {
        if (!html) return "";
        // Simple regex strip for safety/speed roughly
        const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style blocks
            .replace(/<[^>]*>/g, ' ') // Replace tags with space
            .replace(/\s+/g, ' ') // Collapse spaces
            .trim();
        return text.substring(0, 150) + (text.length > 150 ? "..." : "");
    };

    const snippet = isEmail ? getSnippet(message.body) : "";

    return (
        <div
            className={cn(
                "flex flex-col max-w-[85%] min-w-0 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300",
                isOutbound ? "ml-auto items-end" : "mr-auto items-start"
            )}
        >
            <div
                className={cn(
                    "relative px-4 py-3 rounded-2xl text-sm shadow-sm overflow-hidden w-full transition-all duration-200",
                    isOutbound
                        ? "bg-blue-600 text-white rounded-tr-none"
                        : "bg-white text-gray-800 border rounded-tl-none",
                    isEmail && "border-l-4 border-l-orange-400 p-0 overflow-hidden", // Email styling distinction
                    isEmail && !isExpanded && "cursor-pointer hover:shadow-md hover:border-l-orange-500" // Clickable indication
                )}
                onClick={() => {
                    if (isEmail && !isExpanded) {
                        setIsExpanded(true);
                    }
                }}
            >
                {/* SMS/WhatsApp Header */}
                {(isSMS || isWhatsApp) && (
                    <div className={cn(
                        "px-3 py-1.5 text-[11px] flex items-center gap-2 border-b",
                        isOutbound ? "bg-blue-700/30 text-blue-100 border-blue-500/50" : "bg-gray-50 text-gray-500 border-gray-100"
                    )}>
                        <Smartphone className="h-3 w-3 shrink-0" />
                        <span>
                            {isOutbound
                                ? `To: ${contactPhone || contactName || "Contact"}`
                                : `From: ${contactPhone || contactName || "Contact"}`
                            }
                        </span>
                    </div>
                )}

                {/* Email Specific Header */}
                {isEmail && (
                    <div className="flex flex-col border-b border-gray-100">
                        {/* Top: Type Label and Expand Hint */}
                        <div className={cn("px-4 py-2 text-xs font-semibold flex items-center justify-between gap-2", isOutbound ? "bg-blue-700/50 text-white border-b border-blue-500" : "bg-gray-50 text-gray-700")}>
                            <div className="flex items-center gap-2">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="opacity-70 text-[10px] uppercase tracking-wider">Email Message</span>
                            </div>
                            {!isExpanded && <span className={cn("font-normal text-[10px] shrink-0", isOutbound ? "text-blue-100" : "text-gray-400")}>Click to expand</span>}
                        </div>

                        {/* Middle: Subject */}
                        <div className="px-4 py-2 bg-white">
                            <span className="font-semibold text-sm text-gray-900 block break-words">{message.subject || "No Subject"}</span>
                        </div>

                        {/* Bottom: From -> To */}
                        {(message.contactName || message.emailFrom || message.emailTo) && (
                            <div className="px-4 pb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 bg-white">
                                <span className="flex items-center gap-1 max-w-[45%] truncate" title={message.emailFrom}>
                                    <span className="font-medium text-gray-600">From:</span> {message.emailFrom || (isOutbound ? "You" : message.contactName || "Contact")}
                                </span>
                                <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                                <span className="flex items-center gap-1 max-w-[45%] truncate" title={message.emailTo}>
                                    <span className="font-medium text-gray-600">To:</span> {message.emailTo || (isOutbound ? message.contactName || "Contact" : "You")}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Content Area */}
                <div className={cn(
                    "w-full break-words break-all transition-all duration-300 ease-in-out relative",
                    isEmail ? "bg-white text-black" : "", // Force white background for emails
                    isEmail && "p-4",
                    !isEmail && "whitespace-pre-wrap"
                )}>
                    {isEmail && !isExpanded ? (
                        // Snippet View
                        <div className="text-gray-500 text-sm italic">
                            {snippet || "Click to view email content..."}
                        </div>
                    ) : (
                        // Full View
                        (isEmail || isRichHtml) ? (
                            <div
                                className="prose prose-sm max-w-full overflow-x-auto dark:prose-invert prose-p:my-1 prose-headings:my-2"
                                dangerouslySetInnerHTML={{ __html: message.body }}
                            />
                        ) : (
                            message.body
                        )
                    )}
                </div>

                {/* Attachments */}
                {/* ... existing attachments code ... */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className={cn("px-4 pb-2 space-y-1 mt-2", isEmail && "bg-gray-50 pt-2 border-t")}>
                        {message.attachments.map((url, i) => (
                            <a
                                key={i}
                                href={url}
                                target="_blank"
                                className={cn(
                                    "flex items-center gap-2 text-xs p-2 rounded hover:bg-black/5 transition-colors truncate max-w-full",
                                    isOutbound && !isEmail ? "text-blue-100 hover:bg-white/20" : "text-gray-600"
                                )}
                            >
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="truncate">Attachment {i + 1}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50" />
                            </a>
                        ))}
                    </div>
                )}

                {/* Expansion Toggle */}
                {isEmail && (
                    <div
                        className="bg-gray-50 border-t p-1 flex justify-center cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        {isExpanded ? (
                            <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-gray-500">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity">Collapse</span>
                                <ChevronUp className="h-4 w-4" />
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-gray-500">
                                <span className="opacity-0 hover:opacity-100 transition-opacity">Expand</span>
                                <ChevronDown className="h-4 w-4" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Timestamp */}
            <span className="text-[10px] text-gray-400 mt-1 px-1 flex gap-1 items-center select-none">
                {message.type === 'TYPE_EMAIL' && <Mail className="h-3 w-3" />}
                {message.type === 'TYPE_SMS' && <Smartphone className="h-3 w-3" />}
                {message.contactId && !isOutbound ? "Contact • " : "You • "}
                {format(new Date(message.dateAdded), 'PP p')}
            </span>
        </div>
    );
}

export function ChatWindow({ conversation, messages, loading, onSendMessage }: ChatWindowProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
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
                {/* Could add Actions here (e.g. Call, Archive) */}
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
            <div className="p-4 border-t bg-white">
                <div className="flex flex-col gap-3 max-w-4xl mx-auto">
                    {/* Channel Selector */}
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

                    <div className="relative shadow-sm rounded-xl border focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={`Type a message (${selectedChannel})...`}
                            className="min-h-[80px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-3 px-4 text-sm"
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
        </div>
    );
}
