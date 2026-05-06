const LINKED_URLS_LABEL = "Linked URLs:";

function normalizeWhitespace(text: string) {
    return String(text || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isSafeHttpUrl(rawUrl: string) {
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function normalizeSafeUrl(rawUrl: string, baseUrl?: string) {
    const candidate = String(rawUrl || "").trim();
    if (!candidate) return null;

    try {
        const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

function appendUniqueUrl(urls: string[], seen: Set<string>, rawUrl: string | null | undefined, baseUrl?: string) {
    const normalized = normalizeSafeUrl(String(rawUrl || ""), baseUrl);
    if (!normalized) return;

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    urls.push(normalized);
}

export function extractSafeAnchorUrlsFromHtml(html: string) {
    if (typeof window === "undefined" || !html) return [];

    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script, style").forEach((node) => node.remove());

        const urls: string[] = [];
        const seen = new Set<string>();
        const baseHref = doc.querySelector("base[href]")?.getAttribute("href") || undefined;

        doc.querySelectorAll("a[href]").forEach((anchor) => {
            appendUniqueUrl(urls, seen, anchor.getAttribute("href"), baseHref);
        });

        return urls;
    } catch {
        return [];
    }
}

export function appendLinkedUrlsToText(text: string, urls: string[]) {
    const baseText = normalizeWhitespace(text);
    const safeUrls = urls.filter(isSafeHttpUrl);
    if (safeUrls.length === 0) return baseText;

    const lowerBase = baseText.toLowerCase();
    const uniqueUrls = safeUrls.filter((url, index) => {
        if (safeUrls.findIndex((candidate) => candidate.toLowerCase() === url.toLowerCase()) !== index) return false;
        return !lowerBase.includes(url.toLowerCase());
    });

    if (uniqueUrls.length === 0) return baseText;

    const linkedUrlsBlock = [LINKED_URLS_LABEL, ...uniqueUrls].join("\n");
    return baseText ? `${baseText}\n\n${linkedUrlsBlock}` : linkedUrlsBlock;
}

export function buildPlainLeadTextFromHtml(html: string) {
    if (typeof window === "undefined" || !html) return "";

    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script, style").forEach((node) => node.remove());
        const text = normalizeWhitespace(doc.body?.innerText || doc.body?.textContent || "");
        return appendLinkedUrlsToText(text, extractSafeAnchorUrlsFromHtml(html));
    } catch {
        return "";
    }
}

export function buildLeadTextFromClipboardData(clipboardData: DataTransfer | null | undefined) {
    const plainText = clipboardData?.getData("text/plain") || "";
    const html = clipboardData?.getData("text/html") || "";
    if (!html) return plainText;
    return appendLinkedUrlsToText(plainText, extractSafeAnchorUrlsFromHtml(html));
}

export function insertTextIntoTextareaValue(currentValue: string, insertText: string, selectionStart?: number | null, selectionEnd?: number | null) {
    const current = String(currentValue || "");
    const start = typeof selectionStart === "number" ? selectionStart : current.length;
    const end = typeof selectionEnd === "number" ? selectionEnd : start;
    return `${current.slice(0, start)}${insertText}${current.slice(end)}`;
}

export function enrichTextWithSelectedAnchorUrls(text: string, container: ParentNode, range: Range) {
    const urls: string[] = [];
    const seen = new Set<string>();

    container.querySelectorAll?.("a[href]").forEach((anchor) => {
        try {
            if (!range.intersectsNode(anchor)) return;
            appendUniqueUrl(urls, seen, anchor.getAttribute("href"), anchor.ownerDocument?.baseURI);
        } catch {
            // Ignore detached or inaccessible selection nodes.
        }
    });

    return appendLinkedUrlsToText(text, urls);
}
