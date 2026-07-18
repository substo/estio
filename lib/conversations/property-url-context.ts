import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import net from "node:net";

export type PropertyMessageUrlContextResult = {
    success: boolean;
    url: string;
    title?: string;
    description?: string;
    imageUrl?: string;
    siteName?: string;
    sourceText?: string;
    error?: string;
};

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 700_000;
const MAX_SOURCE_TEXT_CHARS = 8_000;
const MAX_REDIRECTS = 5;

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
    if (parsed.username || parsed.password) {
        return { ok: false, error: "URLs containing credentials are not supported." };
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

function resolveMetaUrl(value: string, baseUrl: string): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        return new URL(raw, baseUrl).toString();
    } catch {
        return "";
    }
}

function extractReadableText(html: string, url: string): { title: string; description: string; imageUrl: string; siteName: string; sourceText: string } {
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
    const imageUrl = resolveMetaUrl(getMetaContent($, [
        "meta[property='og:image']",
        "meta[property='og:image:url']",
        "meta[property='og:image:secure_url']",
        "meta[name='twitter:image']",
        "meta[name='twitter:image:src']",
    ]), url);
    const siteName = normalizeWhitespace(getMetaContent($, [
        "meta[property='og:site_name']",
        "meta[name='application-name']",
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

    return { title, description, imageUrl, siteName, sourceText };
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

export class PropertyUrlFetchError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = "PropertyUrlFetchError";
    }
}

export async function fetchPublicHttpResponse(
    rawUrl: string,
    options: {
        fetchImpl?: FetchLike;
        timeoutMs?: number;
        skipPublicUrlValidation?: boolean;
        accept?: string;
        maxRedirects?: number;
    } = {}
): Promise<{ response: Response; finalUrl: string }> {
    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const visited = new Set<string>();
    let currentUrl = String(rawUrl || "").trim();

    try {
        for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
            let parsed: URL;
            if (options.skipPublicUrlValidation) {
                try {
                    parsed = new URL(currentUrl);
                } catch {
                    throw new PropertyUrlFetchError("Enter a valid URL.", "invalid_url");
                }
            } else {
                const validation = await validatePublicHttpUrl(currentUrl);
                if (!validation.ok) throw new PropertyUrlFetchError(validation.error, "unsafe_url");
                parsed = validation.url;
            }

            const normalizedUrl = parsed.toString();
            if (visited.has(normalizedUrl)) throw new PropertyUrlFetchError("The URL redirects in a loop.", "redirect_loop");
            visited.add(normalizedUrl);

            const response = await fetchImpl(normalizedUrl, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    "Accept": options.accept || "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
                    "User-Agent": "Mozilla/5.0 (compatible; EstioPropertyMessageBot/1.0)",
                },
            });

            if (![301, 302, 303, 307, 308].includes(response.status)) {
                return { response, finalUrl: normalizedUrl };
            }
            const location = response.headers.get("location");
            if (!location) throw new PropertyUrlFetchError("The URL returned an invalid redirect.", "invalid_redirect");
            if (redirectCount === maxRedirects) throw new PropertyUrlFetchError("The URL redirected too many times.", "too_many_redirects");
            currentUrl = new URL(location, normalizedUrl).toString();
        }
        throw new PropertyUrlFetchError("The URL redirected too many times.", "too_many_redirects");
    } catch (error: any) {
        if (error?.name === "AbortError") throw new PropertyUrlFetchError("Timed out while fetching this URL.", "timeout");
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function extractPropertyUrlContext(
    rawUrl: string,
    options: {
        fetchImpl?: FetchLike;
        timeoutMs?: number;
        skipPublicUrlValidation?: boolean;
    } = {}
): Promise<PropertyMessageUrlContextResult> {
    const requestedUrl = String(rawUrl || "").trim();

    try {
        const { response, finalUrl } = await fetchPublicHttpResponse(requestedUrl, {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs,
            skipPublicUrlValidation: options.skipPublicUrlValidation,
        });

        if (!response.ok) {
            return {
                success: false,
                url: finalUrl,
                error: `Could not fetch URL (${response.status}).`,
            };
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
            return {
                success: false,
                url: finalUrl,
                error: "This URL did not return readable page text.",
            };
        }

        const html = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
        const extracted = extractReadableText(html, finalUrl);
        if (!extracted.sourceText) {
            return {
                success: false,
                url: finalUrl,
                error: "No readable property text was found on this page.",
            };
        }

        return {
            success: true,
            url: finalUrl,
            title: extracted.title || undefined,
            description: extracted.description || undefined,
            imageUrl: extracted.imageUrl || undefined,
            siteName: extracted.siteName || undefined,
            sourceText: extracted.sourceText,
        };
    } catch (error: any) {
        return {
            success: false,
            url: requestedUrl,
            error: error instanceof PropertyUrlFetchError ? error.message : "Could not fetch this URL.",
        };
    }
}
