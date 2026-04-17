import type { Conversation, Message, MessageTranslationState, MessageTranslationVariant } from "@/lib/ghl/conversations";

function normalizeLanguageTag(language: string | null | undefined) {
    return String(language || "").trim().toLowerCase();
}

function getPrimaryLanguageSubtag(language: string | null | undefined) {
    const normalized = normalizeLanguageTag(language);
    if (!normalized) return "";
    return normalized.split("-")[0] || normalized;
}

export function getResolvedConversationTranslationLanguage(conversation: Pick<Conversation, "replyLanguageOverride" | "locationDefaultReplyLanguage"> | null | undefined) {
    return String(
        conversation?.replyLanguageOverride
        || conversation?.locationDefaultReplyLanguage
        || "en"
    ).trim();
}

export function selectActiveTranslation(
    translations: MessageTranslationVariant[],
    targetLanguage: string | null | undefined
) {
    const normalizedTarget = normalizeLanguageTag(targetLanguage);
    if (!translations.length) return null;
    const exact = normalizedTarget
        ? translations.find((entry) => normalizeLanguageTag(entry.targetLanguage) === normalizedTarget)
        : null;
    if (exact) return exact;

    const primaryTarget = getPrimaryLanguageSubtag(normalizedTarget);
    const primary = primaryTarget
        ? translations.find((entry) => getPrimaryLanguageSubtag(entry.targetLanguage) === primaryTarget)
        : null;
    return primary || translations[0] || null;
}

export function getMessageTranslationViewDefault(
    message: Pick<Message, "direction" | "detectedLanguage" | "detectedLanguageConfidence">,
    activeTranslation: MessageTranslationVariant | null,
    targetLanguage: string | null | undefined
): "original" | "translated" {
    if (!activeTranslation) return "original";
    if (message.direction !== "inbound") return "original";

    const sourceLanguage = normalizeLanguageTag(
        activeTranslation.sourceLanguage
        || message.detectedLanguage
    );
    const targetPrimary = getPrimaryLanguageSubtag(targetLanguage);
    const sourcePrimary = getPrimaryLanguageSubtag(sourceLanguage);

    if (sourcePrimary && targetPrimary && sourcePrimary !== targetPrimary) {
        return "translated";
    }

    if (!sourcePrimary && Number(message.detectedLanguageConfidence || 0) >= 0.6) {
        return "translated";
    }

    return "original";
}

export function buildMessageTranslationState(
    message: Pick<Message, "direction" | "detectedLanguage" | "detectedLanguageConfidence">,
    translations: MessageTranslationVariant[],
    targetLanguage: string | null | undefined
): MessageTranslationState {
    const active = selectActiveTranslation(translations, targetLanguage);
    return {
        active,
        available: translations,
        viewDefault: getMessageTranslationViewDefault(message, active, targetLanguage),
    };
}

export function isLikelyForeignLanguageMessage(
    message: Pick<Message, "direction" | "body" | "detectedLanguage">,
    targetLanguage: string | null | undefined
) {
    if (message.direction !== "inbound") return false;
    const body = String(message.body || "").trim();
    if (!body) return false;

    const detectedPrimary = getPrimaryLanguageSubtag(message.detectedLanguage);
    const targetPrimary = getPrimaryLanguageSubtag(targetLanguage);
    if (detectedPrimary && targetPrimary && detectedPrimary !== targetPrimary) {
        return true;
    }

    const nonAsciiChars = body.replace(/[ -~]/g, "");
    if (nonAsciiChars.length >= 4) return true;

    return /\b(hola|bonjour|ciao|merci|gracias|buenos|ola|γειά|привет|salut|buenas)\b/i.test(body);
}

export function shouldDefaultThreadToTranslated(
    messages: Array<Pick<Message, "direction" | "body" | "detectedLanguage" | "translation" | "translations">>,
    targetLanguage: string | null | undefined
) {
    const inboundForeignCount = messages.filter((message) => isLikelyForeignLanguageMessage(message, targetLanguage)).length;
    if (inboundForeignCount < 2) return false;

    return messages.some((message) => message.translation?.viewDefault === "translated");
}
