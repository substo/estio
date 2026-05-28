"use client";

import { format } from "date-fns";
import { memo } from "react";
import {
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCheck,
    ChevronDown,
    ChevronUp,
    Clock,
    Mail,
    Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MessageBubbleChromeMessage = {
    id: string;
    type: string;
    direction: "inbound" | "outbound";
    status?: string;
    sendState?: string;
    outboxState?: {
        status?: string | null;
    } | null;
    dateAdded: string | Date;
    subject?: string;
    emailFrom?: string;
    emailTo?: string;
    contactName?: string;
};

interface MessageBubbleChromeProps {
    message: MessageBubbleChromeMessage;
    isEmail: boolean;
    isSMS: boolean;
    isWhatsApp: boolean;
    isOutbound: boolean;
    isExpanded: boolean;
    contactName?: string;
    contactPhone?: string;
    onExpandToggle: () => void;
    onResendMessage?: (messageId: string) => void | Promise<void>;
    failureFallbackLabel?: string | null;
    smsFallbackLabel?: string | null;
    smsFallbackUnavailableLabel?: string | null;
    onSendSmsFallback?: (messageId: string) => void | Promise<void>;
}

export const MessageBubbleChannelHeader = memo(function MessageBubbleChannelHeader({
    message,
    isEmail,
    isSMS,
    isWhatsApp,
    isOutbound,
    isExpanded,
    contactName,
    contactPhone,
}: Omit<MessageBubbleChromeProps, "onExpandToggle" | "onResendMessage">) {
    return (
        <>
            {/* SMS/WhatsApp Header */}
            {(isSMS || isWhatsApp) && (
                <div className={cn(
                    "px-3 py-1.5 text-[11px] flex items-center gap-2 border-b min-w-0",
                    isOutbound ? "bg-blue-700/30 text-blue-100 border-blue-500/50" : "bg-gray-50 text-gray-500 border-gray-100"
                )}>
                    <Smartphone className="h-3 w-3 shrink-0" />
                    <span className="flex-1 w-0 min-w-0 truncate">
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
        </>
    );
});

export const MessageBubbleEmailExpandFooter = memo(function MessageBubbleEmailExpandFooter({
    isEmail,
    isExpanded,
    onExpandToggle,
}: Pick<MessageBubbleChromeProps, "isEmail" | "isExpanded" | "onExpandToggle">) {
    if (!isEmail) return null;

    return (
        <div
            className="bg-gray-50 border-t p-1 flex justify-center cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={onExpandToggle}
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
    );
});

export const MessageBubbleTimestampStatusRow = memo(function MessageBubbleTimestampStatusRow({
    message,
    isEmail,
    isSMS,
    isWhatsApp,
    isOutbound,
    contactName,
    onResendMessage,
    failureFallbackLabel,
    smsFallbackLabel,
    smsFallbackUnavailableLabel,
    onSendSmsFallback,
}: Omit<MessageBubbleChromeProps, "isExpanded" | "contactPhone" | "onExpandToggle">) {
    return (
        <div className="flex items-center gap-1 mt-1 px-1 justify-between select-none min-w-0">
            <span className="text-[10px] text-gray-400 flex gap-1 items-center flex-1 min-w-0 truncate">
                {isEmail && <Mail className="h-3 w-3 shrink-0" />}
                {isSMS && <Smartphone className="h-3 w-3 shrink-0" />}
                <span className="truncate">
                    {(message.contactName || contactName) && !isOutbound ? "Contact • " : "You • "}
                    {format(new Date(message.dateAdded), "PP p")}
                </span>
            </span>

            {isOutbound && (isSMS || isWhatsApp) && (
                <span className="flex items-center gap-1 shrink-0 ml-2">
                    {(message.status === "sending" || message.status === "pending") && (
                        (String(message.sendState || "").toLowerCase() === "retrying"
                            || String(message.outboxState?.status || "").toLowerCase() === "failed")
                            ? (
                                <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] border border-amber-100 font-medium">
                                    <AlertTriangle className="h-3 w-3" />
                                    Retrying
                                </span>
                            )
                            : (
                                <Clock className="h-3 w-3 text-gray-400" aria-label="Sending" />
                            )
                    )}
                    {message.status === "sent" && (
                        <Check className="h-3 w-3 text-gray-400" aria-label="Sent" />
                    )}
                    {(message.status === "delivered" || message.status === "read" || message.status === "played") && (
                        <CheckCheck className={cn("h-3 w-3", message.status === "read" || message.status === "played" ? "text-blue-500" : "text-gray-400")} aria-label={message.status === "read" ? "Read" : "Delivered"} />
                    )}
                    {message.status === "failed" && (
                        <div className="flex items-center gap-1">
                            <span className="flex items-center gap-1 text-red-500 bg-red-50 px-1.5 py-0.5 rounded text-[10px] border border-red-100 font-medium">
                                <AlertTriangle className="h-3 w-3" />
                                Failed
                            </span>
                            {onResendMessage && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onResendMessage(message.id);
                                    }}
                                    className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 rounded transition-colors"
                                >
                                    Resend
                                </button>
                            )}
                            {failureFallbackLabel && (
                                <span className="text-[10px] text-red-600 px-1 py-0.5 max-w-[220px] truncate" title={failureFallbackLabel}>
                                    {failureFallbackLabel}
                                </span>
                            )}
                            {smsFallbackLabel && onSendSmsFallback && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSendSmsFallback(message.id);
                                    }}
                                    className="text-[10px] text-green-700 bg-green-50 hover:bg-green-100 border border-green-100 px-1.5 py-0.5 rounded transition-colors"
                                >
                                    {smsFallbackLabel}
                                </button>
                            )}
                            {smsFallbackUnavailableLabel && (
                                <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                                    {smsFallbackUnavailableLabel}
                                </span>
                            )}
                        </div>
                    )}
                </span>
            )}
        </div>
    );
});
