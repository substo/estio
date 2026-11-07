import { createHash, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { decryptSettingsSecretValue } from "@/lib/settings/crypto";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

/**
 * The Location's WhatsApp Cloud webhook verify token lives only in the encrypted settings secret
 * whatsapp_webhook_secret (LOCATION scope, domain location.integrations). Admins copy it into Meta's
 * webhook form; Meta echoes it as hub.verify_token when subscribing. The former plain-text Location column
 * and document key are gone. Server-only.
 */

const scope = (locationId: string) => ({
    scopeType: "LOCATION" as const,
    scopeId: locationId,
    domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
    secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_WEBHOOK_SECRET,
});

/** Constant-time string comparison that does not leak either length (both sides hashed first). */
export function tokensMatch(supplied: string, expected: string): boolean {
    if (!supplied || !expected) return false;
    const a = createHash("sha256").update(supplied, "utf8").digest();
    const b = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(a, b);
}

export async function getLocationWhatsAppWebhookSecret(locationId: string): Promise<string | null> {
    return (await settingsService.getSecret(scope(locationId))) || null;
}

/** Stores (or with null, removes) the verify token. */
export async function setLocationWhatsAppWebhookSecret(locationId: string, value: string | null, actorUserId: string | null) {
    const token = value?.trim() || null;
    if (token) {
        await settingsService.setSecret({ ...scope(locationId), plaintext: token, actorUserId });
    } else {
        await settingsService.clearSecret({ ...scope(locationId), actorUserId });
    }
}

/**
 * Meta's subscription handshake: accepts the platform-wide WHATSAPP_WEBHOOK_VERIFY_TOKEN or any Location's
 * stored verify token. Every candidate is compared in constant time; no early exit on a match.
 */
export async function isAcceptedWhatsAppVerifyToken(supplied: string, platformToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ""): Promise<boolean> {
    let accepted = tokensMatch(supplied, platformToken);
    const rows = await db.settingsSecret.findMany({
        where: { scopeType: "LOCATION", domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_WEBHOOK_SECRET },
        take: 1000,
    });
    for (const row of rows) {
        const expected = await decryptSettingsSecretValue({
            scopeType: "LOCATION",
            scopeId: row.scopeId,
            domain: row.domain,
            secretKey: row.secretKey,
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.authTag,
            keyId: row.keyId,
            encryptedDek: row.encryptedDek,
        }).catch(() => "");
        accepted = tokensMatch(supplied, expected) || accepted;
    }
    return accepted;
}
