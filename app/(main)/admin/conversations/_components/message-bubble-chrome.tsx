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
    Send,
    Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { deriveOutboundWhatsAppUiState, type OutboundWhatsAppUiTone } from "./conversation-message-actions";
import type { MessageBubbleTheme } from "./message-bubble-theme";

type MessageBubbleChromeMessage = {
    id: string;
    type: string;
    direction: "inbound" | "outbound";
    status?: string;
    sendState?: string;
    outboxState?: {
        transport?: string | null;
        stoSecureDelivery?: boolean | null;
        status?: string | null;
        scheduledAt?: string | null;
        attemptCount?: number | null;
        lastError?: string | null;
    } | null;
    dateAdded: string | Date;
    subject?: string;
    emailFrom?: string;
    emailTo?: string;
    contactName?: string;
    source?: string;
};

interface MessageBubbleChromeProps {
    message: MessageBubbleChromeMessage;
    isEmail: boolean;
    isSMS: boolean;
    isWhatsApp: boolean;
    isOutbound: boolean;
    isExpanded: boolean;
    theme: MessageBubbleTheme;
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
    theme,
    contactName,
    contactPhone,
}: Omit<MessageBubbleChromeProps, "onExpandToggle" | "onResendMessage">) {
    const shouldShowMessagingHeader = (isSMS || isWhatsApp) && message.status === "failed";

    return (
        <>
            {/* SMS/WhatsApp Header */}
            {shouldShowMessagingHeader && (
                <div className={cn(
                    "mb-1.5 rounded-md px-2 py-1 text-[10px] flex items-center gap-1.5 border min-w-0",
                    theme.channelHeaderClassName
                )}>
                    <Smartphone className={cn("h-3 w-3 shrink-0", theme.channelHeaderIconClassName)} />
                    <span className="shrink-0 font-medium">{isWhatsApp ? "WhatsApp" : "SMS"}</span>
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
    theme,
    contactName,
    onResendMessage,
    failureFallbackLabel,
    smsFallbackLabel,
    smsFallbackUnavailableLabel,
    onSendSmsFallback,
}: Omit<MessageBubbleChromeProps, "isExpanded" | "contactPhone" | "onExpandToggle">) {
    const whatsAppUiState = isWhatsApp && isOutbound
        ? deriveOutboundWhatsAppUiState(message, {
            smsRelayEnabled: !!smsFallbackLabel,
            contactPhone: null,
        })
        : null;
    const toneClassName: Record<OutboundWhatsAppUiTone, string> = {
        muted: "text-gray-500 bg-gray-50 border-gray-100",
        info: "text-blue-600 bg-blue-50 border-blue-100",
        success: "text-blue-600 bg-blue-50 border-blue-100",
        warning: "text-amber-600 bg-amber-50 border-amber-100",
        danger: "text-red-500 bg-red-50 border-red-100",
    };
    const compactChannelLabel = isWhatsApp
        ? "WA"
        : isSMS
            ? String(message.source || "").toLowerCase().includes("android")
                ? "Android SMS"
                : "SMS"
            : isEmail
                ? "Email"
                : "Message";

    return (
        <div className="flex items-center gap-1 mt-0.5 px-1 justify-between select-none min-w-0 leading-none">
            <span className={cn("text-[10px] flex gap-1 items-center flex-1 min-w-0 truncate", theme.timestampTextClassName)}>
                {isEmail && <Mail className="h-3 w-3 shrink-0" />}
                {(isSMS || isWhatsApp) && <Smartphone className="h-3 w-3 shrink-0" />}
                <span className="truncate" title={`${compactChannelLabel} • ${format(new Date(message.dateAdded), "PP p")}`}>
                    {compactChannelLabel} • {(message.contactName || contactName) && !isOutbound ? "Contact" : "You"} • {format(new Date(message.dateAdded), "MMM d, h:mm a")}
                </span>
            </span>

            {isOutbound && (isSMS || isWhatsApp) && (
                <span className="flex items-center gap-1 shrink-0 ml-2">
                    {whatsAppUiState && (
                        <span
                            className={cn(
                                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border font-medium max-w-[190px]",
                                toneClassName[whatsAppUiState.tone]
                            )}
                            title={whatsAppUiState.detail || whatsAppUiState.lastError || whatsAppUiState.label}
                        >
                            {whatsAppUiState.icon === "alert" && <AlertTriangle className="h-3 w-3 shrink-0" />}
                            {whatsAppUiState.icon === "clock" && <Clock className={cn("h-3 w-3 shrink-0", whatsAppUiState.showSpinner && "animate-spin")} />}
                            {whatsAppUiState.icon === "send" && <Send className="h-3 w-3 shrink-0" />}
                            {whatsAppUiState.icon === "check" && <Check className="h-3 w-3 shrink-0" />}
                            {whatsAppUiState.icon === "checkCheck" && <CheckCheck className={cn("h-3 w-3 shrink-0", whatsAppUiState.label === "Read" ? "text-blue-500" : "")} />}
                            <span className="truncate">{whatsAppUiState.detail || whatsAppUiState.label}</span>
                        </span>
                    )}
                    {!whatsAppUiState && (message.status === "sending" || message.status === "pending") && (
                        <Clock className="h-3 w-3 text-gray-400" aria-label="Sending" />
                    )}
                    {!whatsAppUiState && message.status === "sent" && (
                        <Check className="h-3 w-3 text-gray-400" aria-label="Sent" />
                    )}
                    {!whatsAppUiState && (message.status === "delivered" || message.status === "read" || message.status === "played") && (
                        <CheckCheck className={cn("h-3 w-3", message.status === "read" || message.status === "played" ? "text-blue-500" : "text-gray-400")} aria-label={message.status === "read" ? "Read" : "Delivered"} />
                    )}
                    {(!whatsAppUiState && message.status === "failed") && (
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
                    {whatsAppUiState?.canResend && onResendMessage && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onResendMessage(message.id);
                            }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 rounded transition-colors"
                        >
                            {whatsAppUiState.label === "Send not confirmed" ? "Retry message" : "Resend"}
                        </button>
                    )}
                    {whatsAppUiState && failureFallbackLabel && (
                        <span className="text-[10px] text-red-600 px-1 py-0.5 max-w-[220px] truncate" title={failureFallbackLabel}>
                            {failureFallbackLabel}
                        </span>
                    )}
                    {whatsAppUiState?.canSmsFallback && smsFallbackLabel && onSendSmsFallback && (
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
                    {whatsAppUiState && smsFallbackUnavailableLabel && (
                        <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                            {smsFallbackUnavailableLabel}
                        </span>
                    )}
                </span>
            )}
        </div>
    );
});
