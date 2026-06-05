import { parsePropertyUrls } from "./property-message-url-client";

export type MessageLinkPreviewCandidate = {
    url: string;
    overflowCount: number;
};

export function getMessageLinkPreviewCandidate(args: {
    body?: string | null;
    isEmail?: boolean;
    isContactMessage?: boolean;
    hasRenderableMediaAttachment?: boolean;
}): MessageLinkPreviewCandidate | null {
    if (args.isEmail || args.isContactMessage || args.hasRenderableMediaAttachment) return null;
    const parsed = parsePropertyUrls(String(args.body || ""), 2);
    if (!parsed.urls.length) return null;
    return {
        url: parsed.urls[0],
        overflowCount: parsed.overflowCount + Math.max(0, parsed.urls.length - 1),
    };
}

export function getPreviewHost(url: string | null | undefined): string {
    try {
        return new URL(String(url || "")).host.replace(/^www\./i, "");
    } catch {
        return "";
    }
}
