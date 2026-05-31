import { useCallback, useEffect, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
    getConversationChannelCapabilities,
} from "@/app/(main)/admin/conversations/actions";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";
import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import {
    createDefaultChannelCapabilities,
    getConversationContactIdentity,
    getFirstAvailableChannel,
    unavailableChannel,
    type ConversationChannelCapabilities,
} from "@/lib/conversations/channel-capabilities";

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

export function getInitialComposerChannel(
    conversation: Conversation | null,
    options: { smsRelayEnabled?: boolean } = {},
): ComposerChannel {
    return deriveComposerInitialChannel(conversation, options);
}

interface UseConversationComposerChannelArgs {
    conversation: Conversation | null;
    isUnavailable: boolean;
    smsRelayEnabled?: boolean;
}

export function useConversationComposerChannel({
    conversation,
    isUnavailable,
    smsRelayEnabled = false,
}: UseConversationComposerChannelArgs) {
    const [selectedChannel, setSelectedChannel] = useState<ComposerChannel>(getInitialComposerChannel(conversation, { smsRelayEnabled }));
    const [capabilities, setCapabilities] = useState<ConversationChannelCapabilities>(() => {
        const defaults = createDefaultChannelCapabilities();
        if (!getConversationContactIdentity(conversation).hasEmail) {
            defaults.Email = unavailableChannel("missing_email", "Contact does not have an email address.");
        }
        return defaults;
    });
    const [whatsAppEligibility, setWhatsAppEligibility] = useState<WhatsAppEligibilityState>({ status: "checking" });
    const [smsEligibility, setSmsEligibility] = useState<SmsEligibilityState>({ status: "checking" });

    useEffect(() => {
        setSelectedChannel(getInitialComposerChannel(conversation, { smsRelayEnabled }));
    }, [conversation?.id, smsRelayEnabled]);

    useEffect(() => {
        if (!conversation?.id) {
            setSmsEligibility({ status: "unknown", reason: "No conversation selected." });
            setWhatsAppEligibility({ status: "unknown", reason: "No conversation selected." });
            setCapabilities(createDefaultChannelCapabilities());
            return;
        }

        let cancelled = false;
        setSmsEligibility({ status: "checking" });
        setWhatsAppEligibility({ status: "checking" });
        setCapabilities((prev) => ({
            ...createDefaultChannelCapabilities(),
            Email: getConversationContactIdentity(conversation).hasEmail
                ? prev.Email
                : unavailableChannel("missing_email", "Contact does not have an email address."),
        }));

        getConversationChannelCapabilities(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    if (res?.capabilities) {
                        setCapabilities(res.capabilities);
                    }
                    setSmsEligibility({ status: "unknown", reason: res?.reason });
                    setWhatsAppEligibility({ status: "unknown", reason: res?.reason });
                    return;
                }

                setCapabilities(res.capabilities);
                setSmsEligibility(
                    res.capabilities.SMS.available
                        ? { status: "eligible" }
                        : { status: "ineligible", reason: res.capabilities.SMS.label || undefined }
                );
                setWhatsAppEligibility(
                    res.capabilities.WhatsApp.available
                        ? { status: "eligible" }
                        : { status: "ineligible", reason: res.capabilities.WhatsApp.label || undefined }
                );
                setSelectedChannel((prev) => getFirstAvailableChannel(prev, res.capabilities) || prev);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check channel eligibility:", err);
                setSmsEligibility({ status: "unknown", reason: "Could not verify SMS availability." });
                setWhatsAppEligibility({ status: "unknown", reason: "Could not verify WhatsApp availability." });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation?.id, conversation?.contactEmail, conversation?.contactPhone, smsRelayEnabled]);

    const isWhatsAppDisabled = !capabilities.WhatsApp.available;
    const isSmsDisabled = !capabilities.SMS.available;
    const isSmsRelayDisabled = !capabilities.SMS_RELAY.available;
    const isEmailDisabled = !capabilities.Email.available;
    const selectedCapability = capabilities[selectedChannel];
    const channelSelectorTitle =
        selectedCapability?.available
            ? undefined
            : selectedCapability?.label || `${selectedChannel} is unavailable for this contact.`;
    const noAvailableChannelReason = getFirstAvailableChannel(selectedChannel, capabilities)
        ? null
        : "No send channel is available for this contact.";

    const selectChannel = useCallback((channel: ComposerChannel) => {
        if (isUnavailable) return;
        if (!capabilities[channel]?.available) return;
        setSelectedChannel(channel);
    }, [capabilities, isUnavailable]);

    return {
        selectedChannel,
        selectChannel,
        whatsAppEligibility,
        smsEligibility,
        isWhatsAppDisabled,
        isSmsDisabled,
        isSmsRelayDisabled,
        isEmailDisabled,
        capabilities,
        channelSelectorTitle,
        noAvailableChannelReason,
    };
}
