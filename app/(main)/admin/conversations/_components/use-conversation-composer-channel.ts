import { useCallback, useEffect, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
    getConversationChannelCapabilities,
} from "@/app/(main)/admin/conversations/actions";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";
import { deriveComposerInitialChannel } from "@/lib/conversations/channel-summary";
import {
    availableChannel,
    createDefaultChannelCapabilities,
    getConversationContactIdentity,
    getFirstAvailableChannel,
    unavailableChannel,
    type ConversationChannelCapabilities,
} from "@/lib/conversations/channel-capabilities";

const CHANNEL_CAPABILITY_CACHE_PREFIX = "estio:conversation-channel-capabilities:v1";
const CHANNEL_CAPABILITY_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

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

type CachedConversationChannelCapabilities = {
    savedAt: number;
    capabilities: ConversationChannelCapabilities;
};

function getDefaultCapabilitiesForConversation(conversation: Conversation | null): ConversationChannelCapabilities {
    const defaults = createDefaultChannelCapabilities();
    if (!getConversationContactIdentity(conversation).hasEmail) {
        defaults.Email = unavailableChannel("missing_email", "Contact does not have an email address.");
    }
    return defaults;
}

export function deriveProvisionalConversationChannelCapabilities(
    conversation: Conversation | null,
    options: { smsRelayEnabled?: boolean } = {}
): ConversationChannelCapabilities {
    const capabilities = getDefaultCapabilitiesForConversation(conversation);
    const identity = getConversationContactIdentity(conversation);

    if (identity.hasEmail) {
        capabilities.Email = availableChannel();
    }

    if (identity.hasPhone && options.smsRelayEnabled) {
        capabilities.SMS_RELAY = availableChannel();
    }

    const hasActualLatestWhatsAppMessage = !!conversation?.lastMessageId
        && conversation.lastMessageChannel === "WhatsApp";
    if (hasActualLatestWhatsAppMessage) {
        capabilities.WhatsApp = availableChannel();
    }

    return capabilities;
}

export function buildConversationChannelCapabilityCacheKey(
    conversation: Conversation | null | undefined,
    options: { smsRelayEnabled?: boolean } = {}
): string | null {
    if (!conversation?.id) return null;
    const phone = String(conversation.contactPhone || "").replace(/\D/g, "");
    const email = String(conversation.contactEmail || "").trim().toLowerCase();
    return [
        CHANNEL_CAPABILITY_CACHE_PREFIX,
        conversation.id,
        phone || "no-phone",
        email || "no-email",
        options.smsRelayEnabled ? "relay-on" : "relay-off",
    ].join(":");
}

export function isConversationChannelCapabilityCacheFresh(
    savedAt: number,
    now = Date.now(),
    maxAgeMs = CHANNEL_CAPABILITY_CACHE_MAX_AGE_MS
): boolean {
    return Number.isFinite(savedAt) && savedAt > 0 && now - savedAt <= maxAgeMs;
}

function getSessionStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    return window.sessionStorage || null;
}

function readCachedCapabilities(cacheKey: string | null): ConversationChannelCapabilities | null {
    if (!cacheKey) return null;
    try {
        const raw = getSessionStorage()?.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedConversationChannelCapabilities;
        if (!isConversationChannelCapabilityCacheFresh(parsed.savedAt)) return null;
        if (!parsed.capabilities?.WhatsApp || !parsed.capabilities?.SMS_RELAY) return null;
        return parsed.capabilities;
    } catch {
        return null;
    }
}

function writeCachedCapabilities(cacheKey: string | null, capabilities: ConversationChannelCapabilities) {
    if (!cacheKey) return;
    try {
        getSessionStorage()?.setItem(cacheKey, JSON.stringify({
            savedAt: Date.now(),
            capabilities,
        } satisfies CachedConversationChannelCapabilities));
    } catch {
        // Session storage is an optional UX cache.
    }
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
    const [capabilities, setCapabilities] = useState<ConversationChannelCapabilities>(() =>
        readCachedCapabilities(buildConversationChannelCapabilityCacheKey(conversation, { smsRelayEnabled }))
        || deriveProvisionalConversationChannelCapabilities(conversation, { smsRelayEnabled })
    );
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
        const cacheKey = buildConversationChannelCapabilityCacheKey(conversation, { smsRelayEnabled });
        const cachedCapabilities = readCachedCapabilities(cacheKey);
        const provisionalCapabilities = deriveProvisionalConversationChannelCapabilities(conversation, { smsRelayEnabled });
        if (cachedCapabilities) {
            setCapabilities(cachedCapabilities);
            setSmsEligibility(
                cachedCapabilities.SMS.available || cachedCapabilities.SMS_RELAY.available
                    ? { status: "eligible" }
                    : { status: "ineligible", reason: cachedCapabilities.SMS.label || cachedCapabilities.SMS_RELAY.label || undefined }
            );
            setWhatsAppEligibility(
                cachedCapabilities.WhatsApp.available
                    ? { status: "eligible" }
                    : { status: "ineligible", reason: cachedCapabilities.WhatsApp.label || undefined }
            );
            setSelectedChannel((prev) => getFirstAvailableChannel(prev, cachedCapabilities) || prev);
        } else {
            setSmsEligibility({ status: "checking" });
            setWhatsAppEligibility({ status: "checking" });
            setCapabilities(provisionalCapabilities);
            setSelectedChannel((prev) => getFirstAvailableChannel(prev, provisionalCapabilities) || prev);
        }

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

                writeCachedCapabilities(cacheKey, res.capabilities);
                setCapabilities(res.capabilities);
                setSmsEligibility(
                    res.capabilities.SMS.available || res.capabilities.SMS_RELAY.available
                        ? { status: "eligible" }
                        : { status: "ineligible", reason: res.capabilities.SMS.label || res.capabilities.SMS_RELAY.label || undefined }
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
                if (cachedCapabilities) return;
                if (getFirstAvailableChannel("SMS", provisionalCapabilities)) return;
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
    const hasPendingChannelVerification = Object.values(capabilities).some((capability) =>
        capability.status === "checking"
    );
    const noAvailableChannelReason = getFirstAvailableChannel(selectedChannel, capabilities) || hasPendingChannelVerification
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
