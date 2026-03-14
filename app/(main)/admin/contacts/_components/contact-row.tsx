"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Link as LinkIcon, Link2, MessageCircle, MessageCirclePlus, RefreshCw } from "lucide-react";
import { GoogleSyncManager } from "./google-sync-manager";
import { EditContactDialog } from "./edit-contact-dialog";
import { ContactData } from "./contact-form";
import { openOrStartConversationForContact } from "../actions";
import { LeadSourceBadge } from "./lead-source-badge";
import { LeadScoreBadge } from "./lead-score-badge";

interface ContactRowProps {
    contact: ContactData & {
        createdAt: Date;
        updatedAt: Date;
        propertyRoles: any[];
        companyRoles: any[];
        heatScore: number;
        status: string;
        googleContactId?: string | null;
        lastGoogleSync?: Date | null;
        error?: string | null;
        conversations?: Array<{
            ghlConversationId: string;
            unreadCount: number;
            deletedAt?: Date | null;
            archivedAt?: Date | null;
            lastMessageAt?: Date | null;
        }>;
    };
    leadSources: string[];
    // For navigation in Google Sync Manager
    // For navigation in Google Sync Manager
    allContacts?: ContactData[];
    currentIndex?: number;
    isGoogleConnected?: boolean;
    isGhlConnected?: boolean;
}

export function ContactRow({ contact, leadSources, allContacts, currentIndex, isGoogleConnected = false, isGhlConnected = false }: ContactRowProps) {
    const router = useRouter();
    const [managerOpen, setManagerOpen] = useState(false);
    const [isOpeningConversation, startConversationTransition] = useTransition();
    const [conversationError, setConversationError] = useState<string | null>(null);

    const handleRowClick = (e: React.MouseEvent) => {
        // Prevent navigation if clicking buttons or interactions
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a') || (e.target as HTMLElement).closest('[role="dialog"]')) {
            return;
        }
        router.push(`/admin/contacts/${contact.id}/view`);
    };

    const isLinked = !!contact.googleContactId;
    const hasError = !!contact.error;
    const conversation = contact.conversations?.[0];
    const hasConversation = !!conversation?.ghlConversationId;
    const canStartConversation = !!contact.phone;
    const getConversationHref = (ghlConversationId: string) => {
        const params = new URLSearchParams({
            id: ghlConversationId,
        });

        if (conversation?.deletedAt) {
            params.set("view", "trash");
        } else if (conversation?.archivedAt) {
            params.set("view", "archived");
        }

        return `/admin/conversations?${params.toString()}`;
    };
    // Add 2 second buffer to ignore micro-differences (race condition fixes)
    const isOutOfSync = isLinked && !hasError && contact.lastGoogleSync &&
        (new Date(contact.updatedAt).getTime() > new Date(contact.lastGoogleSync).getTime() + 2000);

    const handleConversationClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConversationError(null);

        if (hasConversation && conversation?.ghlConversationId) {
            router.push(getConversationHref(conversation.ghlConversationId));
            return;
        }

        if (!canStartConversation || isOpeningConversation) return;

        startConversationTransition(async () => {
            const res = await openOrStartConversationForContact(contact.id);
            if (res?.success && res.conversationId) {
                router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
                router.refresh();
                return;
            }
            setConversationError(res?.error || "Failed to open conversation");
        });
    };

    return (
        <>
            <tr onClick={handleRowClick} className="border-t hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors">


                <td className="p-4">
                <div className="flex flex-col gap-1">
                    <span>{format(new Date(contact.createdAt), "dd/MM/yyyy")}</span>
                    {contact.leadSource && (
                        <LeadSourceBadge source={contact.leadSource} />
                    )}
                </div>
            </td>
                <td className="p-4 font-medium">{contact.name || "Unknown"}</td>
                <td className="p-4">
                    <div className="flex flex-col">
                        <span>{contact.email}</span>
                        <span className="text-xs text-gray-500">{contact.phone}</span>
                    </div>
                </td>
                <td className="p-4">
                    <div className="flex flex-col gap-1">
                        {(contact.propertyRoles.length === 0 && contact.companyRoles.length === 0) ? (
                            <span className="text-gray-500 italic">General Inquiry</span>
                        ) : (
                            <>
                                {contact.propertyRoles.map((r, i) => (
                                    <span key={`prop-${i}`} className="text-xs">
                                        <span className="font-semibold capitalize">{r.role}:</span> {r.property.title}
                                    </span>
                                ))}
                                {contact.companyRoles.map((r, i) => (
                                    <span key={`comp-${i}`} className="text-xs">
                                        <span className="font-semibold capitalize">{r.role}:</span> {r.company.name}
                                    </span>
                                ))}
                            </>
                        )}
                    </div>
                </td>
                <td className="p-4">
                    <div className="flex flex-col items-center gap-0.5 w-[fit-content]">
                        <LeadScoreBadge score={contact.leadScore ?? 0} />
                        {contact.qualificationStage && (
                        <span className="text-[10px] text-muted-foreground uppercase">
                            {contact.qualificationStage.replace('_', ' ')}
                        </span>
                        )}
                    </div>
                </td>
                <td className="p-4">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${contact.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {contact.status}
                        </span>

                        {/* Google Sync Status Icon */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 ${hasError
                                ? "text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
                                : isOutOfSync
                                    ? "text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                                    : isLinked
                                        ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                }`}
                            onClick={(e) => { e.stopPropagation(); setManagerOpen(true); }}
                            title={hasError ? contact.error! : isOutOfSync ? "Out of Sync (Local changes pending)" : isLinked ? "Linked to Google" : "Not Linked - Click to Add"}
                        >
                            {hasError ? (
                                <AlertTriangle className="h-4 w-4" />
                            ) : isOutOfSync ? (
                                <RefreshCw className="h-4 w-4" />
                            ) : isLinked ? (
                                <LinkIcon className="h-4 w-4" />
                            ) : (
                                <Link2 className="h-4 w-4 opacity-50" />
                            )}
                        </Button>
                    </div>
                </td>
                <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                        <TooltipProvider delayDuration={200}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 relative"
                                        onClick={handleConversationClick}
                                        disabled={isOpeningConversation || (!hasConversation && !canStartConversation)}
                                        aria-label={hasConversation ? "Open conversation" : "Start conversation"}
                                    >
                                        {hasConversation ? (
                                            <>
                                                <MessageCircle className="h-4 w-4" />
                                                {!!conversation?.unreadCount && conversation.unreadCount > 0 && (
                                                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-600 text-white text-[10px] leading-[14px] text-center">
                                                        {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <MessageCirclePlus className={`h-4 w-4 ${canStartConversation ? "text-green-600" : "text-gray-400"}`} />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {hasConversation
                                        ? `Open conversation${conversation && conversation.unreadCount > 0 ? ` (${conversation.unreadCount} unread)` : ""}`
                                        : canStartConversation
                                            ? "Start conversation"
                                            : "No phone number to start conversation"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        {hasConversation ? (
                            <Link
                                href={getConversationHref(conversation!.ghlConversationId)}
                                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Open
                            </Link>
                        ) : (
                            <span className={`text-xs ${canStartConversation ? "text-muted-foreground" : "text-gray-400"}`}>
                                {isOpeningConversation ? "Creating..." : canStartConversation ? "Start" : "No phone"}
                            </span>
                        )}
                    </div>
                    {conversationError && (
                        <p className="mt-1 text-[11px] text-red-600">{conversationError}</p>
                    )}
                </td>
                <td className="p-4" onClick={(e) => e.stopPropagation()} >
                    {/* Explicit stop propagation for the action cell */}
                    <EditContactDialog
                        contact={contact}
                        leadSources={leadSources}
                        isGoogleConnected={isGoogleConnected}
                        isGhlConnected={isGhlConnected}
                    />
                </td>
            </tr>
            {/* Render Manager outside of tr */}
            {managerOpen && (
                <GoogleSyncManager
                    contact={allContacts ? undefined : contact}
                    contacts={allContacts as any}
                    initialIndex={currentIndex}
                    open={managerOpen}
                    onOpenChange={setManagerOpen}
                />
            )}
        </>
    );
}
