import db from "@/lib/db";
import { isHighConfidenceResolvedPhone, normalizeDigits, normalizeLidJid } from "@/lib/whatsapp/identity";
import { WHATSAPP_WEB_BRIDGE_PROVIDER, parseWhatsAppWebChatIdentity } from "@/lib/whatsapp/web-bridge";

export type WebBridgeContactIdentityPayload = {
    rawChatId?: string | null;
    remoteJid?: string | null;
    lidJid?: string | null;
    phoneJid?: string | null;
    number?: string | null;
    phone?: string | null;
    pushname?: string | null;
    name?: string | null;
    shortName?: string | null;
    verifiedName?: string | null;
    displayName?: string | null;
    source?: string | null;
};

export function normalizeWebBridgeLid(value: unknown) {
    return normalizeLidJid(value);
}

export function extractReliableWebBridgePhone(identity: any, fallbackJid?: unknown) {
    const lidDigits = normalizeDigits(
        identity?.lidJid
        || identity?.lid
        || (parseWhatsAppWebChatIdentity(fallbackJid).reason === "lid_identity" ? fallbackJid : "")
    );
    const candidates = [
        identity?.phoneJid,
        identity?.id?._serialized,
        fallbackJid,
        identity?.phone,
        identity?.phoneNumber,
        identity?.number,
    ];

    for (const candidate of candidates) {
        const parsed = parseWhatsAppWebChatIdentity(candidate);
        const digits = parsed.phone || normalizeDigits(candidate);
        if (parsed.reason === "lid_identity") continue;
        if (lidDigits && digits === lidDigits) continue;
        if (isHighConfidenceResolvedPhone(digits)) return digits;
    }

    return "";
}

export function getWebBridgeDisplayName(identity: any, fallback?: unknown) {
    return String(
        identity?.displayName
        || identity?.verifiedName
        || identity?.name
        || identity?.shortName
        || identity?.pushname
        || identity?.notifyName
        || fallback
        || ""
    ).trim();
}

export async function resolveWebBridgeIdentity(args: {
    locationId: string;
    remoteJid: string;
    identity?: WebBridgeContactIdentityPayload | null;
}) {
    const remoteIdentity = parseWhatsAppWebChatIdentity(args.remoteJid);
    const lid = normalizeWebBridgeLid(args.identity?.lidJid || (remoteIdentity.reason === "lid_identity" ? args.remoteJid : ""));
    const directPhone = extractReliableWebBridgePhone(args.identity, args.remoteJid);
    const displayName = getWebBridgeDisplayName(args.identity);

    if (directPhone) {
        return { phone: directPhone, lid, displayName, confidence: "high", source: "web_bridge_contact_metadata" };
    }

    if (lid) {
        const mapped = await (db as any).whatsAppIdentityMap.findFirst({
            where: {
                locationId: args.locationId,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                identityType: "lid",
                identityValue: lid,
                phone: { not: null },
            },
            orderBy: [{ updatedAt: "desc" }],
        }).catch(() => null);
        const mappedPhone = normalizeDigits(mapped?.phone || "");
        if (isHighConfidenceResolvedPhone(mappedPhone)) {
            return { phone: mappedPhone, lid, displayName: displayName || mapped?.displayName || "", confidence: "high", source: "identity_map" };
        }

        const contact = await (db as any).contact.findFirst({
            where: {
                locationId: args.locationId,
                OR: [
                    { lid },
                    { lid: lid.replace(/@lid$/i, "") },
                    { lid: { contains: lid.replace(/@lid$/i, "") } },
                ],
                phone: { not: null },
            },
            select: { phone: true, name: true },
            orderBy: [{ updatedAt: "desc" }],
        }).catch(() => null);
        const contactPhone = normalizeDigits(contact?.phone || "");
        if (isHighConfidenceResolvedPhone(contactPhone)) {
            return { phone: contactPhone, lid, displayName: displayName || contact?.name || "", confidence: "high", source: "contact_lid" };
        }
    }

    return { phone: "", lid, displayName, confidence: lid ? "unresolved" : "unknown", source: lid ? "lid_only" : "unsupported" };
}

export async function upsertWebBridgeIdentityMap(args: {
    locationId: string;
    contactId?: string | null;
    identityType: "lid" | "phone" | "chat";
    identityValue: string;
    lid?: string | null;
    phone?: string | null;
    displayName?: string | null;
    confidence?: string | null;
    source?: string | null;
    metadata?: any;
    lastSeenAt?: Date | null;
}) {
    const identityValue = String(args.identityValue || "").trim();
    if (!identityValue) return null;

    return (db as any).whatsAppIdentityMap.upsert({
        where: {
            locationId_provider_identityType_identityValue: {
                locationId: args.locationId,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                identityType: args.identityType,
                identityValue,
            },
        },
        create: {
            locationId: args.locationId,
            contactId: args.contactId || null,
            provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
            identityType: args.identityType,
            identityValue,
            lid: args.lid || null,
            phone: args.phone || null,
            displayName: args.displayName || null,
            confidence: args.confidence || null,
            source: args.source || null,
            lastSeenAt: args.lastSeenAt || new Date(),
            metadata: args.metadata || undefined,
        },
        update: {
            ...(args.contactId ? { contactId: args.contactId } : {}),
            ...(args.lid ? { lid: args.lid } : {}),
            ...(args.phone ? { phone: args.phone } : {}),
            ...(args.displayName ? { displayName: args.displayName } : {}),
            ...(args.confidence ? { confidence: args.confidence } : {}),
            ...(args.source ? { source: args.source } : {}),
            lastSeenAt: args.lastSeenAt || new Date(),
            ...(args.metadata ? { metadata: args.metadata } : {}),
        },
    }).catch((error: any) => {
        console.warn("[WhatsApp Web Bridge Identity] Failed to upsert identity map:", error?.message || error);
        return null;
    });
}
