CREATE TYPE "PublicSiteDomainRole" AS ENUM ('CANONICAL', 'REDIRECT');
CREATE TYPE "PublicSiteDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'RELEASED');
CREATE TYPE "PublicSiteDomainJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "public_site_domains" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "role" "PublicSiteDomainRole" NOT NULL DEFAULT 'CANONICAL',
    "status" "PublicSiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "lastDnsCheckAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "provisioningError" TEXT,
    "createdByUserId" TEXT,
    "releasedByUserId" TEXT,
    CONSTRAINT "public_site_domains_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public_site_domain_provisioning_jobs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "PublicSiteDomainJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "public_site_domain_provisioning_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_site_domains_hostname_key" ON "public_site_domains"("hostname");
CREATE UNIQUE INDEX "public_site_domains_verificationToken_key" ON "public_site_domains"("verificationToken");
CREATE INDEX "public_site_domains_locationId_status_idx" ON "public_site_domains"("locationId", "status");
CREATE INDEX "public_site_domains_locationId_role_status_idx" ON "public_site_domains"("locationId", "role", "status");
CREATE UNIQUE INDEX "public_site_domains_one_active_canonical_per_location"
    ON "public_site_domains"("locationId")
    WHERE "role" = 'CANONICAL' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "public_site_domain_provisioning_jobs_idempotencyKey_key" ON "public_site_domain_provisioning_jobs"("idempotencyKey");
CREATE INDEX "public_site_domain_provisioning_jobs_status_scheduledAt_idx" ON "public_site_domain_provisioning_jobs"("status", "scheduledAt");
CREATE INDEX "public_site_domain_provisioning_jobs_domainId_status_idx" ON "public_site_domain_provisioning_jobs"("domainId", "status");
CREATE INDEX "public_site_domain_provisioning_jobs_locationId_status_idx" ON "public_site_domain_provisioning_jobs"("locationId", "status");

ALTER TABLE "public_site_domains" ADD CONSTRAINT "public_site_domains_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public_site_domain_provisioning_jobs" ADD CONSTRAINT "public_site_domain_provisioning_jobs_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public_site_domain_provisioning_jobs" ADD CONSTRAINT "public_site_domain_provisioning_jobs_domainId_fkey"
    FOREIGN KEY ("domainId") REFERENCES "public_site_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing SiteConfig domains are the only legacy values used by Caddy and public routing.
-- Settings-document-only values are intentionally not activated by this migration.
INSERT INTO "public_site_domains" (
    "id", "createdAt", "updatedAt", "locationId", "hostname", "role", "status",
    "verificationToken", "verifiedAt", "activatedAt"
)
SELECT
    'psd_' || md5(sc."locationId" || ':' || lower(trim(sc."domain"))),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    sc."locationId",
    lower(trim(trailing '.' from sc."domain")),
    'CANONICAL'::"PublicSiteDomainRole",
    'ACTIVE'::"PublicSiteDomainStatus",
    'legacy_' || md5(sc."locationId" || ':' || lower(trim(sc."domain"))),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "SearchConfig" sc
WHERE sc."domain" IS NOT NULL AND trim(sc."domain") <> ''
ON CONFLICT ("hostname") DO NOTHING;
