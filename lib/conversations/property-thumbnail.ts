import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60;

function getSigningSecret() {
    const secret = process.env.PROPERTY_PREVIEW_SIGNING_SECRET
        || process.env.CLERK_SECRET_KEY
        || process.env.CRON_SECRET;
    if (!secret) throw new Error("Property preview signing secret is not configured.");
    return secret;
}

function signature(payload: string) {
    return crypto.createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

export function createPropertyThumbnailUrl(sourceUrl: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const payload = Buffer.from(JSON.stringify({ url: sourceUrl, exp: nowSeconds + TOKEN_TTL_SECONDS })).toString("base64url");
    const params = new URLSearchParams({ token: payload, signature: signature(payload) });
    return `/api/conversations/property-url-thumbnail?${params.toString()}`;
}

export function verifyPropertyThumbnailToken(token: string, suppliedSignature: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const expected = signature(token);
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedSignature || ""));
    if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { url?: unknown; exp?: unknown };
        if (typeof parsed.url !== "string" || typeof parsed.exp !== "number" || parsed.exp < nowSeconds) return null;
        return { url: parsed.url, exp: parsed.exp };
    } catch {
        return null;
    }
}
