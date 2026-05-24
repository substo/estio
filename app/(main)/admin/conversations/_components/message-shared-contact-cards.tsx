"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Building2,
    Check,
    Download,
    ExternalLink as ExternalLinkIcon,
    MailIcon,
    MessageCirclePlus,
    Phone as PhoneIcon,
    RefreshCw,
    User,
    UserPlus,
} from "lucide-react";
import {
    checkSharedContactsSavedState,
    openOrStartConversationForContact,
    saveSharedContact,
} from "@/app/(main)/admin/contacts/actions";
import { cn } from "@/lib/utils";
import type { SharedContactInfo } from "@/lib/contacts/vcard";

type ContactSaveState = {
    saving?: boolean;
    saved?: boolean;
    contactId?: string;
    conversationId?: string;
    isNew?: boolean;
    error?: string;
};

type RouterDependency = {
    push: (href: string) => void;
    refresh: () => void;
};

interface MessageSharedContactCardsProps {
    sharedContacts: SharedContactInfo[];
    bodyVCardDownloadHref: string | null;
    isOutbound: boolean;
    messageId: string;
    locationId?: string;
    router: RouterDependency;
}

export function MessageSharedContactCards({
    sharedContacts,
    bodyVCardDownloadHref,
    isOutbound,
    messageId,
    locationId,
    router,
}: MessageSharedContactCardsProps) {
    const [contactSaveStates, setContactSaveStates] = useState<Record<number, ContactSaveState>>({});
    const [contactOpenMessageStates, setContactOpenMessageStates] = useState<Record<number, boolean>>({});
    const [isHydratingContactStates, setIsHydratingContactStates] = useState<boolean>(sharedContacts.length > 0);

    useEffect(() => {
        if (!locationId) {
            setIsHydratingContactStates(false);
            return;
        }

        if (sharedContacts.length === 0) {
            setIsHydratingContactStates(false);
            return;
        }

        const phoneNumbers = sharedContacts.map(c => c.phoneNumber).filter(Boolean) as string[];
        if (phoneNumbers.length === 0) {
            setIsHydratingContactStates(false);
            return;
        }

        let isMounted = true;
        setIsHydratingContactStates(true);
        void checkSharedContactsSavedState(locationId, phoneNumbers).then(res => {
            if (!isMounted) return;
            if (res.success && res.states) {
                setContactSaveStates(prev => {
                    const newState = { ...prev };
                    sharedContacts.forEach((c, idx) => {
                        if (c.phoneNumber && res.states![c.phoneNumber]?.saved) {
                            newState[idx] = {
                                ...newState[idx],
                                saved: true,
                                contactId: res.states![c.phoneNumber].contactId,
                                conversationId: res.states![c.phoneNumber].conversationId
                            };
                        }
                    });
                    return newState;
                });
            }
            setIsHydratingContactStates(false);
        }).catch(() => {
            if (isMounted) setIsHydratingContactStates(false);
        });

        return () => { isMounted = false; };
    }, [locationId, sharedContacts]);

    const handleSaveContact = useCallback(async (index: number, contact: SharedContactInfo) => {
        if (!locationId || contactSaveStates[index]?.saving) return;
        setContactSaveStates(prev => ({ ...prev, [index]: { saving: true } }));
        try {
            const result = await saveSharedContact({
                locationId,
                displayName: contact.displayName,
                phoneNumber: contact.phoneNumber,
                email: contact.email,
                organization: contact.organization,
            });
            if (result.success) {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: {
                        saved: true,
                        contactId: result.contactId,
                        isNew: result.isNew,
                    },
                }));
            } else {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: { error: result.error || 'Failed to save' },
                }));
            }
        } catch (err: any) {
            setContactSaveStates(prev => ({
                ...prev,
                [index]: { error: err?.message || 'Failed to save' },
            }));
        }
    }, [locationId, contactSaveStates]);

    const handleStartMessaging = useCallback(async (index: number, contactId: string) => {
        if (contactOpenMessageStates[index]) return;
        setContactOpenMessageStates(prev => ({ ...prev, [index]: true }));
        try {
            const res = await openOrStartConversationForContact(contactId);
            if (res?.success && res.conversationId) {
                router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
                router.refresh();
            } else {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: { ...prev[index], error: res?.error || 'Failed to open message' }
                }));
            }
        } catch (err: any) {
            setContactSaveStates(prev => ({
                ...prev,
                [index]: { ...prev[index], error: err.message || 'Error occurred' }
            }));
        } finally {
            setContactOpenMessageStates(prev => ({ ...prev, [index]: false }));
        }
    }, [contactOpenMessageStates, router]);

    return (
        <div className="space-y-2">
            {sharedContacts.map((contact, idx) => {
                const state = contactSaveStates[idx];
                return (
                    <div
                        key={`contact-${idx}-${contact.displayName}`}
                        className={cn(
                            "rounded-lg border p-3 space-y-2",
                            isOutbound
                                ? "border-white/20 bg-white/10"
                                : "border-gray-200 bg-gray-50"
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <div className={cn(
                                "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                                isOutbound ? "bg-white/20" : "bg-blue-100"
                            )}>
                                <User className={cn(
                                    "h-4 w-4",
                                    isOutbound ? "text-white" : "text-blue-600"
                                )} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className={cn(
                                    "font-semibold text-sm truncate",
                                    isOutbound ? "text-white" : "text-gray-900"
                                )}>
                                    {contact.displayName}
                                </p>
                                {contact.organization && (
                                    <p className={cn(
                                        "text-[11px] truncate flex items-center gap-1",
                                        isOutbound ? "text-blue-100" : "text-gray-500"
                                    )}>
                                        <Building2 className="h-3 w-3 shrink-0" />
                                        {contact.organization}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-1">
                            {contact.phoneNumber && (
                                <a
                                    href={`tel:${contact.phoneNumber}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                        "flex items-center gap-2 text-xs rounded px-2 py-1 transition-colors",
                                        isOutbound
                                            ? "text-blue-100 hover:bg-white/10"
                                            : "text-gray-600 hover:bg-gray-100"
                                    )}
                                >
                                    <PhoneIcon className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{contact.phoneNumber}</span>
                                </a>
                            )}
                            {contact.email && (
                                <a
                                    href={`mailto:${contact.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                        "flex items-center gap-2 text-xs rounded px-2 py-1 transition-colors",
                                        isOutbound
                                            ? "text-blue-100 hover:bg-white/10"
                                            : "text-gray-600 hover:bg-gray-100"
                                    )}
                                >
                                    <MailIcon className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{contact.email}</span>
                                </a>
                            )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            {isHydratingContactStates ? (
                                <div className={cn("flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium", isOutbound ? "text-white/70" : "text-muted-foreground")}>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Checking...
                                </div>
                            ) : state?.saved ? (
                                <>
                                    <span className={cn(
                                        "flex items-center gap-1 text-[11px] font-medium",
                                        isOutbound ? "text-emerald-200" : "text-emerald-600"
                                    )}>
                                        <Check className="h-3 w-3" />
                                        {state.isNew ? "Saved" : "Already exists"}
                                    </span>
                                    {state.contactId && (
                                        <a
                                            href={`/admin/contacts/${state.contactId}/view`}
                                            onClick={(e) => e.stopPropagation()}
                                            className={cn(
                                                "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                isOutbound
                                                    ? "bg-white/20 text-white hover:bg-white/30"
                                                    : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                            )}
                                        >
                                            <ExternalLinkIcon className="h-3 w-3" />
                                            Open Contact
                                        </a>
                                    )}
                                    {state.contactId && (
                                        state.conversationId ? (
                                            <a
                                                href={`/admin/conversations?id=${encodeURIComponent(state.conversationId)}`}
                                                onClick={(e) => e.stopPropagation()}
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                    isOutbound
                                                        ? "bg-white/20 text-white hover:bg-white/30"
                                                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                                )}
                                            >
                                                <MessageCirclePlus className="h-3 w-3" />
                                                Send Message
                                            </a>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleStartMessaging(idx, state.contactId!);
                                                }}
                                                disabled={contactOpenMessageStates[idx]}
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                    isOutbound
                                                        ? "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60"
                                                        : "bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                                                )}
                                            >
                                                <MessageCirclePlus className="h-3 w-3" />
                                                {contactOpenMessageStates[idx] ? "Opening..." : "Send Message"}
                                            </button>
                                        )
                                    )}
                                </>
                            ) : state?.error ? (
                                <span className={cn(
                                    "text-[11px]",
                                    isOutbound ? "text-red-200" : "text-red-600"
                                )}>
                                    {state.error}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleSaveContact(idx, contact);
                                    }}
                                    disabled={state?.saving || !locationId}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                                        isOutbound
                                            ? "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60"
                                            : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                    )}
                                >
                                    <UserPlus className="h-3 w-3" />
                                    {state?.saving ? "Saving..." : "Save to Contacts"}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
            {bodyVCardDownloadHref && (
                <a
                    href={bodyVCardDownloadHref}
                    download={`shared-contact-${messageId}.vcf`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                        isOutbound
                            ? "bg-white/15 text-white hover:bg-white/25"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    )}
                >
                    <Download className="h-3 w-3" />
                    Download vCard
                </a>
            )}
        </div>
    );
}
