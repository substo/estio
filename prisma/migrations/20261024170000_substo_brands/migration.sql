-- Brands on Substo (CRM on Substo, slice 1). Additive and safe for the
-- previous release: every existing and newly inserted brand defaults to the
-- estio realm, and the triggers below only reject cross-realm memberships,
-- which no earlier release can create. "Location" in code = brand.

-- CreateEnum
CREATE TYPE "BrandInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "authRealm" "AuthRealm" NOT NULL DEFAULT 'estio',
ADD COLUMN     "autoCreatedForUserId" TEXT,
ADD COLUMN     "studioWorkspaceId" TEXT;

-- CreateTable
CREATE TABLE "BrandInvitation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "authRealm" "AuthRealm" NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "BrandInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "clerkInvitationId" TEXT,

    CONSTRAINT "BrandInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandInvitation_authRealm_email_status_idx" ON "BrandInvitation"("authRealm", "email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandInvitation_locationId_email_key" ON "BrandInvitation"("locationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Location_studioWorkspaceId_key" ON "Location"("studioWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_autoCreatedForUserId_key" ON "Location"("autoCreatedForUserId");

-- CreateIndex
CREATE INDEX "Location_authRealm_idx" ON "Location"("authRealm");

-- AddForeignKey
ALTER TABLE "BrandInvitation" ADD CONSTRAINT "BrandInvitation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInvitation" ADD CONSTRAINT "BrandInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInvitation" ADD CONSTRAINT "BrandInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A user can only be a member of, or be invited to, a brand in its own app.
CREATE FUNCTION "estio_assert_same_auth_realm"(p_user_id TEXT, p_location_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_user_realm "AuthRealm";
  v_location_realm "AuthRealm";
BEGIN
  SELECT "authRealm" INTO v_user_realm FROM "User" WHERE "id" = p_user_id;
  SELECT "authRealm" INTO v_location_realm FROM "Location" WHERE "id" = p_location_id;
  IF v_user_realm IS DISTINCT FROM v_location_realm THEN
    RAISE EXCEPTION 'User and brand belong to different apps' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "estio_user_location_role_same_realm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "estio_assert_same_auth_realm"(NEW."userId", NEW."locationId");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserLocationRole_same_auth_realm"
BEFORE INSERT OR UPDATE OF "userId", "locationId" ON "UserLocationRole"
FOR EACH ROW EXECUTE FUNCTION "estio_user_location_role_same_realm"();

-- Implicit Prisma relation "LocationToUser": column A is Location.id, B is User.id.
CREATE FUNCTION "estio_location_user_same_realm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "estio_assert_same_auth_realm"(NEW."B", NEW."A");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "_LocationToUser_same_auth_realm"
BEFORE INSERT OR UPDATE ON "_LocationToUser"
FOR EACH ROW EXECUTE FUNCTION "estio_location_user_same_realm"();

CREATE FUNCTION "estio_brand_invitation_same_realm"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authRealm" IS DISTINCT FROM (SELECT "authRealm" FROM "Location" WHERE "id" = NEW."locationId") THEN
    RAISE EXCEPTION 'Invitation and brand belong to different apps' USING ERRCODE = '23514';
  END IF;
  IF NEW."acceptedById" IS NOT NULL THEN
    PERFORM "estio_assert_same_auth_realm"(NEW."acceptedById", NEW."locationId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BrandInvitation_same_auth_realm"
BEFORE INSERT OR UPDATE ON "BrandInvitation"
FOR EACH ROW EXECUTE FUNCTION "estio_brand_invitation_same_realm"();

-- The app of a user or brand never changes once created.
CREATE FUNCTION "estio_auth_realm_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authRealm" IS DISTINCT FROM OLD."authRealm" THEN
    RAISE EXCEPTION 'The app of a user or brand cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_auth_realm_immutable"
BEFORE UPDATE OF "authRealm" ON "User"
FOR EACH ROW EXECUTE FUNCTION "estio_auth_realm_immutable"();

CREATE TRIGGER "Location_auth_realm_immutable"
BEFORE UPDATE OF "authRealm" ON "Location"
FOR EACH ROW EXECUTE FUNCTION "estio_auth_realm_immutable"();
