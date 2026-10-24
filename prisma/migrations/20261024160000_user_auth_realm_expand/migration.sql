-- Expand step for realm-scoped Business identity (CRM on Substo, slice 1).
-- Additive only, so the previous release keeps working against this schema:
-- existing rows and old inserts default to 'estio', and the global email and
-- clerkId unique indexes remain. The contract step (dropping "User_email_key")
-- ships in a later release; see documentation/crm-realm-identity-rollout.md.
CREATE TYPE "AuthRealm" AS ENUM ('estio', 'substo');

-- A constant default is metadata-only on PostgreSQL 11+ (no table rewrite).
ALTER TABLE "User"
ADD COLUMN "authRealm" "AuthRealm" NOT NULL DEFAULT 'estio';

CREATE UNIQUE INDEX "User_authRealm_email_key" ON "User"("authRealm", "email");

CREATE UNIQUE INDEX "User_authRealm_clerkId_key" ON "User"("authRealm", "clerkId");
