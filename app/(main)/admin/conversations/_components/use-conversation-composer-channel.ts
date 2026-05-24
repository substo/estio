import { useCallback, useEffect, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
    getSmsChannelEligibility,
    getWhatsAppChannelEligibility,
} from "@/app/(main)/admin/conversations/actions";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";

export type WhatsAppEligibilityState =
    | { status: "checking" }
    | { status: "eligible" }
    | { status: "ineligible"; reason?: string }
    | { status: "unknown"; reason?: string };

export type SmsEligibilityState =
    | { status: "checking" }
    | { status: "eligible" }
    | { status: "ineligible"; reason?: string }
    | { status: "unknown"; reason?: string };

function getInitialChannel(conversation: Conversation | null): ComposerChannel {
    const typeUpper = (conversation?.lastMessageType || conversation?.type || "").toUpperCase();
    if (typeUpper.includes("EMAIL")) return "Email";
    if (typeUpper.includes("WHATSAPP")) return "WhatsApp";
    return "SMS";
}

function getFallbackChannelWithoutWhatsApp(conversation: Conversation | null): "SMS" | "Email" {
    return getInitialChannel(conversation) === "Email" ? "Email" : "SMS";
}

interface UseConversationComposerChannelArgs {
    conversation: Conversation | null;
    isUnavailable: boolean;
}

export function useConversationComposerChannel({
    conversation,
    isUnavailable,
}: UseConversationComposerChannelArgs) {
    const [selectedChannel, setSelectedChannel] = useState<ComposerChannel>(getInitialChannel(conversation));
    const [whatsAppEligibility, setWhatsAppEligibility] = useState<WhatsAppEligibilityState>({ status: "checking" });
    const [smsEligibility, setSmsEligibility] = useState<SmsEligibilityState>({ status: "checking" });

    useEffect(() => {
        setSelectedChannel(getInitialChannel(conversation));
    }, [conversation?.id]);

    useEffect(() => {
        if (!conversation?.id) {
            setWhatsAppEligibility({ status: "unknown", reason: "No conversation selected." });
            return;
        }

        let cancelled = false;
        setWhatsAppEligibility({ status: "checking" });

        getWhatsAppChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setWhatsAppEligibility({ status: "unknown", reason: res?.reason });
                    return;
                }

                if (res.status === "eligible") {
                    setWhatsAppEligibility({ status: "eligible" });
                    return;
                }

                if (res.status === "ineligible") {
                    setWhatsAppEligibility({ status: "ineligible", reason: res.reason });
                    setSelectedChannel((prev) => (prev === "WhatsApp" ? getFallbackChannelWithoutWhatsApp(conversation) : prev));
                    return;
                }

                setWhatsAppEligibility({ status: "unknown", reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check WhatsApp eligibility:", err);
                setWhatsAppEligibility({ status: "unknown", reason: "Could not verify WhatsApp availability." });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation?.id]);

    useEffect(() => {
        if (!conversation?.id) {
            setSmsEligibility({ status: "unknown", reason: "No conversation selected." });
            return;
        }

        let cancelled = false;
        setSmsEligibility({ status: "checking" });

        getSmsChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setSmsEligibility({ status: "unknown", reason: res?.reason });
                    return;
                }

                if (res.status === "eligible") {
                    setSmsEligibility({ status: "eligible" });
                    return;
                }

                if (res.status === "ineligible") {
                    setSmsEligibility({ status: "ineligible", reason: res.reason });
                    setSelectedChannel((prev) => (prev === "SMS" ? "Email" : prev));
                    return;
                }

                setSmsEligibility({ status: "unknown", reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check SMS eligibility:", err);
                setSmsEligibility({ status: "unknown", reason: "Could not verify SMS availability." });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation?.id]);

    const isWhatsAppDisabled = whatsAppEligibility.status === "ineligible";
    const isSmsDisabled = smsEligibility.status === "ineligible";
    const channelSelectorTitle =
        selectedChannel === "SMS" && isSmsDisabled
            ? (smsEligibility.reason || "SMS not available for this contact")
            : isWhatsAppDisabled
                ? (whatsAppEligibility.reason || "WhatsApp not available for this contact")
                : undefined;

    const selectChannel = useCallback((channel: ComposerChannel) => {
        if (isUnavailable) return;
        if (channel === "SMS" && isSmsDisabled) return;
        if (channel === "WhatsApp" && isWhatsAppDisabled) return;
        setSelectedChannel(channel);
    }, [isSmsDisabled, isUnavailable, isWhatsAppDisabled]);

    return {
        selectedChannel,
        selectChannel,
        whatsAppEligibility,
        smsEligibility,
        isWhatsAppDisabled,
        isSmsDisabled,
        channelSelectorTitle,
    };
}
