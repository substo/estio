import db from "@/lib/db";

export interface OldCrmImportCapability {
    canImportOldCrmProperties: boolean;
    locationId: string;
    userId: string;
    crmUrl: string | null;
    crmEditUrlPattern: string | null;
    crmUsername: string | null;
    hasCrmPassword: boolean;
    missing: Array<"crmUrl" | "crmUsername" | "crmPassword">;
}

export interface ResolvedOldCrmImportContext extends OldCrmImportCapability {
    crmUrl: string;
    crmUsername: string;
    crmPassword: string;
}

export interface LegacyCrmRefCandidate {
    publicReference: string;
    oldCrmPropertyId: string;
    source: "explicit_ref" | "public_url";
}

function normalizeText(value: unknown): string {
    return String(value || "").trim();
}

export function hasOldCrmImportCapability(input: {
    crmUrl?: string | null;
    crmUsername?: string | null;
    crmPassword?: string | null;
}): Pick<OldCrmImportCapability, "canImportOldCrmProperties" | "missing"> {
    const missing: Array<"crmUrl" | "crmUsername" | "crmPassword"> = [];
    if (!normalizeText(input.crmUrl)) missing.push("crmUrl");
    if (!normalizeText(input.crmUsername)) missing.push("crmUsername");
    if (!normalizeText(input.crmPassword)) missing.push("crmPassword");
    return {
        canImportOldCrmProperties: missing.length === 0,
        missing,
    };
}

export async function getOldCrmImportCapabilityForUser(args: {
    locationId: string;
    userId: string;
}): Promise<OldCrmImportCapability> {
    const [location, user] = await Promise.all([
        db.location.findUnique({
            where: { id: args.locationId },
            select: { crmUrl: true, crmEditUrlPattern: true },
        }),
        db.user.findUnique({
            where: { id: args.userId },
            select: { crmUsername: true, crmPassword: true },
        }),
    ]);

    const capability = hasOldCrmImportCapability({
        crmUrl: location?.crmUrl,
        crmUsername: user?.crmUsername,
        crmPassword: user?.crmPassword,
    });

    return {
        canImportOldCrmProperties: capability.canImportOldCrmProperties,
        locationId: args.locationId,
        userId: args.userId,
        crmUrl: location?.crmUrl || null,
        crmEditUrlPattern: location?.crmEditUrlPattern || null,
        crmUsername: user?.crmUsername || null,
        hasCrmPassword: Boolean(user?.crmPassword),
        missing: capability.missing,
    };
}

export async function resolveOldCrmImportContextForUser(args: {
    locationId: string;
    userId: string;
}): Promise<ResolvedOldCrmImportContext> {
    const [location, user] = await Promise.all([
        db.location.findUnique({
            where: { id: args.locationId },
            select: { crmUrl: true, crmEditUrlPattern: true },
        }),
        db.user.findUnique({
            where: { id: args.userId },
            select: { crmUsername: true, crmPassword: true },
        }),
    ]);

    const capability = hasOldCrmImportCapability({
        crmUrl: location?.crmUrl,
        crmUsername: user?.crmUsername,
        crmPassword: user?.crmPassword,
    });

    if (!capability.canImportOldCrmProperties) {
        throw new Error(`Missing CRM configuration: ${capability.missing.join(", ")}`);
    }

    return {
        canImportOldCrmProperties: true,
        locationId: args.locationId,
        userId: args.userId,
        crmUrl: String(location?.crmUrl),
        crmEditUrlPattern: location?.crmEditUrlPattern || null,
        crmUsername: String(user?.crmUsername),
        crmPassword: String(user?.crmPassword),
        hasCrmPassword: true,
        missing: [],
    };
}

function normalizeDtRefToken(raw: string): string | null {
    const upper = normalizeText(raw).toUpperCase();
    const match = upper.match(/^DT(\d{2,6})$/);
    if (!match) return null;
    return `DT${match[1]}`;
}

function convertDtReferenceToOldCrmPropertyId(publicReference: string): string | null {
    const normalized = normalizeDtRefToken(publicReference);
    if (!normalized) return null;
    const numeric = Number(normalized.slice(2));
    if (!Number.isFinite(numeric)) return null;
    const legacyId = numeric - 1000;
    if (!Number.isFinite(legacyId) || legacyId <= 0) return null;
    return String(Math.trunc(legacyId));
}

export function extractLegacyCrmRefCandidates(text: string): LegacyCrmRefCandidate[] {
    const input = String(text || "");
    if (!input.trim()) return [];

    const candidates = new Map<string, LegacyCrmRefCandidate>();

    const explicitRefRegex = /\bref(?:\.?\s*no\.?|erence)?\s*[:#-]?\s*(DT\d{2,6})\b/gi;
    let explicitMatch: RegExpExecArray | null;
    while ((explicitMatch = explicitRefRegex.exec(input)) !== null) {
        const publicReference = normalizeDtRefToken(explicitMatch[1]);
        const oldCrmPropertyId = publicReference ? convertDtReferenceToOldCrmPropertyId(publicReference) : null;
        if (!publicReference || !oldCrmPropertyId) continue;
        candidates.set(publicReference, {
            publicReference,
            oldCrmPropertyId,
            source: "explicit_ref",
        });
    }

    const bareDtRegex = /\b(DT\d{2,6})\b/gi;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareDtRegex.exec(input)) !== null) {
        const publicReference = normalizeDtRefToken(bareMatch[1]);
        const oldCrmPropertyId = publicReference ? convertDtReferenceToOldCrmPropertyId(publicReference) : null;
        if (!publicReference || !oldCrmPropertyId) continue;
        if (!candidates.has(publicReference)) {
            candidates.set(publicReference, {
                publicReference,
                oldCrmPropertyId,
                source: "explicit_ref",
            });
        }
    }

    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urlMatches = input.match(urlRegex) || [];
    for (const rawUrl of urlMatches) {
        try {
            const parsed = new URL(rawUrl);
            if (!/downtowncyprus\.com$/i.test(parsed.hostname)) continue;
            const pathMatch = parsed.pathname.match(/ref-(dt\d{2,6})/i);
            const publicReference = pathMatch ? normalizeDtRefToken(pathMatch[1]) : null;
            const oldCrmPropertyId = publicReference ? convertDtReferenceToOldCrmPropertyId(publicReference) : null;
            if (!publicReference || !oldCrmPropertyId) continue;
            if (!candidates.has(publicReference)) {
                candidates.set(publicReference, {
                    publicReference,
                    oldCrmPropertyId,
                    source: "public_url",
                });
            }
        } catch {
            continue;
        }
    }

    return Array.from(candidates.values());
}
