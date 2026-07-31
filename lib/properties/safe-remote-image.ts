import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

import {
    isPrivateOrReservedIpAddress,
    normalizeHostname,
    selectPinnedPublicAddress,
    type ResolvedAddress,
} from "@/lib/security/public-network";

export const URL_IMPORT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const URL_IMPORT_IMAGE_TIMEOUT_MS = 12_000;
export const URL_IMPORT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const SUPPORTED_MIME_TYPES = new Set([
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
]);

export class SafeRemoteImageError extends Error {
    constructor(public readonly code: string) {
        super("Remote image could not be imported");
        this.name = "SafeRemoteImageError";
    }
}

export function isCloudflareDeliveryHostname(hostname: string): boolean {
    return normalizeHostname(hostname) === "imagedelivery.net";
}

function parseRemoteImageUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(String(rawUrl || "").trim());
    } catch {
        throw new SafeRemoteImageError("invalid_url");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new SafeRemoteImageError("unsupported_scheme");
    }
    if (parsed.username || parsed.password) throw new SafeRemoteImageError("credentials_not_allowed");
    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
        throw new SafeRemoteImageError("unsafe_destination");
    }
    if (parsed.port && !(
        (parsed.protocol === "http:" && parsed.port === "80")
        || (parsed.protocol === "https:" && parsed.port === "443")
    )) {
        throw new SafeRemoteImageError("non_standard_port");
    }
    if (isPrivateOrReservedIpAddress(hostname) && /^\[?[0-9a-f:.]+\]?$/i.test(hostname)) {
        throw new SafeRemoteImageError("unsafe_destination");
    }
    parsed.hash = "";
    return parsed;
}

type RequestHop = (
    url: URL,
    pinnedAddress: ResolvedAddress,
    signal: AbortSignal,
) => Promise<Response>;

async function requestPinnedHop(
    url: URL,
    pinnedAddress: ResolvedAddress,
    signal: AbortSignal,
): Promise<Response> {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const pinnedLookup = ((
        _hostname: string,
        options: { all?: boolean } | number,
        callback: (...args: unknown[]) => void,
    ) => {
        if (typeof options === "object" && options?.all) callback(null, [pinnedAddress]);
        else callback(null, pinnedAddress.address, pinnedAddress.family);
    }) as never;

    return new Promise((resolve, reject) => {
        const req = request(url, {
            method: "GET",
            signal,
            lookup: pinnedLookup,
            headers: {
                Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
                "User-Agent": "EstioPropertyImageImporter/1.0",
            },
        }, (response) => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
                if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
                else if (value !== undefined) headers.set(name, String(value));
            }
            const hasBody = ![204, 205, 304].includes(response.statusCode || 0);
            resolve(new Response(
                hasBody ? Readable.toWeb(response) as ReadableStream<Uint8Array> : null,
                {
                    status: response.statusCode || 500,
                    statusText: response.statusMessage || "",
                    headers,
                },
            ));
        });
        req.on("error", reject);
        req.end();
    });
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    if (mimeType === "image/gif") return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    if (mimeType === "image/webp") return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    if (mimeType === "image/avif") return bytes.length >= 12 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12));
    return false;
}

async function readImageBody(response: Response, maxBytes: number): Promise<Uint8Array> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new SafeRemoteImageError("response_too_large");
    }
    if (!response.body) throw new SafeRemoteImageError("empty_response");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SafeRemoteImageError("response_too_large");
        }
        chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

export function createSafeRemoteImageDownloader(dependencies: {
    lookupHost?: (hostname: string) => Promise<ResolvedAddress[]>;
    requestHop?: RequestHop;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
} = {}) {
    const lookupHost = dependencies.lookupHost || ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: false }));
    const requestHop = dependencies.requestHop || requestPinnedHop;
    const timeoutMs = dependencies.timeoutMs ?? URL_IMPORT_IMAGE_TIMEOUT_MS;
    const maxBytes = dependencies.maxBytes ?? URL_IMPORT_MAX_IMAGE_BYTES;
    const maxRedirects = dependencies.maxRedirects ?? URL_IMPORT_MAX_REDIRECTS;

    return async function downloadRemoteImage(rawUrl: string): Promise<
        | { kind: "cloudflare"; url: string }
        | { kind: "image"; blob: Blob; mimeType: string; finalUrl: string }
    > {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const visited = new Set<string>();
        let currentUrl = rawUrl;

        try {
            for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
                const parsed = parseRemoteImageUrl(currentUrl);
                if (isCloudflareDeliveryHostname(parsed.hostname)) {
                    return { kind: "cloudflare", url: parsed.toString() };
                }
                const normalizedUrl = parsed.toString();
                if (visited.has(normalizedUrl)) throw new SafeRemoteImageError("redirect_loop");
                visited.add(normalizedUrl);

                const addresses = await lookupHost(normalizeHostname(parsed.hostname));
                const selected = selectPinnedPublicAddress(addresses);
                if (!selected) throw new SafeRemoteImageError("unsafe_destination");
                const response = await requestHop(parsed, selected, controller.signal);

                if (REDIRECT_STATUSES.has(response.status)) {
                    const location = response.headers.get("location");
                    if (!location) throw new SafeRemoteImageError("invalid_redirect");
                    if (redirectCount === maxRedirects) throw new SafeRemoteImageError("too_many_redirects");
                    currentUrl = new URL(location, normalizedUrl).toString();
                    continue;
                }
                if (!response.ok) throw new SafeRemoteImageError("download_failed");

                const mimeType = String(response.headers.get("content-type") || "")
                    .split(";", 1)[0]
                    .trim()
                    .toLowerCase();
                if (!SUPPORTED_MIME_TYPES.has(mimeType)) throw new SafeRemoteImageError("unsupported_mime_type");
                const bytes = await readImageBody(response, maxBytes);
                if (!matchesImageSignature(bytes, mimeType)) throw new SafeRemoteImageError("invalid_image_signature");
                return {
                    kind: "image",
                    blob: new Blob([bytes], { type: mimeType }),
                    mimeType,
                    finalUrl: normalizedUrl,
                };
            }
            throw new SafeRemoteImageError("too_many_redirects");
        } catch (error) {
            if (controller.signal.aborted) throw new SafeRemoteImageError("timeout");
            if (error instanceof SafeRemoteImageError) throw error;
            throw new SafeRemoteImageError("download_failed");
        } finally {
            clearTimeout(timeout);
        }
    };
}
