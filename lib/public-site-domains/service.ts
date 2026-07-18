import crypto from "node:crypto";
import { resolve4, resolve6, resolveCname, resolveTxt } from "node:dns/promises";
import type { Prisma, PublicSiteDomain } from "@prisma/client";
import db from "@/lib/db";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
    getDomainVerificationRecord,
    getHostnameClaimVariants,
    normalizePublicSiteHostname,
    PublicSiteDomainValidationError,
} from "./hostname";

const ACTIVE_RESOLUTION_STATUSES = ["VERIFIED", "ACTIVE"] as const;
const SERVER_IP = process.env.PUBLIC_SITE_SERVER_IP || "138.199.214.117";

type DomainDb = Prisma.TransactionClient | typeof db;

export type PublicSiteDomainResolution = {
    hostname: string;
    canonicalHostname: string;
    locationId: string;
    role: "CANONICAL" | "REDIRECT";
    status: "VERIFIED" | "ACTIVE";
    redirect: boolean;
};

function logDomainEvent(event: string, data: Record<string, unknown>) {
    console.log("[public-site-domain]", JSON.stringify({ event, ...data }));
}

async function findCanonicalDomain(locationId: string, client: DomainDb = db) {
    return client.publicSiteDomain.findFirst({
        where: { locationId, role: "CANONICAL", status: "ACTIVE" },
        orderBy: { activatedAt: "desc" },
    });
}

export async function resolvePublicSiteDomain(rawHostname: string): Promise<PublicSiteDomainResolution | null> {
    let hostname: string;
    try {
        hostname = normalizePublicSiteHostname(rawHostname);
    } catch {
        return null;
    }

    let binding = await db.publicSiteDomain.findFirst({
        where: { hostname, status: { in: [...ACTIVE_RESOLUTION_STATUSES] } },
    });

    let virtualWwwAlias = false;
    if (!binding && hostname.startsWith("www.")) {
        binding = await db.publicSiteDomain.findFirst({
            where: {
                hostname: hostname.slice(4),
                role: "CANONICAL",
                status: { in: [...ACTIVE_RESOLUTION_STATUSES] },
            },
        });
        virtualWwwAlias = !!binding;
    }
    if (!binding) return null;

    const canonical = binding.role === "CANONICAL"
        ? binding
        : await findCanonicalDomain(binding.locationId);
    if (!canonical) return null;

    return {
        hostname,
        canonicalHostname: canonical.hostname,
        locationId: binding.locationId,
        role: virtualWwwAlias ? "REDIRECT" : binding.role,
        status: binding.status as "VERIFIED" | "ACTIVE",
        redirect: virtualWwwAlias || binding.role === "REDIRECT" || hostname !== canonical.hostname,
    };
}

export async function isPublicSiteDomainAuthorized(rawHostname: string): Promise<boolean> {
    return !!(await resolvePublicSiteDomain(rawHostname));
}

export async function claimPublicSiteDomain(args: {
    locationId: string;
    hostname: string;
    actorUserId?: string | null;
}): Promise<PublicSiteDomain> {
    const hostname = normalizePublicSiteHostname(args.hostname);
    const variants = getHostnameClaimVariants(hostname);
    const conflicts = await db.publicSiteDomain.findMany({
        where: { hostname: { in: variants }, status: { not: "RELEASED" } },
        select: { id: true, locationId: true, hostname: true },
    });
    const crossLocationConflict = conflicts.find((item) => item.locationId !== args.locationId);
    if (crossLocationConflict) {
        throw new PublicSiteDomainValidationError("This domain or its www variant is already claimed by another location.");
    }
    const existing = conflicts.find((item) => item.hostname === hostname);
    if (existing) {
        return db.publicSiteDomain.findUniqueOrThrow({ where: { id: existing.id } });
    }

    const released = await db.publicSiteDomain.findUnique({ where: { hostname } });
    const verificationToken = `estio_${crypto.randomBytes(24).toString("base64url")}`;
    const binding = released
        ? await db.publicSiteDomain.update({
            where: { id: released.id },
            data: {
                locationId: args.locationId,
                role: "CANONICAL",
                status: "PENDING",
                verificationToken,
                verifiedAt: null,
                activatedAt: null,
                releasedAt: null,
                releasedByUserId: null,
                createdByUserId: args.actorUserId || null,
                provisioningError: null,
            },
        })
        : await db.publicSiteDomain.create({
            data: {
                locationId: args.locationId,
                hostname,
                verificationToken,
                createdByUserId: args.actorUserId || null,
            },
        });
    logDomainEvent("claimed", { hostname, locationId: args.locationId, domainId: binding.id });
    return binding;
}

export type DomainDnsCheck = {
    verified: boolean;
    verificationRecord: string;
    txtMatched: boolean;
    addresses: string[];
    cnames: string[];
    routingConfigured: boolean;
    error?: string;
};

async function settledValues<T>(promise: Promise<T[]>): Promise<T[]> {
    try {
        return await promise;
    } catch {
        return [];
    }
}

export async function checkPublicSiteDomainDns(
    binding: Pick<PublicSiteDomain, "hostname" | "verificationToken">,
    dependencies?: {
        txt?: (hostname: string) => Promise<string[][]>;
        ipv4?: (hostname: string) => Promise<string[]>;
        ipv6?: (hostname: string) => Promise<string[]>;
        cname?: (hostname: string) => Promise<string[]>;
    }
): Promise<DomainDnsCheck> {
    const verificationRecord = getDomainVerificationRecord(binding.hostname);
    const txt = dependencies?.txt || resolveTxt;
    const ipv4 = dependencies?.ipv4 || resolve4;
    const ipv6 = dependencies?.ipv6 || resolve6;
    const cname = dependencies?.cname || resolveCname;
    const [txtRows, v4, v6, cnames] = await Promise.all([
        settledValues(txt(verificationRecord)),
        settledValues(ipv4(binding.hostname)),
        settledValues(ipv6(binding.hostname)),
        settledValues(cname(binding.hostname)),
    ]);
    const txtMatched = txtRows.some((parts) => parts.join("").trim() === binding.verificationToken);
    const addresses = [...v4, ...v6];
    const routingConfigured = addresses.length > 0 || cnames.length > 0;
    return {
        verified: txtMatched && routingConfigured,
        verificationRecord,
        txtMatched,
        addresses,
        cnames,
        routingConfigured,
        error: !txtMatched
            ? "The ownership TXT record was not found."
            : !routingConfigured
                ? "The hostname has no A, AAAA, or CNAME routing record."
                : undefined,
    };
}

export async function verifyPublicSiteDomain(args: {
    locationId: string;
    domainId: string;
    dnsCheck?: typeof checkPublicSiteDomainDns;
}) {
    const binding = await db.publicSiteDomain.findFirst({
        where: { id: args.domainId, locationId: args.locationId, status: { in: ["PENDING", "VERIFIED"] } },
    });
    if (!binding) throw new PublicSiteDomainValidationError("Pending domain not found.");
    const result = await (args.dnsCheck || checkPublicSiteDomainDns)(binding);
    const updated = await db.publicSiteDomain.update({
        where: { id: binding.id },
        data: {
            lastDnsCheckAt: new Date(),
            ...(result.verified ? { status: "VERIFIED", verifiedAt: new Date(), provisioningError: null } : {}),
            ...(!result.verified ? { provisioningError: result.error || "DNS verification failed." } : {}),
        },
    });
    logDomainEvent(result.verified ? "verified" : "verification_failed", {
        hostname: binding.hostname,
        locationId: binding.locationId,
        txtMatched: result.txtMatched,
        routingConfigured: result.routingConfigured,
    });
    return { binding: updated, dns: result };
}

async function syncLegacyCanonicalDomain(tx: Prisma.TransactionClient, locationId: string, hostname: string) {
    await tx.siteConfig.upsert({
        where: { locationId },
        create: { locationId, domain: hostname },
        update: { domain: hostname },
    });
    await tx.location.update({ where: { id: locationId }, data: { domain: hostname } });
    const settingsDocument = await tx.settingsDocument.findUnique({
        where: {
            scopeType_scopeId_domain: {
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
            },
        },
    });
    if (settingsDocument) {
        const payload = { ...(settingsDocument.payload as Record<string, unknown>), domain: hostname };
        await tx.settingsDocument.update({
            where: { id: settingsDocument.id },
            data: { payload: payload as Prisma.InputJsonValue, version: { increment: 1 } },
        });
    }
}

async function clearLegacyCanonicalDomain(tx: Prisma.TransactionClient, locationId: string) {
    await tx.siteConfig.updateMany({ where: { locationId }, data: { domain: null } });
    await tx.location.update({ where: { id: locationId }, data: { domain: null } });
    const settingsDocument = await tx.settingsDocument.findUnique({
        where: {
            scopeType_scopeId_domain: {
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
            },
        },
    });
    if (settingsDocument) {
        const payload = { ...(settingsDocument.payload as Record<string, unknown>), domain: null };
        await tx.settingsDocument.update({
            where: { id: settingsDocument.id },
            data: { payload: payload as Prisma.InputJsonValue, version: { increment: 1 } },
        });
    }
}

export async function promotePublicSiteDomain(args: { locationId: string; domainId: string }) {
    return db.$transaction(async (tx) => {
        const target = await tx.publicSiteDomain.findFirst({
            where: { id: args.domainId, locationId: args.locationId, status: "VERIFIED" },
        });
        if (!target) throw new PublicSiteDomainValidationError("Only a verified domain can be promoted.");
        const current = await findCanonicalDomain(args.locationId, tx);
        if (current && current.id !== target.id) {
            await tx.publicSiteDomain.update({
                where: { id: current.id },
                data: { role: "REDIRECT" },
            });
        }
        const promoted = await tx.publicSiteDomain.update({
            where: { id: target.id },
            data: {
                role: "CANONICAL",
                status: "ACTIVE",
                activatedAt: new Date(),
                provisioningError: null,
            },
        });
        await syncLegacyCanonicalDomain(tx, args.locationId, promoted.hostname);
        logDomainEvent("promoted", {
            hostname: promoted.hostname,
            locationId: args.locationId,
            previousHostname: current?.hostname || null,
        });
        return promoted;
    });
}

export async function releasePublicSiteDomain(args: {
    locationId: string;
    domainId: string;
    actorUserId?: string | null;
}) {
    const result = await db.$transaction((tx) => releasePublicSiteDomainInTransaction(tx, args));
    logDomainEvent("released", {
        hostname: result.released.hostname,
        locationId: result.released.locationId,
        clearedCanonical: result.clearedCanonical,
    });
    return result;
}

export async function releasePublicSiteDomainInTransaction(
    tx: Prisma.TransactionClient,
    args: { locationId: string; domainId: string; actorUserId?: string | null }
) {
    const binding = await tx.publicSiteDomain.findFirst({
        where: { id: args.domainId, locationId: args.locationId },
    });
    if (!binding || binding.status === "RELEASED") {
        throw new PublicSiteDomainValidationError("Domain not found.");
    }

    const clearedCanonical = binding.role === "CANONICAL" && binding.status === "ACTIVE";
    if (clearedCanonical) {
        await clearLegacyCanonicalDomain(tx, binding.locationId);
    }

    const released = await tx.publicSiteDomain.update({
        where: { id: binding.id },
        data: {
            status: "RELEASED",
            releasedAt: new Date(),
            releasedByUserId: args.actorUserId || null,
            provisioningError: null,
        },
    });
    const idempotencyKey = `RELEASE:${binding.id}`;
    const job = await tx.publicSiteDomainProvisioningJob.upsert({
        where: { idempotencyKey },
        create: {
            locationId: binding.locationId,
            domainId: binding.id,
            operation: "RELEASE",
            idempotencyKey,
        },
        update: {
            status: "PENDING",
            scheduledAt: new Date(),
            lockedAt: null,
            processedAt: null,
            lastError: null,
        },
    });
    return { released, job, clearedCanonical };
}

export async function enqueuePublicSiteDomainJob(args: {
    locationId: string;
    domainId: string;
    operation: "PROVISION" | "RELEASE";
}) {
    const idempotencyKey = `${args.operation}:${args.domainId}`;
    return db.publicSiteDomainProvisioningJob.upsert({
        where: { idempotencyKey },
        create: { ...args, idempotencyKey },
        update: {
            status: "PENDING",
            scheduledAt: new Date(),
            lockedAt: null,
            processedAt: null,
            lastError: null,
        },
    });
}

export async function listPublicSiteDomains(locationId: string) {
    return db.publicSiteDomain.findMany({
        where: { locationId, status: { not: "RELEASED" } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
}

export { PublicSiteDomainValidationError, SERVER_IP };
