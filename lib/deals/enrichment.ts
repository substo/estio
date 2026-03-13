import type { Prisma } from "@prisma/client";

export const DEAL_ENRICHMENT_METADATA_VERSION = 1;

export type DealEnrichmentStatus = "pending" | "processing" | "ready" | "failed";

export type DealEnrichmentState = {
    version: number;
    status: DealEnrichmentStatus;
    queuedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    failedAt?: string | null;
    error?: string | null;
    propertyCount?: number | null;
};

type ContactWithPropertyRefs = {
    propertyRoles?: Array<{ propertyId?: string | null }> | null;
    viewings?: Array<{ propertyId?: string | null }> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function getDealEnrichmentState(metadata: unknown): DealEnrichmentState | null {
    if (!isRecord(metadata)) return null;
    const enrichment = metadata.enrichment;
    if (!isRecord(enrichment)) return null;

    const status = String(enrichment.status || "").trim().toLowerCase();
    if (
        status !== "pending"
        && status !== "processing"
        && status !== "ready"
        && status !== "failed"
    ) {
        return null;
    }

    const rawPropertyCount = enrichment.propertyCount;
    const propertyCount = rawPropertyCount === null || rawPropertyCount === undefined || rawPropertyCount === ""
        ? null
        : Number(rawPropertyCount);

    return {
        version: Number(enrichment.version || DEAL_ENRICHMENT_METADATA_VERSION),
        status,
        queuedAt: enrichment.queuedAt ? String(enrichment.queuedAt) : null,
        startedAt: enrichment.startedAt ? String(enrichment.startedAt) : null,
        completedAt: enrichment.completedAt ? String(enrichment.completedAt) : null,
        failedAt: enrichment.failedAt ? String(enrichment.failedAt) : null,
        error: enrichment.error ? String(enrichment.error) : null,
        propertyCount: Number.isFinite(propertyCount as number) ? propertyCount as number : null,
    };
}

export function mergeDealEnrichmentMetadata(
    metadata: unknown,
    patch: Partial<DealEnrichmentState>
): Prisma.InputJsonValue {
    const base = isRecord(metadata) ? { ...metadata } : {};
    const previous = getDealEnrichmentState(metadata);

    const nextStatus = (patch.status || previous?.status || "pending") as DealEnrichmentStatus;
    const nextEnrichment: DealEnrichmentState = {
        version: DEAL_ENRICHMENT_METADATA_VERSION,
        status: nextStatus,
        queuedAt: patch.queuedAt !== undefined ? (patch.queuedAt ?? null) : (previous?.queuedAt ?? null),
        startedAt: patch.startedAt !== undefined ? (patch.startedAt ?? null) : (previous?.startedAt ?? null),
        completedAt: patch.completedAt !== undefined ? (patch.completedAt ?? null) : (previous?.completedAt ?? null),
        failedAt: patch.failedAt !== undefined ? (patch.failedAt ?? null) : (previous?.failedAt ?? null),
        error: patch.error !== undefined ? (patch.error ?? null) : (previous?.error ?? null),
        propertyCount: patch.propertyCount !== undefined ? (patch.propertyCount ?? null) : (previous?.propertyCount ?? null),
    };

    return {
        ...base,
        enrichment: nextEnrichment,
    } as Prisma.InputJsonValue;
}

export function collectDealPropertyIdsFromContacts(contacts: ContactWithPropertyRefs[]): string[] {
    const propertyIds = new Set<string>();

    for (const contact of Array.isArray(contacts) ? contacts : []) {
        for (const role of Array.isArray(contact?.propertyRoles) ? contact.propertyRoles : []) {
            const propertyId = String(role?.propertyId || "").trim();
            if (propertyId) propertyIds.add(propertyId);
        }

        for (const viewing of Array.isArray(contact?.viewings) ? contact.viewings : []) {
            const propertyId = String(viewing?.propertyId || "").trim();
            if (propertyId) propertyIds.add(propertyId);
        }
    }

    return Array.from(propertyIds);
}

export function getDealEnrichmentJobId(dealId: string): string {
    return `deal-enrichment:${String(dealId || "").trim()}`;
}
