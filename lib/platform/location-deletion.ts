import "server-only";

import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import {
  assertLocationCanBeDeleted,
  LocationDeletionError,
  locationDisplayName,
} from "@/lib/platform/location-deletion-policy";

export async function deletePlatformLocation(input: { locationId: string; confirmationName: string }) {
  const actor = await getPlatformAdminContext();
  if (!actor) throw new LocationDeletionError("Location not found.", "NOT_AUTHORIZED");

  const locationId = String(input.locationId || "").trim();
  if (!locationId) throw new LocationDeletionError("Location not found.", "NOT_FOUND");

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Location" WHERE "id" = ${locationId} FOR UPDATE`);
    const location = await tx.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        name: true,
        isPlatformMaster: true,
        ghlLocationId: true,
        whatsappPhoneNumberId: true,
        users: {
          select: {
            id: true,
            locations: { select: { id: true } },
          },
        },
        _count: {
          select: {
            impersonationAudits: true,
            whatsappSessionAuthAuditEvents: true,
            mediaAssets: true,
            publicSiteDomains: { where: { status: { not: "RELEASED" } } },
            whatsappChannels: true,
            whatsappWebBridgeSessions: true,
            smsRelayDevices: true,
          },
        },
      },
    });
    if (!location) throw new LocationDeletionError("Location not found.", "NOT_FOUND");

    assertLocationCanBeDeleted({
      name: location.name,
      isPlatformMaster: location.isPlatformMaster,
      retainedAuditCount: location._count.impersonationAudits + location._count.whatsappSessionAuthAuditEvents,
      mediaAssetCount: location._count.mediaAssets,
      externalResourceCount:
        Number(Boolean(location.ghlLocationId))
        + Number(Boolean(location.whatsappPhoneNumberId))
        + location._count.publicSiteDomains
        + location._count.whatsappChannels
        + location._count.whatsappWebBridgeSessions
        + location._count.smsRelayDevices,
    }, input.confirmationName);

    // These tenant-owned records use restrictive foreign keys between each
    // other. Remove the join/leaf rows first; the remaining location-owned
    // records are removed by their existing database cascades below.
    await tx.propertySwipe.deleteMany({
      where: {
        OR: [
          { property: { locationId } },
          { contact: { locationId } },
          { session: { locationId } },
        ],
      },
    });
    await Promise.all([
      tx.propertyMedia.deleteMany({ where: { property: { locationId } } }),
      tx.contactPropertyRole.deleteMany({
        where: { OR: [{ contact: { locationId } }, { property: { locationId } }] },
      }),
      tx.companyPropertyRole.deleteMany({
        where: { OR: [{ company: { locationId } }, { property: { locationId } }] },
      }),
      tx.contactCompanyRole.deleteMany({
        where: { OR: [{ contact: { locationId } }, { company: { locationId } }] },
      }),
      tx.propertyFeed.deleteMany({ where: { company: { locationId } } }),
    ]);

    await tx.swipeSession.deleteMany({ where: { locationId } });
    await tx.company.deleteMany({ where: { locationId } });
    await tx.contact.deleteMany({ where: { locationId } });
    await tx.property.deleteMany({ where: { locationId } });
    await tx.project.deleteMany({ where: { locationId } });
    await tx.location.delete({ where: { id: locationId } });

    return {
      id: location.id,
      name: locationDisplayName(location.name),
      detachedUserCount: location.users.length,
      orphanedUserCount: location.users.filter((user) => user.locations.length === 1).length,
    };
  }, { maxWait: 10_000, timeout: 60_000 });

  console.info("[Platform] Location deleted", {
    actorUserId: actor.internalUserId,
    locationId: result.id,
    locationName: result.name,
    detachedUserCount: result.detachedUserCount,
    orphanedUserCount: result.orphanedUserCount,
  });
  return result;
}
