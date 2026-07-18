import db from "@/lib/db";
import { registerClerkDomain, unregisterClerkDomain } from "@/lib/auth/clerk-domains";
import { promotePublicSiteDomain } from "./service";

const HEALTH_TIMEOUT_MS = 20_000;

async function checkDomainHttpsHealth(hostname: string, domainId: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
        const url = new URL(`https://${hostname}/api/public-site-domain-health`);
        url.searchParams.set("domainId", domainId);
        const response = await fetch(url, {
            redirect: "manual",
            cache: "no-store",
            signal: controller.signal,
            headers: { "User-Agent": "EstioDomainProvisioner/1.0" },
        });
        return response.ok && response.headers.get("x-estio-domain-id") === domainId;
    } finally {
        clearTimeout(timeout);
    }
}

function retryDelay(attemptCount: number) {
    return new Date(Date.now() + Math.min(60, 2 ** Math.min(attemptCount, 5)) * 60_000);
}

export async function processPublicSiteDomainJob(jobId: string) {
    const claimed = await db.publicSiteDomainProvisioningJob.updateMany({
        where: { id: jobId, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "PROCESSING", lockedAt: new Date(), attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;

    const job = await db.publicSiteDomainProvisioningJob.findUnique({
        where: { id: jobId },
        include: { domain: true },
    });
    if (!job) return null;

    try {
        if (job.operation === "PROVISION") {
            if (job.domain.status !== "VERIFIED") throw new Error("Domain must be verified before provisioning.");
            const clerkReady = await registerClerkDomain(job.domain.hostname);
            if (!clerkReady) throw new Error("Clerk domain registration failed.");
            const tlsReady = await checkDomainHttpsHealth(job.domain.hostname, job.domain.id);
            await db.publicSiteDomain.update({
                where: { id: job.domain.id },
                data: { lastHealthCheckAt: new Date() },
            });
            if (!tlsReady) throw new Error("HTTPS health check failed after TLS provisioning.");
            await promotePublicSiteDomain({ locationId: job.locationId, domainId: job.domainId });
        } else if (job.operation === "RELEASE") {
            const cleaned = await unregisterClerkDomain(job.domain.hostname);
            if (!cleaned) throw new Error("Clerk domain cleanup failed.");
        } else {
            throw new Error(`Unsupported domain job operation: ${job.operation}`);
        }

        return db.publicSiteDomainProvisioningJob.update({
            where: { id: job.id },
            data: { status: "COMPLETED", processedAt: new Date(), lockedAt: null, lastError: null },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.$transaction([
            db.publicSiteDomainProvisioningJob.update({
                where: { id: job.id },
                data: {
                    status: "FAILED",
                    lockedAt: null,
                    lastError: message,
                    scheduledAt: retryDelay(job.attemptCount + 1),
                },
            }),
            db.publicSiteDomain.update({
                where: { id: job.domainId },
                data: { provisioningError: message },
            }),
        ]);
        console.error("[public-site-domain]", JSON.stringify({
            event: "provisioning_failed",
            domainId: job.domainId,
            hostname: job.domain.hostname,
            operation: job.operation,
            attemptCount: job.attemptCount,
            error: message,
        }));
        throw error;
    }
}

export async function processDuePublicSiteDomainJobs(limit = 10) {
    const jobs = await db.publicSiteDomainProvisioningJob.findMany({
        where: { status: { in: ["PENDING", "FAILED"] }, scheduledAt: { lte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: limit,
        select: { id: true },
    });
    const results = [];
    for (const job of jobs) {
        try {
            results.push(await processPublicSiteDomainJob(job.id));
        } catch {
            results.push(null);
        }
    }
    return { attempted: jobs.length, completed: results.filter(Boolean).length };
}
