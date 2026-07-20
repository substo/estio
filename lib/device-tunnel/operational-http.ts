import type { IncomingMessage, ServerResponse } from "node:http";

export const OPERATIONAL_CHANGE_REFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isOperationalRequestAuthorized(args: {
    request: IncomingMessage;
    headerName: string;
    secret: string;
}) {
    if (!args.secret) return false;
    const value = args.request.headers[args.headerName.toLowerCase()];
    return typeof value === "string" && value === args.secret;
}

export function readOperationalChangeReference(request: IncomingMessage) {
    const value = String(request.headers["x-change-ref"] || "").trim();
    return OPERATIONAL_CHANGE_REFERENCE_PATTERN.test(value) ? value : null;
}

export function writeOperationalJson(
    response: ServerResponse,
    status: number,
    payload: unknown,
) {
    response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(payload));
}

export async function readBoundedOperationalJson(
    request: IncomingMessage,
    maximumBytes = 256 * 1024,
) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 10 * 1024 * 1024) {
        throw new Error("operational_body_limit_invalid");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (size > maximumBytes) throw new Error("operational_body_too_large");
        chunks.push(value);
    }
    if (!chunks.length) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("operational_body_invalid");
    }
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export function sanitizeOperationalError(args: {
    error: unknown;
    fallbackCode: string;
    allowlistedCodes?: ReadonlySet<string>;
}) {
    const candidate = String((args.error as any)?.code || "").trim();
    const allowed = ERROR_CODE_PATTERN.test(candidate)
        && (!args.allowlistedCodes || args.allowlistedCodes.has(candidate));
    return {
        code: allowed ? candidate : args.fallbackCode,
        name: String((args.error as any)?.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "Error",
    };
}
