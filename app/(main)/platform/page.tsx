import db from "@/lib/db";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { MasterLoginForm } from "./_components/master-login-form";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const initialLocationId = String((await searchParams).locationId || "").trim();
  const platformAdmin = await getPlatformAdminContext();
  const [locations, membershipRoles] = await Promise.all([
    db.location.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
    db.userLocationRole.findMany({
      where: {
        user: {
          id: { not: platformAdmin?.internalUserId },
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

  const membersByLocation = new Map<string, Array<{ id: string; name: string; email: string }>>();
  for (const membership of membershipRoles) {
    if (!membership.user.locations.some((location) => location.id === membership.locationId)) continue;
    const members = membersByLocation.get(membership.locationId) || [];
    if (members.some((member) => member.id === membership.user.id)) continue;
    members.push({
      id: membership.user.id,
      email: membership.user.email,
      name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" ") || membership.user.email,
    });
    membersByLocation.set(membership.locationId, members);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Master login</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a location and user to open their dashboard.</p>
      </div>
      <MasterLoginForm initialLocationId={initialLocationId} locations={locations.map((location) => ({
        id: location.id,
        name: location.name || "Unnamed location",
        members: membersByLocation.get(location.id) || [],
      }))} />
    </main>
  );
}
