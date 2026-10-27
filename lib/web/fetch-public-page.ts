import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * The one way the server fetches a public web page (CRM AI tool, Studio onboarding look-up).
 *
 * Guards against server-side request forgery:
 * - http/https only, default ports only, no credentials in the URL;
 * - every hostname is resolved and rejected if any address is private, loopback,
 *   link-local (incl. 169.254.169.254 metadata), CGNAT, multicast, reserved or an
 *   IPv6 equivalent (incl. IPv4-mapped/embedded forms);
 * - the connection goes to the vetted IP, so DNS rebinding between check and connect fails;
 * - every redirect hop is re-checked, with a bounded number of hops;
 * - total timeout, maximum (decompressed) body size, allowed content types, bounded text.
 *
 * All network I/O goes through a `PublicPageTransport`. A future local-Mac proxy can be
 * plugged in as another transport without changing callers.
 */

export type PublicPageErrorCode =
    | "invalid_url"
    | "blocked_protocol"
    | "blocked_port"
    | "blocked_credentials"
    | "blocked_host"
    | "blocked_address"
    | "dns_failed"
    | "too_many_redirects"
    | "http_error"
    | "unsupported_content_type"
    | "too_large"
    | "timeout"
    | "network_error";

export class PublicPageFetchError extends Error {
    readonly code: PublicPageErrorCode;
    readonly status?: number;

    constructor(code: PublicPageErrorCode, message: string, status?: number) {
        super(message);
        this.name = "PublicPageFetchError";
        this.code = code;
        this.status = status;
    }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type PublicPageTransportRequest = {
    url: URL;
    /** The vetted IP the transport must connect to (never re-resolve the hostname). */
    address: ResolvedAddress;
    headers: Record<string, string>;
    signal: AbortSignal;
};

export type PublicPageTransportResponse = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: AsyncIterable<Uint8Array>;
    /** Releases the connection without reading the rest of the body. */
    cancel: () => void;
};

export type PublicPageTransport = (request: PublicPageTransportRequest) => Promise<PublicPageTransportResponse>;

export type FetchPublicPageOptions = {
    /** Total time for all hops, headers and body. */
    timeoutMs?: number;
    /** Maximum decompressed body bytes. Larger responses are rejected. */
    maxBytes?: number;
    maxRedirects?: number;
    /** Maximum characters of extracted page text returned. */
    maxTextChars?: number;
    userAgent?: string;
    resolveHost?: HostResolver;
    transport?: PublicPageTransport;
};

export type PublicPage = {
    url: string;
    finalUrl: string;
    status: number;
    contentType: string;
    title: string | null;
    description: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    text: string;
    truncated: boolean;
};

export const PUBLIC_PAGE_DEFAULTS = {
    timeoutMs: 8000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 5,
    maxTextChars: 4000,
    userAgent: "EstioAIDraft/1.0 (+public-page-summary)",
} as const;

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

// ── Address classification ─────────────────────────

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this" network
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, cloud metadata
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
];

function ipv4ToInt(ip: string): number {
    return ip.split(".").reduce((acc, part) => (acc * 256) + Number(part), 0);
}

function isBlockedIpv4(ip: string): boolean {
    const value = ipv4ToInt(ip);
    return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
        const size = 2 ** (32 - bits);
        const start = ipv4ToInt(base);
        return value >= start && value < start + size;
    });
}

/** Expands an IPv6 address (optionally with a trailing dotted IPv4) into 8 hextets. */
function ipv6ToHextets(ip: string): number[] | null {
    let input = ip.toLowerCase();
    const zoneIndex = input.indexOf("%");
    if (zoneIndex >= 0) input = input.slice(0, zoneIndex);

    const lastColon = input.lastIndexOf(":");
    const tail = input.slice(lastColon + 1);
    if (tail.includes(".")) {
        if (net.isIPv4(tail) === false) return null;
        const v4 = ipv4ToInt(tail);
        input = `${input.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
    }

    const halves = input.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

    const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
    const hextets = parts.map((part) => parseInt(part, 16));
    if (hextets.length !== 8 || hextets.some((h) => !Number.isFinite(h) || h < 0 || h > 0xffff)) return null;
    return hextets;
}

function isBlockedIpv6(ip: string): boolean {
    const h = ipv6ToHextets(ip);
    if (!h) return true;

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
    const firstFiveZero = h.slice(0, 5).every((x) => x === 0);
    if (firstFiveZero && (h[5] === 0xffff || h[5] === 0)) {
        if (h[5] === 0 && h[6] === 0 && h[7] <= 1) return true; // :: and ::1
        const embedded = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
        return h[5] === 0xffff ? isBlockedIpv4(embedded) : true;
    }

    // Only global unicast (2000::/3) is public.
    if ((h[0] & 0xe000) !== 0x2000) return true;
    // Special-purpose blocks inside 2000::/3.
    if (h[0] === 0x2001 && h[1] < 0x0200) return true; // 2001::/23 IETF (Teredo, ORCHID, ...)
    if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
    if (h[0] === 0x2002) return true; // 6to4 embeds arbitrary IPv4
    if (h[0] === 0x3fff && h[1] < 0x1000) return true; // 3fff::/20 documentation
    return false;
}

/** True when the IP literal is not a public unicast address. Non-IPs are treated as blocked. */
export function isBlockedAddress(ip: string): boolean {
    const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
    const version = net.isIP(bare.split("%")[0]);
    if (version === 4) return isBlockedIpv4(bare);
    if (version === 6) return isBlockedIpv6(bare);
    return true;
}

// ── URL and host checks ────────────────────────────

function parsePublicUrl(raw: string | URL, base?: URL): URL {
    let url: URL;
    try {
        url = new URL(String(raw), base);
    } catch {
        throw new PublicPageFetchError("invalid_url", "Invalid URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new PublicPageFetchError("blocked_protocol", "Only HTTP/HTTPS URLs can be fetched.");
    }
    // WHATWG URL clears the port when it equals the scheme default.
    if (url.port !== "") {
        throw new PublicPageFetchError("blocked_port", "Only default ports (80/443) can be fetched.");
    }
    if (url.username || url.password) {
        throw new PublicPageFetchError("blocked_credentials", "URLs with credentials cannot be fetched.");
    }
    url.hash = "";
    return url;
}

function hostnameOf(url: URL): string {
    const host = url.hostname.toLowerCase();
    return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

const defaultResolveHost: HostResolver = async (hostname) => {
    const results = await dnsLookup(hostname, { all: true, verbatim: true });
    return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

async function vetHost(url: URL, resolveHost: HostResolver): Promise<ResolvedAddress> {
    const host = hostnameOf(url).replace(/\.$/, "");
    const literal = net.isIP(host);
    if (literal) {
        if (isBlockedAddress(host)) {
            throw new PublicPageFetchError("blocked_address", "Refusing to fetch private or local network URLs.");
        }
        return { address: host, family: literal === 6 ? 6 : 4 };
    }

    if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
        throw new PublicPageFetchError("blocked_host", "Refusing to fetch private or local network URLs.");
    }

    let addresses: ResolvedAddress[];
    try {
        addresses = await resolveHost(host);
    } catch {
        throw new PublicPageFetchError("dns_failed", `Could not resolve ${host}.`);
    }
    if (addresses.length === 0) {
        throw new PublicPageFetchError("dns_failed", `Could not resolve ${host}.`);
    }
    // Reject if any answer is private: an attacker-controlled name could mix public and private answers.
    if (addresses.some((a) => isBlockedAddress(a.address))) {
        throw new PublicPageFetchError("blocked_address", "Refusing to fetch private or local network URLs.");
    }
    return addresses[0];
}

// ── Default transport: Node http(s) pinned to the vetted IP ─────

/** A `lookup` that ignores the hostname and returns the vetted address (SNI and certificate checks still use the hostname). */
export function pinnedLookup(address: ResolvedAddress): net.LookupFunction {
    return ((_hostname: string, options: any, callback: any) => {
        const cb = typeof options === "function" ? options : callback;
        if (options && typeof options === "object" && options.all) {
            cb(null, [{ address: address.address, family: address.family }]);
        } else {
            cb(null, address.address, address.family);
        }
    }) as net.LookupFunction;
}

export const nodeTransport: PublicPageTransport = (request) => new Promise((resolve, reject) => {
    const client = request.url.protocol === "https:" ? https : http;
    const req = client.request(request.url, {
        method: "GET",
        headers: request.headers,
        lookup: pinnedLookup(request.address),
        agent: false,
        signal: request.signal,
    }, (res) => {
        resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: res,
            cancel: () => res.destroy(),
        });
    });
    req.on("error", reject);
    req.end();
});

// ── Body reading ───────────────────────────────────

function headerValue(headers: PublicPageTransportResponse["headers"], name: string): string {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return (Array.isArray(value) ? value[0] : value) || "";
}

function decoderFor(encoding: string): NodeJS.ReadWriteStream | null {
    switch (encoding.trim().toLowerCase()) {
        case "":
        case "identity":
            return null;
        case "gzip":
        case "x-gzip":
            return zlib.createGunzip();
        case "deflate":
            return zlib.createInflate();
        case "br":
            return zlib.createBrotliDecompress();
        default:
            throw new PublicPageFetchError("unsupported_content_type", `Unsupported content encoding ${encoding}.`);
    }
}

async function readBodyLimited(response: PublicPageTransportResponse, maxBytes: number): Promise<Buffer> {
    const declared = Number(headerValue(response.headers, "content-length"));
    const encoding = headerValue(response.headers, "content-encoding");
    if (!encoding && Number.isFinite(declared) && declared > maxBytes) {
        throw new PublicPageFetchError("too_large", "Page is larger than the allowed size.");
    }

    const decoder = decoderFor(encoding);
    const source = Readable.from(response.body);
    const stream: AsyncIterable<Uint8Array> = decoder ? source.pipe(decoder) as any : source;
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        for await (const chunk of stream) {
            total += chunk.byteLength;
            if (total > maxBytes) {
                throw new PublicPageFetchError("too_large", "Page is larger than the allowed size.");
            }
            chunks.push(Buffer.from(chunk));
        }
    } finally {
        source.destroy();
        (decoder as any)?.destroy?.();
    }
    return Buffer.concat(chunks);
}

function decodeText(body: Buffer, contentTypeHeader: string): string {
    const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentTypeHeader)?.[1];
    try {
        return new TextDecoder(charset || "utf-8").decode(body);
    } catch {
        return new TextDecoder("utf-8").decode(body);
    }
}

// ── HTML extraction ────────────────────────────────

function decodeEntities(value: string): string {
    return value
        .replace(/&#(\d+);/g, (_m, dec) => safeFromCodePoint(Number(dec)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeFromCodePoint(parseInt(hex, 16)))
        .replace(/&nbsp;/gi, " ")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&");
}

function safeFromCodePoint(code: number): string {
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

function clean(value: string | undefined | null, maxChars = 500): string | null {
    if (!value) return null;
    const text = decodeEntities(value).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, maxChars) : null;
}

function parseMetaTags(html: string): Map<string, string> {
    const meta = new Map<string, string>();
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
        const attrs: Record<string, string> = {};
        for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
            attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
        }
        const key = (attrs.property || attrs.name || "").toLowerCase();
        if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
    }
    return meta;
}

function absoluteHttpUrl(value: string | null, base: URL): string | null {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

export function extractPageContent(html: string, baseUrl: URL) {
    const meta = parseMetaTags(html);
    const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const text = decodeEntities(
        html
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<[^>]+>/g, " ")
    ).replace(/\s+/g, " ").trim();

    return {
        title,
        description: clean(meta.get("description")),
        ogTitle: clean(meta.get("og:title")),
        ogDescription: clean(meta.get("og:description")),
        ogImage: absoluteHttpUrl(clean(meta.get("og:image"), 2000), baseUrl),
        text,
    };
}

// ── Public entry point ─────────────────────────────

/** DNS lookups ignore abort signals, so race them against the overall deadline. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => Error): Promise<T> {
    if (signal.aborted) return Promise.reject(onAbort());
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(onAbort());
        signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

export async function fetchPublicPage(rawUrl: string | URL, options: FetchPublicPageOptions = {}): Promise<PublicPage> {
    const timeoutMs = options.timeoutMs ?? PUBLIC_PAGE_DEFAULTS.timeoutMs;
    const maxBytes = options.maxBytes ?? PUBLIC_PAGE_DEFAULTS.maxBytes;
    const maxRedirects = options.maxRedirects ?? PUBLIC_PAGE_DEFAULTS.maxRedirects;
    const maxTextChars = options.maxTextChars ?? PUBLIC_PAGE_DEFAULTS.maxTextChars;
    const resolveHost = options.resolveHost ?? defaultResolveHost;
    const transport = options.transport ?? nodeTransport;

    const startUrl = parsePublicUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timeoutError = () => new PublicPageFetchError("timeout", "Fetching the page timed out.");

    try {
        let url = startUrl;
        for (let hop = 0; ; hop++) {
            const address = await untilAborted(vetHost(url, resolveHost), controller.signal, timeoutError);

            let response: PublicPageTransportResponse;
            try {
                response = await transport({
                    url,
                    address,
                    signal: controller.signal,
                    headers: {
                        "user-agent": options.userAgent ?? PUBLIC_PAGE_DEFAULTS.userAgent,
                        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
                        "accept-encoding": "gzip, deflate, br",
                    },
                });
            } catch (error) {
                if (error instanceof PublicPageFetchError) throw error;
                if (controller.signal.aborted) throw timeoutError();
                throw new PublicPageFetchError("network_error", "Could not connect to the page.");
            }

            if (REDIRECT_STATUSES.has(response.status)) {
                response.cancel();
                const location = headerValue(response.headers, "location");
                if (!location) {
                    throw new PublicPageFetchError("http_error", `Redirect without a location (status ${response.status}).`, response.status);
                }
                if (hop >= maxRedirects) {
                    throw new PublicPageFetchError("too_many_redirects", "Too many redirects.");
                }
                url = parsePublicUrl(location, url);
                continue;
            }

            if (response.status < 200 || response.status >= 300) {
                response.cancel();
                throw new PublicPageFetchError("http_error", `Fetch failed with status ${response.status}.`, response.status);
            }

            const contentType = headerValue(response.headers, "content-type");
            const mime = contentType.split(";")[0].trim().toLowerCase();
            if (!ALLOWED_CONTENT_TYPES.has(mime)) {
                response.cancel();
                throw new PublicPageFetchError("unsupported_content_type", `Unsupported content type ${mime || "(none)"}.`);
            }

            let body: Buffer;
            try {
                body = await readBodyLimited(response, maxBytes);
            } catch (error) {
                response.cancel();
                if (error instanceof PublicPageFetchError) throw error;
                if (controller.signal.aborted) throw timeoutError();
                throw new PublicPageFetchError("network_error", "Could not read the page.");
            }

            const raw = decodeText(body, contentType);
            const page = mime === "text/plain"
                ? { title: null, description: null, ogTitle: null, ogDescription: null, ogImage: null, text: raw.replace(/\s+/g, " ").trim() }
                : extractPageContent(raw, url);
            const text = page.text.slice(0, maxTextChars);

            return {
                url: startUrl.toString(),
                finalUrl: url.toString(),
                status: response.status,
                contentType,
                ...page,
                text,
                truncated: page.text.length > text.length,
            };
        }
    } finally {
        clearTimeout(timer);
    }
}
