import { createHash } from "crypto";

export type WhatsAppWebBridgeWebhookBodyParseResult =
    | { ok: true; body: any; rawBodyLength: number }
    | {
        ok: false;
        status: 400;
        responseBody: {
            error: string;
            code: "invalid_json";
            parseError: string;
            receivedBodyBytes: number;
            contentLength: string | null;
            contentType: string | null;
            bodySha256: string;
        };
        logMetadata: {
            parseError: string;
            receivedBodyBytes: number;
            contentLength: string | null;
            contentType: string | null;
            bodySha256: string;
            bodyStart: string;
            bodyEnd: string;
        };
    };

function byteLength(value: string) {
    return Buffer.byteLength(value, "utf8");
}

function sha256(value: string) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseWhatsAppWebBridgeWebhookBody(args: {
    rawBody: string;
    contentType?: string | null;
    contentLength?: string | null;
}): WhatsAppWebBridgeWebhookBodyParseResult {
    const rawBody = args.rawBody || "";
    const receivedBodyBytes = byteLength(rawBody);

    try {
        return {
            ok: true,
            body: JSON.parse(rawBody || "{}"),
            rawBodyLength: receivedBodyBytes,
        };
    } catch (error: any) {
        const bodySha256 = sha256(rawBody);
        return {
            ok: false,
            status: 400,
            responseBody: {
                error: "Malformed WhatsApp Web Bridge webhook JSON.",
                code: "invalid_json",
                parseError: error?.message || "JSON parse failed.",
                receivedBodyBytes,
                contentLength: args.contentLength || null,
                contentType: args.contentType || null,
                bodySha256,
            },
            logMetadata: {
                parseError: error?.message || "JSON parse failed.",
                receivedBodyBytes,
                contentLength: args.contentLength || null,
                contentType: args.contentType || null,
                bodySha256,
                bodyStart: rawBody.slice(0, 300),
                bodyEnd: rawBody.length > 300 ? rawBody.slice(-300) : rawBody,
            },
        };
    }
}
