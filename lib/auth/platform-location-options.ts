import "server-only";

import db from "@/lib/db";

export type PlatformLocationLoginOption = {
  id: string;
  name: string;
  isPlatformMaster: boolean;
  members: Array<{ id: string; name: string; email: string; canImpersonate: boolean }>;
};

export async function listPlatformLocationLoginOptions(platformAdminUserId: string): Promise<PlatformLocationLoginOption[]> {
  const [locations, membershipRoles] = await Promise.all([
    db.location.findMany({
      orderBy: [{ isPlatformMaster: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, isPlatformMaster: true },
    }),
    db.userLocationRole.findMany({
      where: {
        user: {
          clerkId: { not: null },
        },
      },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }, { user: { email: "asc" } }],
      select: {
        locationId: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            locations: { select: { id: true } },
          },
        },
      },
    }),
  ]);

  const membersByLocation = new Map<string, PlatformLocationLoginOption["members"]>();
  for (const membership of membershipRoles) {
    if (!membership.user.locations.some((location) => location.id === membership.locationId)) continue;
    const members = membersByLocation.get(membership.locationId) || [];
    if (members.some((member) => member.id === membership.user.id)) continue;
    members.push({
      id: membership.user.id,
      email: membership.user.email,
      name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" ") || membership.user.email,
      canImpersonate: membership.user.id !== platformAdminUserId,
    });
    membersByLocation.set(membership.locationId, members);
  }

  return locations.map((location) => ({
    id: location.id,
    name: location.name || "Unnamed location",
    isPlatformMaster: location.isPlatformMaster,
    members: membersByLocation.get(location.id) || [],
  }));
}
