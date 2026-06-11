import {
    DEFAULT_REPLY_LANGUAGE,
    getReplyLanguageLabel,
    normalizeReplyLanguage,
} from "@/lib/ai/reply-language-options";
import { detectLanguageFromText } from "@/lib/ai/prompts/communication-policy";

export type ConversationLanguageSource =
    | "conversation_override"
    | "contact_preferred"
    | "latest_inbound"
    | "conversation_current"
    | "thread_default"
    | "location_default"
    | "fallback"
    | "unknown";

export interface ConversationLanguageContextInput {
    manualOverrideLanguage?: string | null;
    contactPreferredLanguage?: string | null;
    conversationCurrentLanguage?: string | null;
    latestInboundText?: string | null;
    threadText?: string | null;
    locationDefaultLanguage?: string | null;
    agentWorkingLanguage?: string | null;
    fallbackLanguage?: string | null;
}

export interface ConversationLanguageContext {
    appUiLanguage: string;
    agentWorkingLanguage: string;
    customerPreferredLanguage: string | null;
    conversationCurrentLanguage: string | null;
    latestInboundLanguage: string | null;
    threadDefaultLanguage: string | null;
    locationDefaultLanguage: string | null;
    sendLanguage: string;
    sendLanguageSource: ConversationLanguageSource;
    viewLanguage: string;
    viewLanguageSource: "agent_working" | "fallback";
    sendLanguageLabel: string;
    viewLanguageLabel: string;
}

function normalizeLanguage(value: string | null | undefined): string | null {
    return normalizeReplyLanguage(value);
}

function labelLanguage(language: string | null | undefined, fallback: string): string {
    return getReplyLanguageLabel(language) || String(language || "").trim() || fallback;
}

export function getPrimaryLanguage(language: string | null | undefined): string | null {
    const normalized = normalizeLanguage(language);
    if (!normalized) return null;
    return normalized.split("-")[0] || normalized;
}

export function languagesMatch(
    left: string | null | undefined,
    right: string | null | undefined
): boolean {
    const leftPrimary = getPrimaryLanguage(left);
    const rightPrimary = getPrimaryLanguage(right);
    return !!leftPrimary && !!rightPrimary && leftPrimary === rightPrimary;
}

export function resolveConversationLanguageContext(
    input: ConversationLanguageContextInput = {}
): ConversationLanguageContext {
    const appUiLanguage = DEFAULT_REPLY_LANGUAGE;
    const fallbackLanguage = normalizeLanguage(input.fallbackLanguage) || DEFAULT_REPLY_LANGUAGE;
    const agentWorkingLanguage = normalizeLanguage(input.agentWorkingLanguage) || fallbackLanguage;
    const customerPreferredLanguage = normalizeLanguage(input.contactPreferredLanguage);
    const storedConversationCurrentLanguage = normalizeLanguage(input.conversationCurrentLanguage);
    const latestInboundLanguage = normalizeLanguage(detectLanguageFromText(input.latestInboundText));
    const threadDefaultLanguage = normalizeLanguage(detectLanguageFromText(input.threadText));
    const locationDefaultLanguage = normalizeLanguage(input.locationDefaultLanguage);
    const manualOverrideLanguage = normalizeLanguage(input.manualOverrideLanguage);

    const conversationCurrentLanguage =
        storedConversationCurrentLanguage ||
        latestInboundLanguage ||
        threadDefaultLanguage ||
        null;

    let sendLanguage = fallbackLanguage;
    let sendLanguageSource: ConversationLanguageSource = "fallback";

    if (manualOverrideLanguage) {
        sendLanguage = manualOverrideLanguage;
        sendLanguageSource = "conversation_override";
    } else if (customerPreferredLanguage) {
        sendLanguage = customerPreferredLanguage;
        sendLanguageSource = "contact_preferred";
    } else if (latestInboundLanguage) {
        sendLanguage = latestInboundLanguage;
        sendLanguageSource = "latest_inbound";
    } else if (storedConversationCurrentLanguage) {
        sendLanguage = storedConversationCurrentLanguage;
        sendLanguageSource = "conversation_current";
    } else if (threadDefaultLanguage) {
        sendLanguage = threadDefaultLanguage;
        sendLanguageSource = "thread_default";
    } else if (locationDefaultLanguage) {
        sendLanguage = locationDefaultLanguage;
        sendLanguageSource = "location_default";
    }

    return {
        appUiLanguage,
        agentWorkingLanguage,
        customerPreferredLanguage,
        conversationCurrentLanguage,
        latestInboundLanguage,
        threadDefaultLanguage,
        locationDefaultLanguage,
        sendLanguage,
        sendLanguageSource,
        viewLanguage: agentWorkingLanguage,
        viewLanguageSource: input.agentWorkingLanguage ? "agent_working" : "fallback",
        sendLanguageLabel: labelLanguage(sendLanguage, sendLanguage),
        viewLanguageLabel: labelLanguage(agentWorkingLanguage, agentWorkingLanguage),
    };
}

export function getConversationLanguageSourceLabel(source: ConversationLanguageSource): string {
    switch (source) {
        case "conversation_override":
            return "Conversation override";
        case "contact_preferred":
            return "Contact preferred language";
        case "latest_inbound":
            return "Latest inbound language";
        case "conversation_current":
            return "Conversation current language";
        case "thread_default":
            return "Thread language";
        case "location_default":
            return "Location default";
        case "fallback":
            return "Fallback";
        default:
            return "Unknown";
    }
}
