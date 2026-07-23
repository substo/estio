import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
const MAX_PINNED_RESPONSE_BYTES = 5 * 1024 * 1024;

const BLOCKED_HOSTS = new Set([
    "localhost",
    "localhost.localdomain",
]);

function isPrivateIpAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const parts = address.split(".").map((part) => Number.parseInt(part, 10));
        const [a, b, c] = parts;
        return (
            a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 192 && b === 0 && (c === 0 || c === 2))
            || (a === 198 && b >= 18 && b <= 19)
            || (a === 198 && b === 51 && c === 100)
            || (a === 203 && b === 0 && c === 113)
            || (a === 169 && b === 254)
            || a === 0
            || a >= 224
        );
    }

    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase();
        if (normalized.startsWith("::ffff:")) {
            const mapped = normalized.slice("::ffff:".length);
            if (net.isIPv4(mapped)) return isPrivateIpAddress(mapped);
            const words = mapped.split(":");
            if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
                const high = Number.parseInt(words[0], 16);
                const low = Number.parseInt(words[1], 16);
                return isPrivateIpAddress([
                    high >> 8,
                    high & 0xff,
                    low >> 8,
                    low & 0xff,
                ].join("."));
            }
            return true;
        }
        return (
            normalized === "::1"
            || normalized.startsWith("fc")
            || normalized.startsWith("fd")
            || /^fe[89ab]/.test(normalized)
            || normalized.startsWith("ff")
            || normalized.startsWith("64:ff9b:")
            || normalized.startsWith("100:")
            || normalized.startsWith("2001:db8:")
            || normalized === "::"
        );
    }

    return false;
}

export function selectPinnedPublicAddress(
    addresses: Array<{ address: string; family: number }>,
) {
    if (
        addresses.length === 0
        || addresses.some((item) => isPrivateIpAddress(item.address))
    ) {
        return null;
    }
    return addresses[0];
}

async function fetchPinnedPublicHttpResponse(
    url: URL,
    options: {
        accept: string;
        signal: AbortSignal;
    },
) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: false });
    const selected = selectPinnedPublicAddress(addresses);
    if (!selected) {
        throw new PropertyUrlFetchError("Private network URLs are not supported.", "unsafe_url");
    }
    const pinnedLookup = ((
        _hostname: string,
        lookupOptions: { all?: boolean } | number,
        callback: (...args: any[]) => void,
    ) => {
        if (typeof lookupOptions === "object" && lookupOptions?.all) {
            callback(null, [selected]);
            return;
        }
        callback(null, selected.address, selected.family);
    }) as any;
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<Response>((resolve, reject) => {
        const req = request(url, {
            method: "GET",
            signal: options.signal,
            lookup: pinnedLookup,
            headers: {
                "Accept": options.accept,
                "User-Agent": "Mozilla/5.0 (compatible; EstioPropertyMessageBot/1.0)",
            },
        }, (response) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            response.on("data", (chunk: Buffer | Uint8Array) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += buffer.length;
                if (totalBytes > MAX_PINNED_RESPONSE_BYTES) {
                    response.destroy(new PropertyUrlFetchError("The response exceeded the safe size limit.", "response_too_large"));
                    return;
                }
                chunks.push(buffer);
            });
            response.on("error", reject);
            response.on("end", () => {
                const headers = new Headers();
                for (const [name, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value)) {
                        for (const item of value) headers.append(name, item);
                    } else if (value !== undefined) {
                        headers.set(name, String(value));
                    }
                }
                const body = [204, 205, 304].includes(response.statusCode || 0)
                    ? null
                    : Buffer.concat(chunks);
                resolve(new Response(body, {
                    status: response.statusCode || 500,
                    statusText: response.statusMessage || "",
                    headers,
                }));
            });
        });
        req.on("error", reject);
        req.end();
    });
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
    if (
        parsed.port
        && !(
            (parsed.protocol === "http:" && parsed.port === "80")
            || (parsed.protocol === "https:" && parsed.port === "443")
        )
    ) {
        return { ok: false, error: "Only standard web ports are supported." };
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

            const accept = options.accept || "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8";
            const response = options.fetchImpl
                ? await fetchImpl(normalizedUrl, {
                    method: "GET",
                    redirect: "manual",
                    signal: controller.signal,
                    headers: {
                        "Accept": accept,
                        "User-Agent": "Mozilla/5.0 (compatible; EstioPropertyMessageBot/1.0)",
                    },
                })
                : await fetchPinnedPublicHttpResponse(parsed, {
                    accept,
                    signal: controller.signal,
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
