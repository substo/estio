-- Backend naming: a Location is never called a brand. Metadata-only renames; no data changes.
ALTER TABLE "BrandInvitation" RENAME TO "LocationInvitation";
ALTER TYPE "BrandInvitationStatus" RENAME TO "LocationInvitationStatus";
ALTER TABLE "LocationInvitation" RENAME CONSTRAINT "BrandInvitation_pkey" TO "LocationInvitation_pkey";
ALTER TABLE "LocationInvitation" RENAME CONSTRAINT "BrandInvitation_locationId_fkey" TO "LocationInvitation_locationId_fkey";
ALTER TABLE "LocationInvitation" RENAME CONSTRAINT "BrandInvitation_invitedById_fkey" TO "LocationInvitation_invitedById_fkey";
ALTER TABLE "LocationInvitation" RENAME CONSTRAINT "BrandInvitation_acceptedById_fkey" TO "LocationInvitation_acceptedById_fkey";
ALTER INDEX "BrandInvitation_locationId_email_key" RENAME TO "LocationInvitation_locationId_email_key";
ALTER INDEX "BrandInvitation_authRealm_email_status_idx" RENAME TO "LocationInvitation_authRealm_email_status_idx";
ALTER TRIGGER "BrandInvitation_same_auth_realm" ON "LocationInvitation" RENAME TO "LocationInvitation_same_auth_realm";
ALTER FUNCTION "estio_brand_invitation_same_realm"() RENAME TO "estio_location_invitation_same_realm";
