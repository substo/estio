import {
    parseSharedContactsFromMessageBody,
    parseVCardContacts,
    type SharedContactInfo,
} from "@/lib/contacts/vcard";

export type MessageAttachment = string | NormalizedMessageAttachment;

export type NormalizedMessageAttachment = {
    id?: string;
    url: string;
    mimeType?: string | null;
    fileName?: string | null;
    sharedContacts?: SharedContactInfo[] | null;
    transcript?: {
        status: "pending" | "processing" | "completed" | "failed";
        text?: string | null;
        error?: string | null;
        model?: string | null;
        provider?: string | null;
        updatedAt?: string | null;
        restricted?: boolean;
        extraction?: {
            status: "pending" | "processing" | "completed" | "failed";
            payload?: {
                prospects?: string[];
                requirements?: string[];
                budget?: string | null;
                locations?: string[];
                objections?: string[];
                nextActions?: string[];
            } | null;
            error?: string | null;
            model?: string | null;
            provider?: string | null;
            updatedAt?: string | null;
            restricted?: boolean;
        } | null;
    } | null;
};

export type ClassifiedMessageAttachments = {
    imageAttachments: NormalizedMessageAttachment[];
    audioAttachments: NormalizedMessageAttachment[];
    contactAttachments: NormalizedMessageAttachment[];
    fileAttachments: NormalizedMessageAttachment[];
};

export type WebBridgeMediaState = {
    status?: string | null;
    reason?: string | null;
    error?: string | null;
    meta?: {
        mimetype?: string | null;
        filename?: string | null;
        size?: number | null;
        type?: string | null;
        caption?: string | null;
        attemptedDownload?: boolean | null;
        inlined?: boolean | null;
    } | null;
    refetch?: {
        attemptId?: string | null;
        status?: string | null;
        stage?: string | null;
        message?: string | null;
        error?: string | null;
        updatedAt?: string | null;
        finishedAt?: string | null;
    } | null;
    updatedAt?: string | null;
} | null;

export type MediaUnavailableInput = {
    isWhatsApp: boolean;
    source?: string | null;
    webBridgeMedia?: WebBridgeMediaState;
    attachments: NormalizedMessageAttachment[];
};

export function normalizeMessageAttachments(attachments?: MessageAttachment[] | null): NormalizedMessageAttachment[] {
    return (attachments || []).map((attachment) =>
        typeof attachment === "string"
            ? { id: undefined, url: attachment, mimeType: undefined, fileName: undefined, sharedContacts: null, transcript: null }
            : attachment
    );
}

export function deriveSharedContactsFromMessageBody(body?: string | null): SharedContactInfo[] {
    return parseSharedContactsFromMessageBody(body || "");
}

export function deriveBodyVCardDownloadHref(body?: string | null): string | null {
    const value = String(body || "");
    if (parseVCardContacts(value).length === 0) return null;
    return `data:text/vcard;charset=utf-8,${encodeURIComponent(value)}`;
}

export function classifyMessageAttachments(attachments: NormalizedMessageAttachment[]): ClassifiedMessageAttachments {
    const imageAttachments = attachments.filter((attachment) => {
        const mimeType = (attachment.mimeType || "").toLowerCase();
        if (mimeType.startsWith("image/")) return true;

        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"].some((ext) => target.endsWith(ext));
    });

    const audioAttachments = attachments.filter((attachment) => {
        const mimeType = (attachment.mimeType || "").toLowerCase();
        if (mimeType.startsWith("audio/")) return true;

        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return [".ogg", ".opus", ".mp3", ".m4a", ".webm", ".wav", ".aac"].some((ext) => target.endsWith(ext));
    });

    const contactAttachments = attachments.filter((attachment) => {
        if ((attachment.sharedContacts || []).length > 0) return true;
        const mimeType = (attachment.mimeType || "").split(";")[0].trim().toLowerCase();
        if (["text/vcard", "text/x-vcard", "text/directory"].includes(mimeType)) return true;
        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return target.endsWith(".vcf") || target.endsWith(".vcard");
    });

    const fileAttachments = attachments.filter((attachment) =>
        !imageAttachments.includes(attachment) && !audioAttachments.includes(attachment) && !contactAttachments.includes(attachment)
    );

    return {
        imageAttachments,
        audioAttachments,
        contactAttachments,
        fileAttachments,
    };
}

export function deriveMediaUnavailableState({
    isWhatsApp,
    source,
    webBridgeMedia,
    attachments,
}: MediaUnavailableInput): boolean {
    return isWhatsApp
        && String(source || "") === "whatsapp_web_bridge"
        && !!webBridgeMedia
        && webBridgeMedia.status !== "stored"
        && attachments.length === 0;
}
