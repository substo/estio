import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import net from "node:net";

export type PropertyMessageUrlContextResult = {
    success: boolean;
    url: string;
    title?: string;
    sourceText?: string;
    error?: string;
};

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 700_000;
const MAX_SOURCE_TEXT_CHARS = 8_000;

const BLOCKED_HOSTS = new Set([
    "localhost",
    "localhost.localdomain",
]);

function isPrivateIpAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const parts = address.split(".").map((part) => Number.parseInt(part, 10));
        const [a, b] = parts;
        return (
            a === 10
            || a === 127
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254)
            || a === 0
        );
    }

    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase();
        return (
            normalized === "::1"
            || normalized.startsWith("fc")
            || normalized.startsWith("fd")
            || normalized.startsWith("fe80")
            || normalized === "::"
        );
    }

    return false;
}

export async function validatePublicHttpUrl(rawUrl: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
    let parsed: URL;
    try {
        parsed = new URL(String(rawUrl || "").trim());
    } catch {
        return { ok: false, error: "Enter a valid URL." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Only http and https URLs are supported." };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
        return { ok: false, error: "Local URLs are not supported." };
    }

    if (net.isIP(hostname) && isPrivateIpAddress(hostname)) {
        return { ok: false, error: "Private network URLs are not supported." };
    }

    try {
        const addresses = await lookup(hostname, { all: true, verbatim: false });
        if (addresses.some((item) => isPrivateIpAddress(item.address))) {
            return { ok: false, error: "Private network URLs are not supported." };
        }
    } catch {
        return { ok: false, error: "Could not resolve this URL." };
    }

    parsed.hash = "";
    return { ok: true, url: parsed };
}

function normalizeWhitespace(value: string): string {
    return value
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function getMetaContent($: ReturnType<typeof load>, selectors: string[]): string {
    for (const selector of selectors) {
        const value = $(selector).first().attr("content");
        if (value && value.trim()) return value.trim();
    }
    return "";
}

function extractReadableText(html: string, url: string): { title: string; sourceText: string } {
    const $ = load(html);
    $("script, style, noscript, svg, canvas, iframe, nav, header, footer, form").remove();
    $(".cookie-consent, .popup, .modal, .menu, .navigation, .footer, .header").remove();
    $("#cookie-consent, #popup, #modal, #menu, #navigation, #footer, #header").remove();
    $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

    const title = normalizeWhitespace(
        getMetaContent($, [
            "meta[property='og:title']",
            "meta[name='twitter:title']",
        ])
        || $("title").first().text()
        || $("h1").first().text()
        || ""
    );
    const description = normalizeWhitespace(getMetaContent($, [
        "meta[property='og:description']",
        "meta[name='description']",
        "meta[name='twitter:description']",
    ]));
    const price = normalizeWhitespace(getMetaContent($, [
        "meta[property='product:price:amount']",
        "meta[itemprop='price']",
    ]));
    const currency = normalizeWhitespace(getMetaContent($, [
        "meta[property='product:price:currency']",
        "meta[itemprop='priceCurrency']",
    ]));
    const bodyText = normalizeWhitespace($("main").text() || $("article").text() || $("body").text() || "");

    const priorityLines = [
        title ? `Title: ${title}` : null,
        description ? `Description: ${description}` : null,
        price ? `Price: ${currency ? `${currency} ` : ""}${price}` : null,
        `Source URL: ${url}`,
    ].filter(Boolean);

    const sourceText = normalizeWhitespace([
        priorityLines.join("\n"),
        bodyText,
    ].filter(Boolean).join("\n\n")).slice(0, MAX_SOURCE_TEXT_CHARS).trim();

    return { title, sourceText };
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return (await response.text()).slice(0, maxBytes);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let output = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            output += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (totalBytes - maxBytes))), { stream: true });
            break;
        }
        output += decoder.decode(value, { stream: true });
    }

    output += decoder.decode();
    return output;
}

export async function extractPropertyUrlContext(
    rawUrl: string,
    options: {
        fetchImpl?: FetchLike;
        timeoutMs?: number;
        skipPublicUrlValidation?: boolean;
    } = {}
): Promise<PropertyMessageUrlContextResult> {
    const validation = options.skipPublicUrlValidation
        ? (() => {
            try {
                const parsed = new URL(String(rawUrl || "").trim());
                parsed.hash = "";
                return { ok: true as const, url: parsed };
            } catch {
                return { ok: false as const, error: "Enter a valid URL." };
            }
        })()
        : await validatePublicHttpUrl(rawUrl);

    if (!validation.ok) {
        return { success: false, url: String(rawUrl || "").trim(), error: validation.error };
    }

    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        const response = await fetchImpl(validation.url.toString(), {
            method: "GET",
            signal: abortController.signal,
            headers: {
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
                "User-Agent": "Mozilla/5.0 (compatible; EstioPropertyMessageBot/1.0)",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                url: validation.url.toString(),
                error: `Could not fetch URL (${response.status}).`,
            };
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
            return {
                success: false,
                url: validation.url.toString(),
                error: "This URL did not return readable page text.",
            };
        }

        const html = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
        const extracted = extractReadableText(html, validation.url.toString());
        if (!extracted.sourceText) {
            return {
                success: false,
                url: validation.url.toString(),
                error: "No readable property text was found on this page.",
            };
        }

        return {
            success: true,
            url: validation.url.toString(),
            title: extracted.title || undefined,
            sourceText: extracted.sourceText,
        };
    } catch (error: any) {
        const isAbort = error?.name === "AbortError";
        return {
            success: false,
            url: validation.url.toString(),
            error: isAbort ? "Timed out while fetching this URL." : "Could not fetch this URL.",
        };
    } finally {
        clearTimeout(timeout);
    }
}
