/**
 * lib/sms-relay/auth.ts
 *
 * Device JWT issuance / verification and HMAC-SHA256 inbound-webhook
 * signature helpers for the SIM Relay Android gateway.
 *
 * JWT secret:  SMS_RELAY_JWT_SECRET   (1-year device tokens)
 * HMAC secret: SMS_RELAY_WEBHOOK_SECRET  (per-location shared secret;
 *              production should use per-device secrets stored via SettingsSecret)
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getJwtSecret(): string {
    const secret = process.env.SMS_RELAY_JWT_SECRET;
    if (!secret) throw new Error("SMS_RELAY_JWT_SECRET is not configured");
    return secret;
}

function getWebhookSecret(): string {
    const secret = process.env.SMS_RELAY_WEBHOOK_SECRET;
    if (!secret) throw new Error("SMS_RELAY_WEBHOOK_SECRET is not configured");
    return secret;
}

// ---------------------------------------------------------------------------
// Pair code helpers
// ---------------------------------------------------------------------------

/**
 * Generates a random 6-character uppercase alphanumeric pair code.
 * Returns both the raw code (shown to user / encoded in QR) and its
 * SHA-256 hash (stored in DB — raw code is never persisted).
 */
export function generatePairCode(): { pairCode: string; pairTokenHash: string } {
    const pairCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 chars
    const pairTokenHash = crypto.createHash("sha256").update(pairCode).digest("hex");
    return { pairCode, pairTokenHash };
}

/**
 * Hashes an incoming pair code for safe DB comparison.
 */
export function hashPairCode(rawCode: string): string {
    return crypto.createHash("sha256").update(rawCode.toUpperCase().trim()).digest("hex");
}

// ---------------------------------------------------------------------------
// Device API token  (long-lived JWT — 1 year)
// ---------------------------------------------------------------------------

export interface DeviceTokenPayload {
    deviceId: string;
    locationId: string;
    purpose: "sms_relay_device";
    iat: number;
    exp: number;
}

/**
 * Issues a long-lived JWT for a paired Android device.
 * The raw token is returned once and NEVER stored — only its SHA-256 hash
 * is persisted in `SmsRelayDevice.deviceApiTokenHash`.
 */
export function generateDeviceToken(deviceId: string, locationId: string): string {
    const secret = getJwtSecret();
    return jwt.sign(
        { deviceId, locationId, purpose: "sms_relay_device" },
        secret,
        { algorithm: "HS256", expiresIn: "365d" }
    );
}

/**
 * Verifies a device Bearer token and returns its payload.
 * Throws on invalid / expired tokens.
 */
export function verifyDeviceToken(token: string): DeviceTokenPayload {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as DeviceTokenPayload;
    if (decoded.purpose !== "sms_relay_device") {
        throw new Error("Invalid token purpose");
    }
    return decoded;
}

/**
 * Returns the SHA-256 hash of a raw device token — used to store in DB
 * and validate future tokens without keeping the raw value.
 */
export function hashDeviceToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// ---------------------------------------------------------------------------
// Inbound webhook signature (HMAC-SHA256)
// ---------------------------------------------------------------------------

/**
 * Computes the HMAC-SHA256 hex signature for a raw request body string.
 * The Android app sends this as `X-SmsRelay-Signature: sha256=<hex>`.
 */
export function computeInboundSignature(rawBody: string): string {
    const secret = getWebhookSecret();
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Verifies that the inbound signature header matches the computed value.
 * Uses a timing-safe comparison to prevent timing attacks.
 */
export function verifyInboundSignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader) return false;
    const provided = signatureHeader.startsWith("sha256=")
        ? signatureHeader.slice(7)
        : signatureHeader;
    const expected = computeInboundSignature(rawBody);
    try {
        return crypto.timingSafeEqual(
            Buffer.from(provided, "hex"),
            Buffer.from(expected, "hex")
        );
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Gateway request authentication helper
// ---------------------------------------------------------------------------

/**
 * Extracts and verifies the device JWT from an Authorization header.
 * Returns the decoded payload or null on failure.
 */
export function extractDeviceFromAuthHeader(
    authHeader: string | null
): DeviceTokenPayload | null {
    if (!authHeader) return null;
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    try {
        return verifyDeviceToken(token);
    } catch {
        return null;
    }
}
